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

module.exports = {
  getActiveWaiterEmployees,
  getShiftsByWeek,
  getShiftRequestsByWeek,
  getScheduleInputsByWeek,
};
