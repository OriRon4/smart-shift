const pool = require("../config/db");
const { SCHEDULE_JOB_ROLES } = require("../constants/roles");
const { getWeekRange } = require("../utils/week");

function formatDateKey(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function addDays(dateKey, dayOffset) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + dayOffset);
  return formatDateKey(date);
}

async function ensureWeeklyShifts(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  const existingShifts = await getShiftsByWeek(weekRange.weekStartDate);
  const existingKeys = new Set(
    existingShifts.map(
      (shift) => `${formatDateKey(shift.shift_date)}:${shift.shift_type}`
    )
  );
  const missingValues = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const shiftDate = addDays(weekRange.weekStartDate, dayOffset);

    for (const shiftType of ["morning", "evening"]) {
      const key = `${shiftDate}:${shiftType}`;

      if (!existingKeys.has(key)) {
        const isMorning = shiftType === "morning";
        missingValues.push([
          shiftDate,
          shiftType,
          isMorning ? 3 : 5,
          1,
          1,
          isMorning ? 21 : 37.5,
        ]);
      }
    }
  }

  if (missingValues.length) {
    await pool.query(
      `
        INSERT INTO shifts (
          shift_date,
          shift_type,
          required_waiters,
          required_bartenders,
          required_shift_leaders,
          required_strength_score
        )
        VALUES ?
      `,
      [missingValues]
    );
  }

  return getShiftsByWeek(weekRange.weekStartDate);
}

async function getActiveScheduleEmployees() {
  const scheduleRoleValues = SCHEDULE_JOB_ROLES.map(
    (roleConfig) => roleConfig.jobRole
  );
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
      WHERE role IN (?)
        AND is_active = TRUE
      ORDER BY role, id
    `,
    [scheduleRoleValues]
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
        required_bartenders,
        required_shift_leaders,
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
    getActiveScheduleEmployees(),
    ensureWeeklyShifts(weekRange.weekStartDate),
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

async function getPersistedScheduleByWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  await ensureWeeklyShifts(weekRange.weekStartDate);

  const connection = pool;
  const schedule = await getWeeklyScheduleByWeekStartDate(
    connection,
    weekRange.weekStartDate
  );

  if (!schedule) {
    return null;
  }

  const [assignments] = await pool.query(
    `
      SELECT
        schedule_assignments.id,
        schedule_assignments.schedule_id,
        schedule_assignments.shift_id,
        schedule_assignments.employee_id,
        schedule_assignments.job_role,
        schedule_assignments.assigned_strength_score
      FROM schedule_assignments
      INNER JOIN shifts
        ON shifts.id = schedule_assignments.shift_id
      WHERE schedule_assignments.schedule_id = ?
      ORDER BY shifts.shift_date, shifts.shift_type, schedule_assignments.job_role
    `,
    [schedule.id]
  );

  return {
    scheduleId: schedule.id,
    weekStartDate: formatDateKey(schedule.week_start_date),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      scheduleId: assignment.schedule_id,
      shiftId: assignment.shift_id,
      employeeId: assignment.employee_id,
      jobRole: assignment.job_role,
      assignedStrengthScore: Number(assignment.assigned_strength_score),
    })),
  };
}

async function insertScheduleAssignments(connection, scheduleId, assignments) {
  if (!assignments.length) {
    return 0;
  }

  const assignmentValues = assignments.map((assignment) => [
    scheduleId,
    assignment.shiftId,
    assignment.employeeId,
    assignment.jobRole,
    assignment.assignedStrengthScore,
  ]);

  const [result] = await connection.query(
    `
      INSERT INTO schedule_assignments (
        schedule_id,
        shift_id,
        employee_id,
        job_role,
        assigned_strength_score
      )
      VALUES ?
    `,
    [assignmentValues]
  );

  return result.affectedRows;
}

async function deleteScheduleAssignmentsByScheduleId(connection, scheduleId) {
  const [result] = await connection.query(
    `
      DELETE FROM schedule_assignments
      WHERE schedule_id = ?
    `,
    [scheduleId]
  );

  return result.affectedRows;
}

async function touchWeeklySchedule(connection, scheduleId) {
  await connection.query(
    `
      UPDATE weekly_schedules
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [scheduleId]
  );
}

async function saveScheduleAssignments(weekStartDate, assignments) {
  if (!assignments.length) {
    const error = new Error("Cannot save a schedule without assignments");
    error.statusCode = 400;
    throw error;
  }

  const weekRange = getWeekRange(weekStartDate);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const existingSchedule = await getWeeklyScheduleByWeekStartDate(
      connection,
      weekRange.weekStartDate
    );

    const scheduleId = existingSchedule
      ? existingSchedule.id
      : await createWeeklySchedule(connection, weekRange.weekStartDate);

    if (existingSchedule) {
      await deleteScheduleAssignmentsByScheduleId(connection, scheduleId);
      await touchWeeklySchedule(connection, scheduleId);
    }

    const savedAssignmentCount = await insertScheduleAssignments(
      connection,
      scheduleId,
      assignments
    );

    await connection.commit();

    return {
      scheduleId,
      weekStartDate: weekRange.weekStartDate,
      savedAssignmentCount,
      replacedExisting: Boolean(existingSchedule),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ensureWeeklyShifts,
  getActiveScheduleEmployees,
  getShiftsByWeek,
  getShiftRequestsByWeek,
  getScheduleInputsByWeek,
  getWeeklyScheduleByWeekStartDate,
  getPersistedScheduleByWeek,
  saveScheduleAssignments,
};
