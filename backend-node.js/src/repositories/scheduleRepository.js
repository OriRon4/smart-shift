const pool = require("../config/db");
const { getWeekRange } = require("../utils/week");

async function getActiveWaiterEmployees() {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        full_name,
        role,
        is_active,
        professionalism,
        responsibility,
        pressure_handling,
        seniority_months,
        potential
      FROM employees
      WHERE role = 'waiter'
        AND is_active = TRUE
      ORDER BY id
    `
  );

  return rows;
}

async function getShiftsByWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);

  const [rows] = await pool.query(
    `
      SELECT
        id,
        shift_date,
        shift_type,
        required_waiters,
        required_strength_score
      FROM shifts
      WHERE shift_date BETWEEN ? AND ?
      ORDER BY shift_date, shift_type
    `,
    [weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows;
}

async function getShiftRequestsByWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);

  const [rows] = await pool.query(
    `
      SELECT
        shift_requests.id,
        shift_requests.employee_id,
        shift_requests.shift_id,
        shifts.shift_date,
        shifts.shift_type
      FROM shift_requests
      INNER JOIN shifts
        ON shifts.id = shift_requests.shift_id
      WHERE shifts.shift_date BETWEEN ? AND ?
      ORDER BY shifts.shift_date, shifts.shift_type, shift_requests.employee_id
    `,
    [weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows;
}

async function getScheduleInputsByWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  const [employees, shifts, shiftRequests] = await Promise.all([
    getActiveWaiterEmployees(),
    getShiftsByWeek(weekRange.weekStartDate),
    getShiftRequestsByWeek(weekRange.weekStartDate),
  ]);

  return {
    weekStartDate: weekRange.weekStartDate,
    weekEndDate: weekRange.weekEndDate,
    employees,
    shifts,
    shiftRequests,
  };
}

async function createWeeklySchedule(connection, weekStartDate) {
  const [result] = await connection.query(
    `
      INSERT INTO weekly_schedules (
        week_start_date
      )
      VALUES (?)
    `,
    [weekStartDate]
  );

  return result.insertId;
}

async function getWeeklyScheduleByWeekStartDate(connection, weekStartDate) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        week_start_date
      FROM weekly_schedules
      WHERE week_start_date = ?
      LIMIT 1
    `,
    [weekStartDate]
  );

  return rows[0] || null;
}

async function insertScheduleAssignments(connection, scheduleId, assignments) {
  if (!assignments.length) {
    return 0;
  }

  const assignmentValues = assignments.map((assignment) => [
    scheduleId,
    assignment.shiftId,
    assignment.employeeId,
    assignment.assignedStrengthScore,
  ]);

  const [result] = await connection.query(
    `
      INSERT INTO schedule_assignments (
        schedule_id,
        shift_id,
        employee_id,
        assigned_strength_score
      )
      VALUES ?
    `,
    [assignmentValues]
  );

  return result.affectedRows;
}

async function saveGeneratedSchedule(weekStartDate, assignments) {
  if (!assignments.length) {
    const error = new Error(
      "Cannot save a generated schedule without assignments"
    );
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const existingSchedule = await getWeeklyScheduleByWeekStartDate(
      connection,
      weekStartDate
    );

    if (existingSchedule) {
      const error = new Error("Schedule already exists for this week");
      error.statusCode = 409;
      throw error;
    }

    const scheduleId = await createWeeklySchedule(connection, weekStartDate);
    const savedAssignmentCount = await insertScheduleAssignments(
      connection,
      scheduleId,
      assignments
    );

    await connection.commit();

    return {
      scheduleId,
      weekStartDate,
      savedAssignmentCount,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getActiveWaiterEmployees,
  getShiftsByWeek,
  getShiftRequestsByWeek,
  getScheduleInputsByWeek,
  createWeeklySchedule,
  getWeeklyScheduleByWeekStartDate,
  insertScheduleAssignments,
  saveGeneratedSchedule,
};
