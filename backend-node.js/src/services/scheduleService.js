const { createDbConnection } = require("../config/db");
const {
  buildPersistedAssignments,
  generateScheduleDraft,
} = require("./schedulingAlgorithm");

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

    const [employees] = await conn.query("SELECT * FROM employees");
    const [shifts] = await conn.query("SELECT * FROM shifts");
    const [shiftRequests] = await conn.query("SELECT * FROM shift_requests");

    return {
      employees,
      shifts,
      shiftRequests,
    };
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

async function generateInitialSchedule() {
  let conn;

  try {
    conn = await createDbConnection();

    const [employees] = await conn.query(
      "SELECT * FROM employees WHERE is_active = TRUE"
    );
    const [shifts] = await conn.query(
      "SELECT * FROM shifts ORDER BY shift_date, shift_type"
    );
    const [requests] = await conn.query(
      "SELECT * FROM shift_requests WHERE can_work = TRUE"
    );
    const scheduleDraft = generateScheduleDraft(employees, shifts, requests);

    if (!scheduleDraft.weekStartDate) {
      throw new Error("No shifts found for schedule generation");
    }

    const [scheduleResult] = await conn.query(
      `
      INSERT INTO weekly_schedules (week_start_date, created_by, status)
      VALUES (?, 'system', 'draft')
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        created_by = VALUES(created_by),
        status = VALUES(status)
      `,
      [scheduleDraft.weekStartDate]
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
      weekStartDate: scheduleDraft.weekStartDate,
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
