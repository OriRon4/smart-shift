const pool = require("../config/db");

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    employeeId: row.employee_id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    permissionRole: row.permission_role,
    isActive: Boolean(row.is_active),
    displayName: row.full_name || row.username,
    jobRole: row.employee_role || null,
  };
}

async function findUserByLogin(login) {
  const [rows] = await pool.query(
    `
      SELECT
        users.id,
        users.employee_id,
        users.username,
        users.email,
        users.password_hash,
        users.permission_role,
        users.is_active,
        employees.full_name,
        employees.role AS employee_role
      FROM users
      LEFT JOIN employees
        ON employees.id = users.employee_id
      WHERE users.username = ?
        OR users.email = ?
      LIMIT 1
    `,
    [login, login]
  );

  return mapUser(rows[0]);
}

async function findUserById(userId) {
  const [rows] = await pool.query(
    `
      SELECT
        users.id,
        users.employee_id,
        users.username,
        users.email,
        users.password_hash,
        users.permission_role,
        users.is_active,
        employees.full_name,
        employees.role AS employee_role
      FROM users
      LEFT JOIN employees
        ON employees.id = users.employee_id
      WHERE users.id = ?
      LIMIT 1
    `,
    [userId]
  );

  return mapUser(rows[0]);
}

async function createWorkerUser(worker) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [employeeResult] = await connection.query(
      `
        INSERT INTO employees (
          full_name,
          role,
          is_active,
          professionalism,
          responsibility,
          pressure_handling,
          seniority_months,
          potential
        )
        VALUES (?, 'waiter', TRUE, 0, 0, 0, 0, 0)
      `,
      [worker.fullName]
    );

    const employeeId = employeeResult.insertId;

    const [userResult] = await connection.query(
      `
        INSERT INTO users (
          employee_id,
          username,
          email,
          password_hash,
          permission_role,
          is_active
        )
        VALUES (?, ?, ?, ?, 'employee', TRUE)
      `,
      [employeeId, worker.username, worker.email, worker.password]
    );

    await connection.commit();

    return findUserById(userResult.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  findUserByLogin,
  findUserById,
  createWorkerUser,
};
