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

function formatDateTimeValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
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
        INSERT IGNORE INTO shifts (
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
        setup_status,
        professionalism,
        responsibility,
        pressure_handling,
        seniority_months,
        potential
      FROM employees
      WHERE role IN (?)
        AND is_active = TRUE
        AND setup_status = 'complete'
      ORDER BY role, id
    `,
    [scheduleRoleValues]
  );

  return rows;
}

async function getAllEmployees() {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        full_name,
        role,
        is_active,
        setup_status,
        professionalism,
        responsibility,
        pressure_handling,
        seniority_months,
        potential
      FROM employees
      ORDER BY role, id
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

async function getShiftById(shiftId) {
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
      WHERE id = ?
      LIMIT 1
    `,
    [shiftId]
  );

  return rows[0] || null;
}

async function updateShiftRequiredStrength(shiftId, requiredStrengthScore) {
  await pool.query(
    `
      UPDATE shifts
      SET required_strength_score = ?
      WHERE id = ?
    `,
    [requiredStrengthScore, shiftId]
  );

  return getShiftById(shiftId);
}

async function updateShiftRequirements(shiftId, requirements) {
  await pool.query(
    `
      UPDATE shifts
      SET
        required_waiters = ?,
        required_bartenders = ?,
        required_shift_leaders = ?,
        required_strength_score = ?
      WHERE id = ?
    `,
    [
      requirements.requiredWaiters,
      requirements.requiredBartenders,
      requirements.requiredShiftLeaders,
      requirements.requiredStrengthScore,
      shiftId,
    ]
  );

  return getShiftById(shiftId);
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

async function getPerformanceLogsByWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  const [rows] = await pool.query(
    `
      SELECT
        shift_date,
        shift_type,
        created_at
      FROM shift_performance_logs
      WHERE shift_date BETWEEN ? AND ?
    `,
    [weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows.map((row) => ({
    shiftDate: formatDateKey(row.shift_date),
    shiftType: row.shift_type,
    createdAt: formatDateTimeValue(row.created_at),
  }));
}

async function getScheduleInputsByWeek(weekStartDate) {
  // מחשבים את תחילת וסוף השבוע לפי התאריך שהגיע מה-Frontend.
  const weekRange = getWeekRange(weekStartDate);

  // מביאים במקביל את כל הנתונים הדרושים לאלגוריתם.
  const [
    employees,
    allEmployees,
    shifts,
    shiftRequests,
    performanceLogs,
  ] = await Promise.all([
    // עובדים פעילים שרלוונטיים לשיבוץ.
    getActiveScheduleEmployees(),
    // כל העובדים, גם לצורך חישוב חוזק ושמירת שיבוצים קיימים.
    getAllEmployees(),
    // משמרות השבוע; אם חסרות משמרות, הפונקציה יוצרת אותן.
    ensureWeeklyShifts(weekRange.weekStartDate),
    // זמינות עובדים לשבוע הזה.
    getShiftRequestsByWeek(weekRange.weekStartDate),
    // פידבקים קודמים למשמרות, בעיקר להצגה/ML.
    getPerformanceLogsByWeek(weekRange.weekStartDate),
  ]);

  // זה האובייקט שנשלח ל-generateScheduleAlgorithm.
  return {
    weekStartDate: weekRange.weekStartDate,
    weekEndDate: weekRange.weekEndDate,
    employees,
    allEmployees,
    shifts,
    shiftRequests,
    performanceLogs,
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
  // מחפש את רשומת weekly_schedules של שבוע מסוים.
  const [rows] = await connection.query(
    `
      SELECT
        id,
        week_start_date,
        published_at
      FROM weekly_schedules
      WHERE week_start_date = ?
      LIMIT 1
    `,
    [weekStartDate]
  );

  return rows[0] || null;
}

async function getWeeklyScheduleById(connection, scheduleId) {
  // מחפש סידור לפי id, בעיקר לפרסום/שמירה/בדיקה.
  const [rows] = await connection.query(
    `
      SELECT
        id,
        week_start_date,
        published_at
      FROM weekly_schedules
      WHERE id = ?
      LIMIT 1
    `,
    [scheduleId]
  );

  return rows[0] || null;
}

async function getPersistedScheduleByWeek(weekStartDate) {
  // מביא סידור שכבר נשמר לשבוע, כולל כל השיבוצים שלו.
  const weekRange = getWeekRange(weekStartDate);
  await ensureWeeklyShifts(weekRange.weekStartDate);

  const connection = pool;
  const schedule = await getWeeklyScheduleByWeekStartDate(
    connection,
    weekRange.weekStartDate
  );

  if (!schedule) {
    // אין weekly_schedule לשבוע הזה.
    return null;
  }

  // assignment נשמר בטבלת schedule_assignments לפי schedule_id.
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
    // זה המבנה שה-service מקבל לפני buildScheduleBoardResponse.
    scheduleId: schedule.id,
    weekStartDate: formatDateKey(schedule.week_start_date),
    publishedAt: formatDateTimeValue(schedule.published_at),
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

async function ensureWeeklyScheduleByWeekStartDate(weekStartDate) {
  // יוצר רשומת סידור ריקה אם אין כזו לשבוע.
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

    await connection.commit();

    return {
      scheduleId,
      weekStartDate: weekRange.weekStartDate,
      publishedAt: formatDateTimeValue(existingSchedule?.published_at),
      assignments: [],
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getPersistedScheduleById(scheduleId) {
  // מוצא את השבוע לפי scheduleId ואז משתמש באותה פונקציה של שליפה לפי שבוע.
  const schedule = await getWeeklyScheduleById(pool, scheduleId);

  if (!schedule) {
    return null;
  }

  return getPersistedScheduleByWeek(formatDateKey(schedule.week_start_date));
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

async function touchWeeklySchedule(connection, scheduleId, options = {}) {
  const publishedClause = options.clearPublished ? ", published_at = NULL" : "";

  await connection.query(
    `
      UPDATE weekly_schedules
      SET updated_at = CURRENT_TIMESTAMP${publishedClause}
      WHERE id = ?
    `,
    [scheduleId]
  );
}

async function saveScheduleAssignments(weekStartDate, assignments, options = {}) {
  if (!assignments.length) {
    const error = new Error("Cannot save a schedule without assignments");
    error.statusCode = 400;
    throw error;
  }

  const weekRange = getWeekRange(weekStartDate);
  const connection = await pool.getConnection();

  try {
    // Transaction מוודא שמחיקה והכנסה של שיבוצים יקרו יחד.
    await connection.beginTransaction();

    // בודקים אם כבר קיים סידור לשבוע הזה.
    const existingSchedule = await getWeeklyScheduleByWeekStartDate(
      connection,
      weekRange.weekStartDate
    );

    // אם אין סידור, יוצרים weekly_schedule חדש; אם יש, משתמשים בו.
    const scheduleId = existingSchedule
      ? existingSchedule.id
      : await createWeeklySchedule(connection, weekRange.weekStartDate);

    if (existingSchedule) {
      // יצירה מחדש מחליפה את השיבוצים הישנים של אותו שבוע.
      await deleteScheduleAssignmentsByScheduleId(connection, scheduleId);
      // נגיעה בסידור מעדכנת updated_at ובדרך כלל מבטלת פרסום קודם.
      await touchWeeklySchedule(connection, scheduleId, {
        clearPublished: !options.preservePublished,
      });
    }

    // מכניסים את כל השיבוצים החדשים לטבלת schedule_assignments.
    const savedAssignmentCount = await insertScheduleAssignments(
      connection,
      scheduleId,
      assignments
    );

    // אם הכל הצליח, מאשרים את כל השינויים.
    await connection.commit();

    return {
      scheduleId,
      weekStartDate: weekRange.weekStartDate,
      publishedAt: options.preservePublished
        ? formatDateTimeValue(existingSchedule?.published_at)
        : null,
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

async function clearScheduleAssignments(scheduleId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const schedule = await getWeeklyScheduleById(connection, scheduleId);

    if (!schedule) {
      const error = new Error("Schedule not found");
      error.statusCode = 404;
      throw error;
    }

    const deletedAssignmentCount = await deleteScheduleAssignmentsByScheduleId(
      connection,
      scheduleId
    );

    await touchWeeklySchedule(connection, scheduleId, {
      clearPublished: true,
    });
    await connection.commit();

    return {
      scheduleId,
      weekStartDate: formatDateKey(schedule.week_start_date),
      publishedAt: null,
      deletedAssignmentCount,
    };
  } catch (error) {
    // אם משהו נכשל, מחזירים את ה-DB למצב הקודם.
    await connection.rollback();
    throw error;
  } finally {
    // משחררים את החיבור בכל מצב.
    connection.release();
  }
}

async function publishSchedule(scheduleId) {
  const connection = await pool.getConnection();

  try {
    // פרסום רץ ב-transaction כדי שהקריאה תחזור עם מצב DB עקבי.
    await connection.beginTransaction();

    // קודם בודקים שהסידור קיים.
    const schedule = await getWeeklyScheduleById(connection, scheduleId);

    if (!schedule) {
      const error = new Error("Schedule not found");
      error.statusCode = 404;
      throw error;
    }

    // סימון published_at אומר שהסידור גלוי כפורסם.
    await connection.query(
      `
        UPDATE weekly_schedules
        SET published_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [scheduleId]
    );

    // קוראים שוב את הרשומה כדי להחזיר את זמן הפרסום שנוצר במסד.
    const publishedSchedule = await getWeeklyScheduleById(connection, scheduleId);
    await connection.commit();

    return {
      scheduleId,
      weekStartDate: formatDateKey(publishedSchedule.week_start_date),
      publishedAt: formatDateTimeValue(publishedSchedule.published_at),
    };
  } catch (error) {
    // במקרה כשל מבטלים את כל שינוי הפרסום.
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function unpublishSchedule(scheduleId) {
  const connection = await pool.getConnection();

  try {
    // ביטול פרסום גם רץ ב-transaction.
    await connection.beginTransaction();

    // מוודאים שהסידור קיים לפני עדכון.
    const schedule = await getWeeklyScheduleById(connection, scheduleId);

    if (!schedule) {
      const error = new Error("Schedule not found");
      error.statusCode = 404;
      throw error;
    }

    // published_at = NULL אומר שהסידור כבר לא מפורסם.
    await connection.query(
      `
        UPDATE weekly_schedules
        SET published_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [scheduleId]
    );

    // מחזירים את הסידור אחרי האיפוס.
    const unpublishedSchedule = await getWeeklyScheduleById(connection, scheduleId);
    await connection.commit();

    return {
      scheduleId,
      weekStartDate: formatDateKey(unpublishedSchedule.week_start_date),
      publishedAt: null,
    };
  } catch (error) {
    // אם הביטול נכשל, מחזירים את הפרסום למצב הקודם.
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ensureWeeklyShifts,
  getActiveScheduleEmployees,
  getAllEmployees,
  getShiftsByWeek,
  getShiftById,
  updateShiftRequiredStrength,
  updateShiftRequirements,
  getShiftRequestsByWeek,
  getPerformanceLogsByWeek,
  getScheduleInputsByWeek,
  getWeeklyScheduleByWeekStartDate,
  getWeeklyScheduleById,
  getPersistedScheduleByWeek,
  ensureWeeklyScheduleByWeekStartDate,
  getPersistedScheduleById,
  saveScheduleAssignments,
  clearScheduleAssignments,
  publishSchedule,
  unpublishSchedule,
};
