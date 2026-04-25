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
  const requestedShiftCountsByEmployee = new Map();

  // Count how many shifts each employee requested this week.
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
  const requestedEmployeeIdsByShift = new Map();

  // Group requested employee IDs under each shift so we can build candidates fast.
  // כך נוכל later לבנות רשימת מועמדים למשמרת בלי לחפש כל פעם מחדש.
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
  const assignedShiftCountsByEmployee = new Map();

  // Count how many shifts each employee already has from earlier assignments.
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
  const employeeStateById = new Map();

  // Precompute each employee's strength and fairness state once for reuse.
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

  // Work through the unresolved shifts in priority order.
  // עוברים על המשמרות לפי סדר העדיפות שנקבע בשלב המיון.
  for (const shift of orderedShifts) {
    let assignedCount = 0;
    let currentShiftStrength = 0;

    while (assignedCount < shift.required_waiters) {
      const requestedEmployeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

      // Only employees who requested this shift and are not already assigned to it
      // can be scored as candidates.
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

      // Take the best-scoring candidate for the current state of the shift.
      // בוחרים את המועמד הטוב ביותר לפי דירוג המועמדים של שלב 14.
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

      // Update the employee's assigned count so later fairness scores stay current.
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
