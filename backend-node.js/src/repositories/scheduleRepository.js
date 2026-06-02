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

function getRoleRequirementExpression(jobRoleColumn = "posted_missing_shift_slots.job_role") {
  return `
    CASE ${jobRoleColumn}
      WHEN 'waiter' THEN shifts.required_waiters
      WHEN 'bartender' THEN shifts.required_bartenders
      WHEN 'shift_leader' THEN shifts.required_shift_leaders
      ELSE 0
    END
  `;
}

async function ensurePostedMissingShiftSlotsTable(connection = pool) {
  await connection.query(
    `
      CREATE TABLE IF NOT EXISTS posted_missing_shift_slots (
        id INT NOT NULL AUTO_INCREMENT,
        schedule_id INT NOT NULL,
        shift_id INT NOT NULL,
        job_role VARCHAR(30) NOT NULL,
        slot_index INT UNSIGNED NOT NULL,
        posted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        filled_at TIMESTAMP NULL DEFAULT NULL,
        filled_by_employee_id INT NULL,
        PRIMARY KEY (id),
        CONSTRAINT uq_posted_missing_shift_slots_slot
          UNIQUE (schedule_id, shift_id, job_role, slot_index),
        CONSTRAINT chk_posted_missing_shift_slots_slot_index
          CHECK (slot_index > 0),
        CONSTRAINT fk_posted_missing_shift_slots_schedule_id
          FOREIGN KEY (schedule_id) REFERENCES weekly_schedules (id)
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        CONSTRAINT fk_posted_missing_shift_slots_shift_id
          FOREIGN KEY (shift_id) REFERENCES shifts (id)
          ON DELETE RESTRICT
          ON UPDATE CASCADE,
        CONSTRAINT fk_posted_missing_shift_slots_filled_by_employee_id
          FOREIGN KEY (filled_by_employee_id) REFERENCES employees (id)
          ON DELETE SET NULL
          ON UPDATE CASCADE
      ) ENGINE=InnoDB
    `
  );
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

async function deletePostedMissingShiftSlotsByScheduleId(connection, scheduleId) {
  await ensurePostedMissingShiftSlotsTable(connection);
  const [result] = await connection.query(
    `
      DELETE FROM posted_missing_shift_slots
      WHERE schedule_id = ?
    `,
    [scheduleId]
  );

  return result.affectedRows;
}

async function getOpenPostedMissingSlotsByScheduleId(scheduleId) {
  await ensurePostedMissingShiftSlotsTable();
  const [rows] = await pool.query(
    `
      SELECT
        id,
        schedule_id,
        shift_id,
        job_role,
        slot_index,
        posted_at
      FROM posted_missing_shift_slots
      WHERE schedule_id = ?
        AND filled_at IS NULL
        AND filled_by_employee_id IS NULL
      ORDER BY shift_id, job_role, slot_index
    `,
    [scheduleId]
  );

  return rows.map((row) => ({
    slotId: row.id,
    scheduleId: row.schedule_id,
    shiftId: row.shift_id,
    jobRole: row.job_role,
    slotIndex: Number(row.slot_index),
    postedAt: formatDateTimeValue(row.posted_at),
  }));
}

async function postMissingShiftSlot(scheduleId, shiftId, jobRole, slotIndex) {
  await ensurePostedMissingShiftSlotsTable();
  await pool.query(
    `
      INSERT IGNORE INTO posted_missing_shift_slots (
        schedule_id,
        shift_id,
        job_role,
        slot_index
      )
      VALUES (?, ?, ?, ?)
    `,
    [scheduleId, shiftId, jobRole, slotIndex]
  );

  const [rows] = await pool.query(
    `
      SELECT
        id,
        schedule_id,
        shift_id,
        job_role,
        slot_index,
        posted_at
      FROM posted_missing_shift_slots
      WHERE schedule_id = ?
        AND shift_id = ?
        AND job_role = ?
        AND slot_index = ?
      LIMIT 1
    `,
    [scheduleId, shiftId, jobRole, slotIndex]
  );

  const row = rows[0];

  return row
    ? {
        slotId: row.id,
        scheduleId: row.schedule_id,
        shiftId: row.shift_id,
        jobRole: row.job_role,
        slotIndex: Number(row.slot_index),
        postedAt: formatDateTimeValue(row.posted_at),
      }
    : null;
}

async function unpostMissingShiftSlot(scheduleId, shiftId, jobRole, slotIndex) {
  await ensurePostedMissingShiftSlotsTable();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `
        SELECT
          id,
          filled_at,
          filled_by_employee_id
        FROM posted_missing_shift_slots
        WHERE schedule_id = ?
          AND shift_id = ?
          AND job_role = ?
          AND slot_index = ?
        LIMIT 1
        FOR UPDATE
      `,
      [scheduleId, shiftId, jobRole, slotIndex]
    );
    const slot = rows[0];

    if (!slot) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }

    if (slot.filled_at || slot.filled_by_employee_id) {
      await connection.rollback();
      return { ok: false, reason: "already_taken" };
    }

    await connection.query(
      `
        DELETE FROM posted_missing_shift_slots
        WHERE id = ?
      `,
      [slot.id]
    );

    await connection.commit();

    return { ok: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getAvailablePostedMissingSlotsForEmployee(employeeId, weekStartDate) {
  await ensurePostedMissingShiftSlotsTable();
  const weekRange = getWeekRange(weekStartDate);
  const requirementExpression = getRoleRequirementExpression();
  const [rows] = await pool.query(
    `
      SELECT
        posted_missing_shift_slots.id,
        posted_missing_shift_slots.schedule_id,
        posted_missing_shift_slots.shift_id,
        posted_missing_shift_slots.job_role,
        posted_missing_shift_slots.slot_index,
        posted_missing_shift_slots.posted_at,
        weekly_schedules.week_start_date,
        shifts.shift_date,
        shifts.shift_type
      FROM posted_missing_shift_slots
      INNER JOIN weekly_schedules
        ON weekly_schedules.id = posted_missing_shift_slots.schedule_id
      INNER JOIN shifts
        ON shifts.id = posted_missing_shift_slots.shift_id
      INNER JOIN employees
        ON employees.id = ?
      WHERE shifts.shift_date BETWEEN ? AND ?
        AND weekly_schedules.published_at IS NOT NULL
        AND posted_missing_shift_slots.filled_at IS NULL
        AND posted_missing_shift_slots.filled_by_employee_id IS NULL
        AND employees.is_active = TRUE
        AND employees.setup_status = 'complete'
        AND employees.role = posted_missing_shift_slots.job_role
        AND posted_missing_shift_slots.slot_index <= (
          ${requirementExpression} - (
            SELECT COUNT(*)
            FROM schedule_assignments AS assigned_role_slots
            WHERE assigned_role_slots.schedule_id = posted_missing_shift_slots.schedule_id
              AND assigned_role_slots.shift_id = posted_missing_shift_slots.shift_id
              AND assigned_role_slots.job_role = posted_missing_shift_slots.job_role
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM schedule_assignments AS employee_shift_assignments
          WHERE employee_shift_assignments.schedule_id = posted_missing_shift_slots.schedule_id
            AND employee_shift_assignments.shift_id = posted_missing_shift_slots.shift_id
            AND employee_shift_assignments.employee_id = employees.id
        )
      ORDER BY shifts.shift_date, shifts.shift_type, posted_missing_shift_slots.job_role, posted_missing_shift_slots.slot_index
    `,
    [employeeId, weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows.map((row) => ({
    slotId: row.id,
    scheduleId: row.schedule_id,
    shiftId: row.shift_id,
    shiftDate: formatDateKey(row.shift_date),
    shiftType: row.shift_type,
    weekStartDate: formatDateKey(row.week_start_date),
    jobRole: row.job_role,
    slotIndex: Number(row.slot_index),
    postedAt: formatDateTimeValue(row.posted_at),
  }));
}

async function fillPostedMissingShiftSlot(slotId, employeeId, assignedStrengthScore) {
  await ensurePostedMissingShiftSlotsTable();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [slotRows] = await connection.query(
      `
        SELECT
          posted_missing_shift_slots.id,
          posted_missing_shift_slots.schedule_id,
          posted_missing_shift_slots.shift_id,
          posted_missing_shift_slots.job_role,
          posted_missing_shift_slots.slot_index,
          posted_missing_shift_slots.filled_at,
          posted_missing_shift_slots.filled_by_employee_id,
          weekly_schedules.week_start_date,
          weekly_schedules.published_at,
          shifts.required_waiters,
          shifts.required_bartenders,
          shifts.required_shift_leaders,
          shifts.shift_date,
          shifts.shift_type,
          employees.role AS employee_role,
          employees.is_active AS employee_is_active,
          employees.setup_status AS employee_setup_status
        FROM posted_missing_shift_slots
        INNER JOIN weekly_schedules
          ON weekly_schedules.id = posted_missing_shift_slots.schedule_id
        INNER JOIN shifts
          ON shifts.id = posted_missing_shift_slots.shift_id
        LEFT JOIN employees
          ON employees.id = ?
        WHERE posted_missing_shift_slots.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [employeeId, slotId]
    );
    const slot = slotRows[0];

    if (!slot) {
      await connection.rollback();
      return { ok: false, reason: "not_found" };
    }

    await connection.query(
      `
        SELECT id
        FROM posted_missing_shift_slots
        WHERE schedule_id = ?
          AND shift_id = ?
          AND job_role = ?
        FOR UPDATE
      `,
      [slot.schedule_id, slot.shift_id, slot.job_role]
    );

    const requiredCount =
      slot.job_role === "waiter"
        ? Number(slot.required_waiters)
        : slot.job_role === "bartender"
          ? Number(slot.required_bartenders)
          : slot.job_role === "shift_leader"
            ? Number(slot.required_shift_leaders)
            : 0;

    const [roleCountRows] = await connection.query(
      `
        SELECT COUNT(*) AS assignment_count
        FROM schedule_assignments
        WHERE schedule_id = ?
          AND shift_id = ?
          AND job_role = ?
      `,
      [slot.schedule_id, slot.shift_id, slot.job_role]
    );
    const assignedRoleCount = Number(roleCountRows[0]?.assignment_count || 0);

    const [conflictRows] = await connection.query(
      `
        SELECT COUNT(*) AS conflict_count
        FROM schedule_assignments
        WHERE schedule_id = ?
          AND shift_id = ?
          AND employee_id = ?
      `,
      [slot.schedule_id, slot.shift_id, employeeId]
    );
    const conflictCount = Number(conflictRows[0]?.conflict_count || 0);

    if (slot.filled_at || slot.filled_by_employee_id) {
      await connection.rollback();
      return { ok: false, reason: "already_taken" };
    }

    if (!slot.published_at) {
      await connection.rollback();
      return { ok: false, reason: "not_published" };
    }

    if (slot.employee_role !== slot.job_role) {
      await connection.rollback();
      return { ok: false, reason: "role_mismatch" };
    }

    if (!slot.employee_is_active || slot.employee_setup_status !== "complete") {
      await connection.rollback();
      return { ok: false, reason: "inactive_employee" };
    }

    if (conflictCount > 0) {
      await connection.rollback();
      return { ok: false, reason: "conflicting_shift" };
    }

    if (assignedRoleCount >= requiredCount || Number(slot.slot_index) > requiredCount - assignedRoleCount) {
      await connection.rollback();
      return { ok: false, reason: "already_filled" };
    }

    try {
      await connection.query(
        `
          INSERT INTO schedule_assignments (
            schedule_id,
            shift_id,
            employee_id,
            job_role,
            assigned_strength_score
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          slot.schedule_id,
          slot.shift_id,
          employeeId,
          slot.job_role,
          assignedStrengthScore,
        ]
      );
    } catch (error) {
      await connection.rollback();
      return { ok: false, reason: "already_taken", error };
    }

    await connection.query(
      `
        UPDATE posted_missing_shift_slots
        SET filled_at = CURRENT_TIMESTAMP,
            filled_by_employee_id = ?
        WHERE id = ?
      `,
      [employeeId, slotId]
    );

    await touchWeeklySchedule(connection, slot.schedule_id, {
      clearPublished: false,
    });

    await connection.commit();

    return {
      ok: true,
      scheduleId: slot.schedule_id,
      weekStartDate: formatDateKey(slot.week_start_date),
      shiftId: slot.shift_id,
      jobRole: slot.job_role,
      slotId: slot.id,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
        ? formatDateTimeValue(
            (await getWeeklyScheduleById(connection, scheduleId))?.published_at
          )
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
    await deletePostedMissingShiftSlotsByScheduleId(connection, scheduleId);

    await touchWeeklySchedule(connection, scheduleId, {
      clearPublished: false,
    });
    await connection.commit();

    return {
      scheduleId,
      weekStartDate: formatDateKey(schedule.week_start_date),
      publishedAt: formatDateTimeValue(schedule.published_at),
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
  getOpenPostedMissingSlotsByScheduleId,
  postMissingShiftSlot,
  unpostMissingShiftSlot,
  getAvailablePostedMissingSlotsForEmployee,
  fillPostedMissingShiftSlot,
};
