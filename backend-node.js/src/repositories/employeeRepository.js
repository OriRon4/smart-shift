const pool = require("../config/db");

function mapEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    phone_number: row.phone_number,
    jobRole: row.role,
    role: row.role,
    isActive: Boolean(row.is_active),
    setupStatus: row.setup_status || "complete",
    professionalism: Number(row.professionalism),
    responsibility: Number(row.responsibility),
    pressureHandling: Number(row.pressure_handling),
    seniorityMonths: Number(row.seniority_months),
    potential: Number(row.potential),
  };
}

async function getEmployees() {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        full_name,
        phone_number,
        role,
        is_active,
        setup_status,
        professionalism,
        responsibility,
        pressure_handling,
        seniority_months,
        potential
      FROM employees
      ORDER BY is_active DESC, full_name
    `
  );

  return rows.map(mapEmployee);
}

async function getEmployeeById(employeeId) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        full_name,
        phone_number,
        role,
        is_active,
        setup_status,
        professionalism,
        responsibility,
        pressure_handling,
        seniority_months,
        potential
      FROM employees
      WHERE id = ?
      LIMIT 1
    `,
    [employeeId]
  );

  return rows[0] ? mapEmployee(rows[0]) : null;
}

async function updateEmployee(employeeId, employee) {
  await pool.query(
    `
      UPDATE employees
      SET
        full_name = ?,
        phone_number = ?,
        role = ?,
        is_active = ?,
        setup_status = ?,
        professionalism = ?,
        responsibility = ?,
        pressure_handling = ?,
        seniority_months = ?,
        potential = ?
      WHERE id = ?
    `,
    [
      employee.fullName,
      employee.phoneNumber,
      employee.jobRole,
      employee.isActive,
      employee.setupStatus,
      employee.professionalism,
      employee.responsibility,
      employee.pressureHandling,
      employee.seniorityMonths,
      employee.potential,
      employeeId,
    ]
  );

  return getEmployeeById(employeeId);
}

async function updateLinkedUserActiveState(employeeId, isActive) {
  await pool.query(
    `
      UPDATE users
      SET is_active = ?
      WHERE employee_id = ?
        AND permission_role = 'employee'
    `,
    [isActive, employeeId]
  );
}

module.exports = {
  getEmployees,
  getEmployeeById,
  updateEmployee,
  updateLinkedUserActiveState,
};
