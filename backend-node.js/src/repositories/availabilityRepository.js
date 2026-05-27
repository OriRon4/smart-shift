const pool = require("../config/db");
const scheduleRepository = require("./scheduleRepository");
const { getWeekRange } = require("../utils/week");

async function getShiftsForAvailability(weekStartDate) {
  // מוודא שיש 14 משמרות לשבוע ומחזיר אותן למסך הזמינות.
  return scheduleRepository.ensureWeeklyShifts(weekStartDate);
}

async function getAvailabilityForEmployee(employeeId, weekStartDate) {
  // מחשבים טווח שבוע כדי להביא רק בקשות של אותו שבוע.
  const weekRange = getWeekRange(weekStartDate);
  await scheduleRepository.ensureWeeklyShifts(weekRange.weekStartDate);

  // מחזיר רשימת shift_id שהעובד סימן כזמין.
  const [rows] = await pool.query(
    `
      SELECT
        shift_requests.shift_id
      FROM shift_requests
      INNER JOIN shifts
        ON shifts.id = shift_requests.shift_id
      WHERE shift_requests.employee_id = ?
        AND shifts.shift_date BETWEEN ? AND ?
      ORDER BY shifts.shift_date, shifts.shift_type
    `,
    [employeeId, weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows.map((row) => row.shift_id);
}

async function replaceAvailabilityForEmployee(employeeId, weekStartDate, shiftIds) {
  const weekRange = getWeekRange(weekStartDate);
  const shifts = await scheduleRepository.ensureWeeklyShifts(weekRange.weekStartDate);
  // Set של shiftId תקין -> משמרת קיימת בשבוע הזה.
  const validShiftIds = new Set(shifts.map((shift) => shift.id));
  // מנקים כפילויות ומוודאים שכל id מספרי.
  const selectedShiftIds = [...new Set(shiftIds.map(Number))];

  for (const shiftId of selectedShiftIds) {
    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      const error = new Error("shiftIds must contain positive integers");
      error.statusCode = 400;
      throw error;
    }

    if (!validShiftIds.has(shiftId)) {
      const error = new Error("All shiftIds must belong to the selected week");
      error.statusCode = 400;
      throw error;
    }
  }

  const connection = await pool.getConnection();

  try {
    // מחיקה והכנסה מתבצעות ב-transaction כדי לא להשאיר חצי שמירה.
    await connection.beginTransaction();

    // מוחקים את כל הזמינות הישנה של העובד באותו שבוע.
    await connection.query(
      `
        DELETE shift_requests
        FROM shift_requests
        INNER JOIN shifts
          ON shifts.id = shift_requests.shift_id
        WHERE shift_requests.employee_id = ?
          AND shifts.shift_date BETWEEN ? AND ?
      `,
      [employeeId, weekRange.weekStartDate, weekRange.weekEndDate]
    );

    if (selectedShiftIds.length) {
      // מכניסים את כל הבחירות החדשות לטבלת shift_requests.
      const values = selectedShiftIds.map((shiftId) => [employeeId, shiftId]);
      await connection.query(
        `
          INSERT INTO shift_requests (
            employee_id,
            shift_id
          )
          VALUES ?
        `,
        [values]
      );
    }

    await connection.commit();
  } catch (error) {
    // אם משהו נכשל, מחזירים את ה-DB למצב הקודם.
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return getAvailabilityForEmployee(employeeId, weekRange.weekStartDate);
}

async function getAllAvailability(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  await scheduleRepository.ensureWeeklyShifts(weekRange.weekStartDate);

  const [rows] = await pool.query(
    `
      SELECT
        employees.id AS employee_id,
        employees.full_name,
        employees.role,
        shifts.id AS shift_id,
        shifts.shift_date,
        shifts.shift_type
      FROM employees
      LEFT JOIN shift_requests
        ON shift_requests.employee_id = employees.id
        AND shift_requests.shift_id IN (
          SELECT id
          FROM shifts
          WHERE shift_date BETWEEN ? AND ?
        )
      LEFT JOIN shifts
        ON shifts.id = shift_requests.shift_id
      WHERE employees.is_active = TRUE
      ORDER BY employees.full_name, shifts.shift_date, shifts.shift_type
    `,
    [weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows;
}

module.exports = {
  getShiftsForAvailability,
  getAvailabilityForEmployee,
  replaceAvailabilityForEmployee,
  getAllAvailability,
};
