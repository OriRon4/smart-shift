const pool = require("../config/db");

function mapEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    phone_number: row.phone_number,
    jobRole: row.role,
    role: row.role,
    email: row.email || null,
    username: row.username || null,
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
        employees.id,
        employees.full_name,
        employees.phone_number,
        employees.role,
        users.email,
        users.username,
        employees.is_active,
        employees.setup_status,
        employees.professionalism,
        employees.responsibility,
        employees.pressure_handling,
        employees.seniority_months,
        employees.potential
      FROM employees
      LEFT JOIN users
        ON users.employee_id = employees.id
      ORDER BY employees.is_active DESC, employees.full_name
    `
  );

  return rows.map(mapEmployee);
}

async function getEmployeeById(employeeId) {
  const [rows] = await pool.query(
    `
      SELECT
        employees.id,
        employees.full_name,
        employees.phone_number,
        employees.role,
        users.email,
        users.username,
        employees.is_active,
        employees.setup_status,
        employees.professionalism,
        employees.responsibility,
        employees.pressure_handling,
        employees.seniority_months,
        employees.potential
      FROM employees
      LEFT JOIN users
        ON users.employee_id = employees.id
      WHERE employees.id = ?
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

async function updateLinkedUserEmail(employeeId, email) {
  await pool.query(
    `
      UPDATE users
      SET email = ?
      WHERE employee_id = ?
    `,
    [email, employeeId]
  );
}

async function deleteEmployee(employeeId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      `
        DELETE FROM schedule_assignments
        WHERE employee_id = ?
      `,
      [employeeId]
    );

    await connection.query(
      `
        DELETE FROM shift_requests
        WHERE employee_id = ?
      `,
      [employeeId]
    );

    await connection.query(
      `
        DELETE FROM users
        WHERE employee_id = ?
      `,
      [employeeId]
    );

    const [result] = await connection.query(
      `
        DELETE FROM employees
        WHERE id = ?
      `,
      [employeeId]
    );

    await connection.commit();
    return result.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getEmployees,
  getEmployeeById,
  updateEmployee,
  updateLinkedUserActiveState,
  updateLinkedUserEmail,
  deleteEmployee,
};
