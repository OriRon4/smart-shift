const pool = require("../config/db");

function mapEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    jobRole: row.role,
    isActive: Boolean(row.is_active),
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
        role,
        is_active,
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
        role,
        is_active,
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
        role = ?,
        is_active = ?,
        professionalism = ?,
        responsibility = ?,
        pressure_handling = ?,
        seniority_months = ?,
        potential = ?
      WHERE id = ?
    `,
    [
      employee.fullName,
      employee.jobRole,
      employee.isActive,
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

async function deactivateEmployee(employeeId) {
  await pool.query(
    `
      UPDATE employees
      SET is_active = FALSE
      WHERE id = ?
    `,
    [employeeId]
  );

  return getEmployeeById(employeeId);
}

module.exports = {
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
};
