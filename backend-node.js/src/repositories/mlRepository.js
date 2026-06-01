const pool = require("../config/db");
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

async function getPerformanceAverages() {
  const [byPatternRows] = await pool.query(
    `
      SELECT
        day_of_week,
        shift_type,
        AVG(actual_waiters_needed) AS avg_waiters_needed,
        AVG(actual_customers) AS avg_customers
      FROM shift_performance_logs
      GROUP BY day_of_week, shift_type
    `
  );
  const [byShiftTypeRows] = await pool.query(
    `
      SELECT
        shift_type,
        AVG(actual_waiters_needed) AS avg_waiters_needed,
        AVG(actual_customers) AS avg_customers
      FROM shift_performance_logs
      GROUP BY shift_type
    `
  );
  const [overallRows] = await pool.query(
    `
      SELECT
        AVG(actual_waiters_needed) AS avg_waiters_needed,
        AVG(actual_customers) AS avg_customers
      FROM shift_performance_logs
    `
  );

  return {
    byPattern: byPatternRows,
    byShiftType: byShiftTypeRows,
    overall: overallRows[0] || null,
  };
}

async function savePredictions(predictions) {
  if (!predictions.length) {
    return 0;
  }

  const values = predictions.map((prediction) => [
    prediction.shiftId,
    prediction.recommendedWaiters,
    prediction.recommendedStrengthScore ?? null,
    prediction.modelVersion,
  ]);

  const [result] = await pool.query(
    `
      INSERT INTO shift_ml_predictions (
        shift_id,
        recommended_waiters,
        recommended_strength_score,
        model_version
      )
      VALUES ?
      ON DUPLICATE KEY UPDATE
        recommended_waiters = VALUES(recommended_waiters),
        recommended_strength_score = VALUES(recommended_strength_score),
        model_version = VALUES(model_version),
        created_at = CURRENT_TIMESTAMP
    `,
    [values]
  );

  return result.affectedRows;
}

async function getPredictionsByWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  const [rows] = await pool.query(
    `
      SELECT
        shifts.id AS shift_id,
        shifts.shift_date,
        shifts.shift_type,
        shifts.required_waiters,
        shifts.required_strength_score,
        shift_ml_predictions.recommended_waiters,
        shift_ml_predictions.recommended_strength_score,
        shift_ml_predictions.model_version,
        shift_ml_predictions.created_at
      FROM shifts
      LEFT JOIN shift_ml_predictions
        ON shift_ml_predictions.shift_id = shifts.id
      WHERE shifts.shift_date BETWEEN ? AND ?
      ORDER BY shifts.shift_date, shifts.shift_type
    `,
    [weekRange.weekStartDate, weekRange.weekEndDate]
  );

  return rows.map((row) => ({
    shiftId: row.shift_id,
    shiftDate: formatDateKey(row.shift_date),
    shiftType: row.shift_type,
    currentWaiters: Number(row.required_waiters),
    currentStrengthScore: Number(row.required_strength_score),
    recommendedWaiters:
      row.recommended_waiters === null ? null : Number(row.recommended_waiters),
    recommendedStrengthScore:
      row.recommended_strength_score === null
        ? null
        : Number(row.recommended_strength_score),
    modelVersion: row.model_version || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

async function getPredictionByShiftId(shiftId) {
  const [rows] = await pool.query(
    `
      SELECT
        shift_id,
        recommended_waiters,
        recommended_strength_score,
        model_version,
        created_at
      FROM shift_ml_predictions
      WHERE shift_id = ?
      LIMIT 1
    `,
    [shiftId]
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    shiftId: row.shift_id,
    recommendedWaiters: Number(row.recommended_waiters),
    recommendedStrengthScore:
      row.recommended_strength_score === null
        ? null
        : Number(row.recommended_strength_score),
    modelVersion: row.model_version,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function getPerformanceLogByShift(shift) {
  const [rows] = await pool.query(
    `
      SELECT
        id,
        shift_id,
        shift_date,
        shift_type,
        scheduled_waiters,
        actual_customers,
        actual_waiters_needed,
        manager_rating,
        waiter_gap,
        was_understaffed,
        was_overstaffed,
        is_synthetic,
        created_at
      FROM shift_performance_logs
      WHERE shift_id = ?
        OR (shift_id IS NULL AND shift_date = ? AND shift_type = ? AND is_synthetic = FALSE)
      LIMIT 1
    `,
    [shift.id, formatDateKey(shift.shift_date), shift.shift_type]
  );

  return rows[0] || null;
}

async function saveShiftPerformanceLog(log) {
  const [result] = await pool.query(
    `
      INSERT INTO shift_performance_logs (
        shift_id,
        shift_date,
        shift_type,
        day_of_week,
        is_weekend,
        scheduled_waiters,
        actual_customers,
        actual_waiters_needed,
        manager_rating,
        waiter_gap,
        was_understaffed,
        was_overstaffed,
        is_synthetic,
        expected_customer_load,
        actual_waiters_count,
        actual_strength_score
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        shift_date = VALUES(shift_date),
        shift_type = VALUES(shift_type),
        day_of_week = VALUES(day_of_week),
        is_weekend = VALUES(is_weekend),
        scheduled_waiters = VALUES(scheduled_waiters),
        actual_customers = VALUES(actual_customers),
        actual_waiters_needed = VALUES(actual_waiters_needed),
        manager_rating = VALUES(manager_rating),
        waiter_gap = VALUES(waiter_gap),
        was_understaffed = VALUES(was_understaffed),
        was_overstaffed = VALUES(was_overstaffed),
        is_synthetic = VALUES(is_synthetic),
        expected_customer_load = VALUES(expected_customer_load),
        actual_waiters_count = VALUES(actual_waiters_count),
        actual_strength_score = VALUES(actual_strength_score),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      log.shiftId,
      log.shiftDate,
      log.shiftType,
      log.dayOfWeek,
      log.isWeekend,
      log.scheduledWaiters,
      log.actualCustomers,
      log.actualWaitersNeeded,
      log.managerRating,
      log.waiterGap,
      log.wasUnderstaffed,
      log.wasOverstaffed,
      log.isSynthetic,
      log.actualCustomers,
      log.actualWaitersNeeded,
      log.actualStrengthScore ?? null,
    ]
  );

  return result.insertId;
}

module.exports = {
  getPerformanceAverages,
  savePredictions,
  getPredictionsByWeek,
  getPredictionByShiftId,
  getPerformanceLogByShift,
  saveShiftPerformanceLog,
};
