const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

const dbConfig = {
  host: "localhost",
  user: "smartshift_user",
  password: "smartshift_pass",
  database: "smartshift",
  port: 3306,
};

// בדיקה שהשרת חי
app.get("/", (req, res) => {
  res.send("Smart-Shift Server is running");
});

// בדיקת חיבור ל-DB
app.get("/test-db", async (req, res) => {
  try {
    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.query("SELECT * FROM employees");

    await conn.end();

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// שליפת נתונים לאלגוריתם
app.get("/data-for-scheduling", async (req, res) => {
  let conn;

  try {
    conn = await mysql.createConnection(dbConfig);

    const [employees] = await conn.query("SELECT * FROM employees");
    const [shifts] = await conn.query("SELECT * FROM shifts");
    const [shiftRequests] = await conn.query("SELECT * FROM shift_requests");

    res.json({
      employees,
      shifts,
      shiftRequests,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

// פונקציית חישוב חוזק עובד
function calculateWorkerStrength(employee) {
  const professionalism = Number(employee.professionalism || 0);
  const responsibility = Number(employee.responsibility || 0);
  const pressureHandling = Number(employee.pressure_handling || 0);

  const strength =
    professionalism * 0.4 +
    responsibility * 0.4 +
    pressureHandling * 0.2;

  return Number(strength.toFixed(2));
}

// 🚀 שיבוץ ראשוני לפי חוזק בלבד
app.post("/generate-schedule", async (req, res) => {
  let conn;

  try {
    conn = await mysql.createConnection(dbConfig);

    // 1. שליפת נתונים
    const [employees] = await conn.query(
      "SELECT * FROM employees WHERE is_active = TRUE"
    );
    const [shifts] = await conn.query(
      "SELECT * FROM shifts ORDER BY shift_date, shift_type"
    );
    const [requests] = await conn.query(
      "SELECT * FROM shift_requests WHERE can_work = TRUE"
    );

    // 2. יצירת schedule חדש
    const [scheduleResult] = await conn.query(`
      INSERT INTO weekly_schedules (week_start_date, created_by, status)
      VALUES (CURDATE(), 'system', 'draft')
    `);

    const scheduleId = scheduleResult.insertId;

    // 3. העשרת העובדים (חוזק + מונה משמרות)
    const enrichedEmployees = employees.map(emp => ({
      ...emp,
      strength: calculateWorkerStrength(emp),
      assignedCount: 0 // ✅ חשוב להוגנות בהמשך
    }));

    // 4. שיבוץ בזיכרון
    const assignments = [];

    for (const shift of shifts) {
      // עובדים שיכולים לעבוד במשמרת
      const availableEmployees = enrichedEmployees.filter(emp =>
        requests.some(
          r => r.employee_id === emp.id && r.shift_id === shift.id
        )
      );

      // מיון לפי חוזק
      availableEmployees.sort((a, b) => b.strength - a.strength);

      // בחירת עובדים
      const selected = availableEmployees.slice(0, shift.required_waiters);

      for (const emp of selected) {
        emp.assignedCount++; // ✅ עדכון בזיכרון

        assignments.push([
          scheduleId,
          shift.id,
          emp.id,
          emp.strength
        ]);
      }
    }

    // 5. הכנסת הכל ל-DB במכה אחת
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

    res.json({
      message: "Initial schedule created",
      scheduleId,
      assignments: assignments.length,
      debugAssignedCounts: enrichedEmployees.map(e => ({
        name: e.full_name,
        assigned: e.assignedCount
      }))
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.end();
  }
});

app.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});