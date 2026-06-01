const pool = require("../config/db");

function mapUser(row) {
  // ממיר שורה מה-DB לאובייקט user שה-service עובד איתו.
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
    employeeIsActive:
      row.employee_is_active === null || row.employee_is_active === undefined
        ? null
        : Boolean(row.employee_is_active),
    setupStatus: row.setup_status || null,
    displayName: row.full_name || row.username,
    jobRole: row.employee_role || null,
  };
}

async function findUserByLogin(login) {
  // מחפש משתמש לפי username או email ומצרף נתוני עובד אם קיימים.
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
        employees.is_active AS employee_is_active,
        employees.setup_status,
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
  // משמש את requireAuth: בדיקה שה-userId מתוך ה-token עדיין קיים.
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
        employees.is_active AS employee_is_active,
        employees.setup_status,
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
          phone_number,
          role,
          is_active,
          setup_status,
          professionalism,
          responsibility,
          pressure_handling,
          seniority_months,
          potential
        )
        VALUES (?, ?, 'waiter', FALSE, 'pending', 0, 0, 0, 0, 0)
      `,
      [worker.fullName, worker.phoneNumber]
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
        VALUES (?, ?, ?, ?, 'employee', FALSE)
      `,
      [employeeId, worker.username, worker.email, worker.passwordHash]
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

async function updateUserPasswordHash(userId, passwordHash) {
  await pool.query(
    `
      UPDATE users
      SET password_hash = ?
      WHERE id = ?
    `,
    [passwordHash, userId]
  );
}

module.exports = {
  findUserByLogin,
  findUserById,
  createWorkerUser,
  updateUserPasswordHash,
};
