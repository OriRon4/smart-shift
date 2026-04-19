const { createDbConnection } = require("../config/db");
const {
  buildPersistedAssignments,
  generateScheduleDraft,
} = require("./schedulingAlgorithm");
const { buildWeekWindow, normalizeToWeekStart } = require("../utils/week");

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function collectAvailableWeekStarts(shifts) {
  return [...new Set(shifts.map((shift) => normalizeToWeekStart(shift.shift_date)))];
}

async function getEmployeesForTest() {
  let conn;

  try {
    conn = await createDbConnection();
    const [rows] = await conn.query("SELECT * FROM employees");
    return rows;
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

async function getSchedulingData() {
  let conn;

  try {
    conn = await createDbConnection();

    const [employees] = await conn.query(
      "SELECT * FROM employees WHERE is_active = TRUE AND role = 'waiter'"
    );
    const [shifts] = await conn.query(
      "SELECT * FROM shifts ORDER BY shift_date, shift_type"
    );
    const [shiftRequests] = await conn.query(
      "SELECT * FROM shift_requests WHERE can_work = TRUE"
    );

    return {
      employees,
      shifts,
      shiftRequests,
      availableWeekStarts: collectAvailableWeekStarts(shifts),
    };
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

async function generateInitialSchedule(options = {}) {
  let conn;

  try {
    conn = await createDbConnection();
    const requestedWeekStartDate = options.weekStartDate;
    let weekWindow;

    if (!requestedWeekStartDate) {
      throw createHttpError(
        400,
        "weekStartDate is required in the request body (YYYY-MM-DD)"
      );
    }

    try {
      weekWindow = buildWeekWindow(requestedWeekStartDate);
    } catch (error) {
      throw createHttpError(400, error.message);
    }

    const { weekStartDate, weekEndExclusive } = weekWindow;

    const [employees] = await conn.query(
      "SELECT * FROM employees WHERE is_active = TRUE AND role = 'waiter'"
    );
    const [shifts] = await conn.query(
      `
      SELECT *
      FROM shifts
      WHERE shift_date >= ? AND shift_date < ?
      ORDER BY shift_date, shift_type
      `,
      [weekStartDate, weekEndExclusive]
    );
    const [requests] = await conn.query(
      `
      SELECT sr.*
      FROM shift_requests sr
      INNER JOIN shifts s ON s.id = sr.shift_id
      WHERE sr.can_work = TRUE
        AND s.shift_date >= ?
        AND s.shift_date < ?
      `,
      [weekStartDate, weekEndExclusive]
    );

    if (shifts.length === 0) {
      throw createHttpError(
        404,
        `No shifts found for the selected week starting ${weekStartDate}`
      );
    }

    const scheduleDraft = generateScheduleDraft(employees, shifts, requests, {
      weekStartDate,
    });

    const [scheduleResult] = await conn.query(
      `
      INSERT INTO weekly_schedules (week_start_date, created_by, status)
      VALUES (?, 'system', 'draft')
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        created_by = VALUES(created_by),
      status = VALUES(status)
      `,
      [weekStartDate]
    );

    const scheduleId = scheduleResult.insertId;
    const assignments = buildPersistedAssignments(
      scheduleDraft.assignmentsByShift,
      scheduleDraft.employeesById,
      scheduleId
    );

    await conn.query("DELETE FROM schedule_assignments WHERE schedule_id = ?", [
      scheduleId,
    ]);

    if (assignments.length > 0) {
      await conn.query(
        `
        INSERT INTO schedule_assignments
        (schedule_id, shift_id, employee_id, assignment_score)
        VALUES ?
        `,
        [assignments]
      );
    }

    return {
      message: "Schedule generated",
      scheduleId,
      weekStartDate,
      requestedWeekStartDate,
      assignmentsCreated: assignments.length,
      improvementPasses: scheduleDraft.improvementPasses,
      summary: scheduleDraft.evaluation.summary,
      scoreBreakdown: scheduleDraft.evaluation.scoreBreakdown,
      totalScore: scheduleDraft.evaluation.totalScore,
      employeeStats: scheduleDraft.employeeStats,
      shifts: scheduleDraft.evaluation.shiftSummaries,
    };
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

module.exports = {
  generateInitialSchedule,
  getEmployeesForTest,
  getSchedulingData,
};
