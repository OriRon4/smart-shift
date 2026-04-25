const {
  calculateStrengthScore,
  calculateNormalizedStrength,
} = require("./workerStrengthUtils");
const {
  calculateTargetShifts,
  calculateFairnessGap,
  calculateFairnessGapScore,
} = require("./targetShiftUtils");
const { orderShiftsByPriority } = require("./shiftOrderingUtils");
const { scoreShiftCandidates } = require("./candidateScoringUtils");

// סופרת כמה משמרות כל עובד ביקש באותו שבוע.
function buildRequestedShiftCountsByEmployee(shiftRequests) {
  // key: employeeId -> value: כמה משמרות העובד ביקש השבוע.
  const requestedShiftCountsByEmployee = new Map();

  // עוברים על כל הבקשות ומגדילים את הספירה של העובד הרלוונטי.
  for (const shiftRequest of shiftRequests) {
    const currentRequestedShiftCount =
      requestedShiftCountsByEmployee.get(shiftRequest.employee_id) || 0;

    requestedShiftCountsByEmployee.set(
      shiftRequest.employee_id,
      currentRequestedShiftCount + 1
    );
  }

  return requestedShiftCountsByEmployee;
}

// מקבצת לכל משמרת את מזהי העובדים שביקשו אותה.
function buildRequestedEmployeeIdsByShift(shiftRequests) {
  // key: shiftId -> value: employeeIds[] של העובדים שביקשו את המשמרת.
  const requestedEmployeeIdsByShift = new Map();

  // כך נוכל לבנות רשימת מועמדים למשמרת בלי לחפש כל פעם מחדש.
  for (const shiftRequest of shiftRequests) {
    const existingEmployeeIds =
      requestedEmployeeIdsByShift.get(shiftRequest.shift_id) || [];

    existingEmployeeIds.push(shiftRequest.employee_id);
    requestedEmployeeIdsByShift.set(shiftRequest.shift_id, existingEmployeeIds);
  }

  return requestedEmployeeIdsByShift;
}

// סופרת כמה השמות כבר יש לכל עובד בנקודת הזמן הנוכחית.
function buildAssignedShiftCountsByEmployee(assignments) {
  // key: employeeId -> value: כמה השמות כבר ניתנו לעובד.
  const assignedShiftCountsByEmployee = new Map();

  // זה חשוב כדי לעדכן את חישובי ההוגנות בזמן ריצה.
  for (const assignment of assignments) {
    const currentAssignedShiftCount =
      assignedShiftCountsByEmployee.get(assignment.employeeId) || 0;

    assignedShiftCountsByEmployee.set(
      assignment.employeeId,
      currentAssignedShiftCount + 1
    );
  }

  return assignedShiftCountsByEmployee;
}

// בונה מצב עבודה מרוכז לכל עובד: חוזק, נורמליזציה, בקשות, יעד הוגן וכמות השמות קיימת.
function buildEmployeeStateById(employees, shiftRequests, forcedAssignments) {
  const requestedShiftCountsByEmployee =
    buildRequestedShiftCountsByEmployee(shiftRequests);
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(forcedAssignments);
  // key: employeeId -> value: אובייקט מצב מחושב של העובד לצורך האלגוריתם.
  const employeeStateById = new Map();

  // מחשבים פעם אחת את כל נתוני העובד כדי להשתמש בהם שוב ושוב בזמן ההשמה.
  for (const employee of employees) {
    const strengthScore = calculateStrengthScore(employee);
    const normalizedStrength = calculateNormalizedStrength(strengthScore);
    const requestedShifts =
      requestedShiftCountsByEmployee.get(employee.id) || 0;
    const targetShifts = calculateTargetShifts(
      requestedShifts,
      normalizedStrength
    );
    const assignedShifts =
      assignedShiftCountsByEmployee.get(employee.id) || 0;

    employeeStateById.set(employee.id, {
      employeeId: employee.id,
      strengthScore,
      normalizedStrength,
      requestedShifts,
      targetShifts,
      assignedShifts,
    });
  }

  return employeeStateById;
}

// מבצעת את לולאת ההשמה הראשית למשמרות שעדיין לא טופלו בהשמה כפויה.
function assignRemainingShifts(scheduleInputs, forcedAssignments = []) {
  const { employees, shifts, shiftRequests } = scheduleInputs;
  // שומרים את מזהי המשמרות הכפויות כדי לא לעבד אותן שוב.
  const forcedShiftIds = [
    ...new Set(forcedAssignments.map((assignment) => assignment.shiftId)),
  ];
  const orderedShifts = orderShiftsByPriority(
    shifts,
    shiftRequests,
    forcedShiftIds
  );
  const employeeStateById = buildEmployeeStateById(
    employees,
    shiftRequests,
    forcedAssignments
  );
  const requestedEmployeeIdsByShift = buildRequestedEmployeeIdsByShift(
    shiftRequests
  );
  const allAssignments = [...forcedAssignments];
  const remainingAssignments = [];

  // עוברים על המשמרות לפי סדר העדיפות שנקבע בשלב המיון.
  for (const shift of orderedShifts) {
    let assignedCount = 0;
    let currentShiftStrength = 0;

    while (assignedCount < shift.required_waiters) {
      const requestedEmployeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

      // בונים את רשימת המועמדים החוקיים למשמרת הנוכחית.
      const candidates = requestedEmployeeIds
        .filter(
          (employeeId) =>
            !allAssignments.some(
              (assignment) =>
                assignment.shiftId === shift.id &&
                assignment.employeeId === employeeId
            )
        )
        .map((employeeId) => {
          const employeeState = employeeStateById.get(employeeId);
          const fairnessGap = calculateFairnessGap(
            employeeState.targetShifts,
            employeeState.assignedShifts
          );
          const fairnessGapScore = calculateFairnessGapScore(
            fairnessGap,
            employeeState.targetShifts
          );

          return {
            employeeId,
            strengthScore: employeeState.strengthScore,
            normalizedStrength: employeeState.normalizedStrength,
            fairnessGapScore,
          };
        });

      if (!candidates.length) {
        // אם אין יותר מועמדים, עוצרים את מילוי המשמרת הזאת.
        break;
      }

      // בוחרים את המועמד הטוב ביותר לפי דירוג המועמדים.
      const [selectedCandidate] = scoreShiftCandidates(
        candidates,
        shift.required_strength_score,
        currentShiftStrength
      );

      const assignment = {
        shiftId: shift.id,
        employeeId: selectedCandidate.employeeId,
      };

      remainingAssignments.push(assignment);
      allAssignments.push(assignment);
      assignedCount += 1;
      currentShiftStrength += selectedCandidate.strengthScore;

      // מעדכנים מיד את מצב העובד כדי שהשיבוץ הבא ישתמש במידע ההוגנות המעודכן.
      const employeeState = employeeStateById.get(selectedCandidate.employeeId);
      employeeState.assignedShifts += 1;
    }
  }

  return {
    orderedShifts,
    remainingAssignments,
    allAssignments,
  };
}

module.exports = {
  assignRemainingShifts,
};
