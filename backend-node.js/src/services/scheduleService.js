const { createDbConnection } = require("../config/db");
const { calculateWorkerStrength } = require("../utils/strength");

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

async function getSchedulingData() {
  let conn;

  try {
    conn = await createDbConnection();

    const [employees] = await conn.query("SELECT * FROM employees");
    const [shifts] = await conn.query("SELECT * FROM shifts");
    const [shiftRequests] = await conn.query("SELECT * FROM shift_requests");

    return {
      employees,
      shifts,
      shiftRequests,
    };
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

function getAvailableEmployeesForShift(enrichedEmployees, requests, shiftId) {
  return enrichedEmployees.filter((employee) =>
    requests.some(
      (request) =>
        request.employee_id === employee.id && request.shift_id === shiftId
    )
  );
}

async function generateInitialSchedule() {
  let conn;

  try {
    conn = await createDbConnection();

    const [employees] = await conn.query(
      "SELECT * FROM employees WHERE is_active = TRUE"
    );
    const [shifts] = await conn.query(
      "SELECT * FROM shifts ORDER BY shift_date, shift_type"
    );
    const [requests] = await conn.query(
      "SELECT * FROM shift_requests WHERE can_work = TRUE"
    );

    const [scheduleResult] = await conn.query(`
      INSERT INTO weekly_schedules (week_start_date, created_by, status)
      VALUES (CURDATE(), 'system', 'draft')
    `);

    const scheduleId = scheduleResult.insertId;
    const enrichedEmployees = employees.map((employee) => ({
      ...employee,
      strength: calculateWorkerStrength(employee),
      assignedCount: 0,
    }));
    const assignments = [];

    for (const shift of shifts) {
      const availableEmployees = getAvailableEmployeesForShift(
        enrichedEmployees,
        requests,
        shift.id
      );

      availableEmployees.sort((a, b) => b.strength - a.strength);

      const selectedEmployees = availableEmployees.slice(
        0,
        shift.required_waiters
      );

      for (const employee of selectedEmployees) {
        employee.assignedCount += 1;

        assignments.push([
          scheduleId,
          shift.id,
          employee.id,
          employee.strength,
        ]);
      }
    }

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
      message: "Initial schedule created",
      scheduleId,
      assignments: assignments.length,
      debugAssignedCounts: enrichedEmployees.map((employee) => ({
        name: employee.full_name,
        assigned: employee.assignedCount,
      })),
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
