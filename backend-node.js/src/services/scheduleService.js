const { createDbConnection } = require("../config/db");
const {
  buildPersistedAssignments,
  generateScheduleDraft,
} = require("./schedulingAlgorithm");

const ORDERED_SHIFTS_QUERY = `
  SELECT *
  FROM shifts
  ORDER BY shift_date, start_time, shift_type
`;

// Normalize a DATE value into a stable YYYY-MM-DD key for comparisons.
function getDateKey(dateValue) {
  if (typeof dateValue === "string") {
    return dateValue.slice(0, 10);
  }

  return new Date(dateValue).toISOString().slice(0, 10);
}

// Count the full days between two normalized date keys.
function getDayDifference(startDateKey, endDateKey) {
  const startTime = Date.parse(`${startDateKey}T00:00:00Z`);
  const endTime = Date.parse(`${endDateKey}T00:00:00Z`);

  return Math.round((endTime - startTime) / (24 * 60 * 60 * 1000));
}

// Return the earliest shift date so the current DB week has one stable identifier.
function getWeekStartDateFromShifts(shifts) {
  if (shifts.length === 0) {
    return null;
  }

  return [...shifts]
    .map((shift) => getDateKey(shift.shift_date))
    .sort()[0];
}

// Reject shift data that spans more than one 7-day scheduling window.
function assertSingleWeekShifts(shifts) {
  if (shifts.length === 0) {
    return null;
  }

  const shiftDates = shifts.map((shift) => getDateKey(shift.shift_date)).sort();
  const firstShiftDate = shiftDates[0];
  const lastShiftDate = shiftDates[shiftDates.length - 1];

  if (getDayDifference(firstShiftDate, lastShiftDate) > 6) {
    throw new Error(
      "Shifts must belong to a single 7-day scheduling window for V1"
    );
  }

  return firstShiftDate;
}

// Load only active waiters so V1 scheduling stays inside the intended role scope.
async function loadEligibleEmployees(conn) {
  const [employees] = await conn.query(
    `
    SELECT *
    FROM employees
    WHERE is_active = TRUE AND role = 'waiter'
    ORDER BY full_name, id
    `
  );

  return employees;
}

// Load shifts in chronological order so responses and evaluation are easier to follow.
async function loadOrderedShifts(conn) {
  const [shifts] = await conn.query(ORDERED_SHIFTS_QUERY);
  return shifts;
}

// Load only positive availability requests for employees eligible in the V1 scheduler.
async function loadEligibleRequests(conn) {
  const [requests] = await conn.query(
    `
    SELECT sr.*
    FROM shift_requests sr
    INNER JOIN employees e ON e.id = sr.employee_id
    WHERE sr.can_work = TRUE
      AND e.is_active = TRUE
      AND e.role = 'waiter'
    `
  );

  return requests;
}

// Load and validate the exact DB inputs that the V1 scheduler is allowed to use.
async function loadSchedulingInputs(conn) {
  const employees = await loadEligibleEmployees(conn);
  const shifts = await loadOrderedShifts(conn);
  const requests = await loadEligibleRequests(conn);
  const weekStartDate = assertSingleWeekShifts(shifts);

  return {
    employees,
    shifts,
    requests,
    weekStartDate,
  };
}

// Return all employees so the health check can confirm the DB query path works.
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

// Return the filtered V1 scheduling inputs exactly as the generator sees them.
async function getSchedulingData() {
  let conn;

  try {
    conn = await createDbConnection();
    const { employees, shifts, requests } = await loadSchedulingInputs(conn);

    return {
      employees,
      shifts,
      shiftRequests: requests,
    };
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

// Generate, save, and summarize the single-week schedule stored in the database.
async function generateInitialSchedule() {
  let conn;

  try {
    conn = await createDbConnection();
    const { employees, shifts, requests, weekStartDate } =
      await loadSchedulingInputs(conn);
    const scheduleDraft = generateScheduleDraft(employees, shifts, requests);

    if (!weekStartDate || !scheduleDraft.weekStartDate) {
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
