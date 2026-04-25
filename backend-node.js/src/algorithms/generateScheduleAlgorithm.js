const {
  findForcedShifts,
  buildForcedAssignments,
} = require("./forcedAssignmentUtils");
const { assignRemainingShifts } = require("./assignmentFlow");
const {
  buildShiftValidationSummaries,
} = require("./shiftValidationUtils");

// מריץ את שלבי האלגוריתם של V1 לפי הסדר הלוגי שלהם.
function generateScheduleAlgorithm(scheduleInputs) {
  // שלב 1: מאתרים משמרות שבהן ההשמה כפויה כי אין מספיק מועמדים לבחירה.
  const forcedShifts = findForcedShifts(
    scheduleInputs.shifts,
    scheduleInputs.shiftRequests
  );

  // שלב 2: הופכים את המשמרות הכפויות לרשומות השמה בסיסיות.
  const forcedAssignments = buildForcedAssignments(forcedShifts);

  // שלב 3: משבצים את שאר המשמרות לפי סדר עדיפות ודירוג מועמדים.
  const assignmentResult = assignRemainingShifts(
    scheduleInputs,
    forcedAssignments
  );

  // שלב 4: בונים סיכום בדיקה לכל משמרת אחרי שכל ההשמות הושלמו.
  const shiftValidationSummaries = buildShiftValidationSummaries(
    scheduleInputs.shifts,
    assignmentResult.allAssignments,
    scheduleInputs.employees
  );

  return {
    forcedShifts,
    forcedAssignments,
    orderedShifts: assignmentResult.orderedShifts,
    remainingAssignments: assignmentResult.remainingAssignments,
    allAssignments: assignmentResult.allAssignments,
    shiftValidationSummaries,
  };
}

module.exports = {
  generateScheduleAlgorithm,
};
