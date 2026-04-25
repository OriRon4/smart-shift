const { calculateStrengthScore } = require("./workerStrengthUtils");

// בונה לכל משמרת סיכום בדיקה של כיסוי וכוח צוות אחרי שההשמות הסתיימו.
function buildShiftValidationSummaries(shifts, assignments, employees) {
  // מחשבים מראש את ציון החוזק של כל עובד כדי להשתמש בו בזמן סיכום המשמרות.
  // key: employeeId -> value: strengthScore של העובד.
  const strengthScoreByEmployeeId = new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
  // key: shiftId -> value: סיכום ביניים של assignedCount ו-assignedStrengthScore.
  const assignmentSummaryByShiftId = new Map();

  // מסכמים לכל משמרת כמה עובדים שובצו ומהו סכום החוזק הכולל שלהם.
  for (const assignment of assignments) {
    const existingSummary =
      assignmentSummaryByShiftId.get(assignment.shiftId) || {
        assignedCount: 0,
        assignedStrengthScore: 0,
      };

    existingSummary.assignedCount += 1;
    existingSummary.assignedStrengthScore +=
      strengthScoreByEmployeeId.get(assignment.employeeId) || 0;

    assignmentSummaryByShiftId.set(assignment.shiftId, existingSummary);
  }

  // Return the final V1 validation fields for every shift.
  // מחזירים לכל משמרת את שדות הבדיקה ש-V1 צריך להציג או להשתמש בהם בהמשך.
  return shifts.map((shift) => {
    const summary = assignmentSummaryByShiftId.get(shift.id) || {
      assignedCount: 0,
      assignedStrengthScore: 0,
    };

    return {
      shiftId: shift.id,
      assignedStrengthScore: summary.assignedStrengthScore,
      meetsStrengthTarget:
        summary.assignedStrengthScore >= Number(shift.required_strength_score),
      uncoveredSlots: Math.max(0, shift.required_waiters - summary.assignedCount),
      assignedCount: summary.assignedCount,
    };
  });
}

module.exports = {
  buildShiftValidationSummaries,
};
