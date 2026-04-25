// מחשבת כמה קשה לכסות משמרת לפי היחס בין מספר העובדים הנדרש לבין מספר העובדים הזמינים.
function calculateCoveragePressure(requiredWaiters, availableWorkers) {
  // משתמשים ב-Math.max כדי למנוע חלוקה באפס במקרה שאין עובדים זמינים.
  return requiredWaiters / Math.max(1, availableWorkers);
}

// מחשבת את ציון העדיפות של המשמרת לפי לחץ כיסוי ודרישת החוזק שלה.
function calculatePriorityOrderScore(
  requiredWaiters,
  requiredStrengthScore,
  availableWorkers
) {
  const coveragePressure = calculateCoveragePressure(
    requiredWaiters,
    availableWorkers
  );
  // ממירים את דרישת החוזק של המשמרת ליחס פשוט שאפשר לשלב בנוסחת העדיפות.
  const strengthRequirementRatio =
    Number(requiredStrengthScore) / Math.max(1, requiredWaiters * 10);

  return 0.6 * coveragePressure + 0.4 * strengthRequirementRatio;
}

// מסדרת את המשמרות לפי סדר עבודה, מהכי דחופה להכי פחות דחופה.
function orderShiftsByPriority(shifts, shiftRequests, excludedShiftIds = []) {
  const excludedShiftIdSet = new Set(excludedShiftIds);
  // key: shiftId -> value: מספר העובדים הזמינים שביקשו את המשמרת.
  const availableWorkersByShiftId = new Map();

  // סופרים כמה עובדים ביקשו כל משמרת כדי לדעת מה רמת הזמינות שלה.
  for (const shiftRequest of shiftRequests) {
    const currentAvailableWorkerCount =
      availableWorkersByShiftId.get(shiftRequest.shift_id) || 0;

    availableWorkersByShiftId.set(
      shiftRequest.shift_id,
      currentAvailableWorkerCount + 1
    );
  }

  return shifts
    // מוציאים מהרשימה משמרות שכבר טופלו קודם, למשל משמרות כפויות.
    .filter((shift) => !excludedShiftIdSet.has(shift.id))
    // מוסיפים לכל משמרת את ערכי העזר הדרושים לפני פעולת המיון.
    .map((shift) => {
      const availableWorkers = availableWorkersByShiftId.get(shift.id) || 0;
      const coveragePressure = calculateCoveragePressure(
        shift.required_waiters,
        availableWorkers
      );
      const priorityOrderScore = calculatePriorityOrderScore(
        shift.required_waiters,
        shift.required_strength_score,
        availableWorkers
      );

      return {
        ...shift,
        availableWorkers,
        coveragePressure,
        priorityOrderScore,
      };
    })
    // ממיינים כך שמשמרות עם ציון עדיפות גבוה יותר יטופלו קודם.
    .sort((leftShift, rightShift) => {
      if (rightShift.priorityOrderScore !== leftShift.priorityOrderScore) {
        return rightShift.priorityOrderScore - leftShift.priorityOrderScore;
      }

      return leftShift.id - rightShift.id;
    });
}

module.exports = {
  calculateCoveragePressure,
  calculatePriorityOrderScore,
  orderShiftsByPriority,
};
