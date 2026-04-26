// חישובי חוזק עובדים
function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (seniorityMonths / 24) * 10);
}

function calculateStrengthScore(employee) {
  const seniorityScore = calculateSeniorityScore(employee.seniority_months);

  return (
    0.35 * employee.professionalism +
    0.3 * employee.responsibility +
    0.2 * employee.pressure_handling +
    0.1 * seniorityScore +
    0.05 * employee.potential
  );
}

function calculateNormalizedStrength(strengthScore) {
  return strengthScore / 10;
}

// חישובי הוגנות
function calculateTargetShifts(requestedShifts, normalizedStrength) {
  return requestedShifts * (0.55 + 0.45 * normalizedStrength);
}

function calculateFairnessGap(targetShifts, assignedShifts) {
  return Math.max(0, targetShifts - assignedShifts);
}

function calculateFairnessGapScore(fairnessGap, targetShifts) {
  return fairnessGap / Math.max(1, targetShifts);
}

// שיבוצים כפויים
function findForcedShifts(shifts, shiftRequests) {
  // קודם מרכזים את כל הבקשות לפי משמרת, כדי לדעת כמה עובדים זמינים לכל משמרת.
  const requestsByShiftId = new Map();

  for (const shiftRequest of shiftRequests) {
    const existingEmployeeIds =
      requestsByShiftId.get(shiftRequest.shift_id) || [];

    existingEmployeeIds.push(shiftRequest.employee_id);
    requestsByShiftId.set(shiftRequest.shift_id, existingEmployeeIds);
  }

  // אחרי שיש מיפוי בקשות, בודקים אילו משמרות כבר חייבות לקבל את כל מי שביקש אותן.
  return shifts
    .map((shift) => {
      const employeeIds = requestsByShiftId.get(shift.id) || [];
      const requestedCount = employeeIds.length;

      return {
        shiftId: shift.id,
        requiredWaiters: shift.required_waiters,
        requestedCount,
        employeeIds,
      };
    })
    .filter((shift) => shift.requestedCount <= shift.requiredWaiters);
}

function buildForcedAssignments(forcedShifts) {
  // משמרות כפויות הופכות כאן לרשומות שיבוץ רגילות, כדי שהמשך האלגוריתם יתייחס אליהן ככבר סגורות.
  return forcedShifts.flatMap((forcedShift) =>
    forcedShift.employeeIds.map((employeeId) => ({
      shiftId: forcedShift.shiftId,
      employeeId,
    }))
  );
}

// שלב 13: סידור משמרות
function calculateCoveragePressure(requiredWaiters, availableWorkers) {
  return requiredWaiters / Math.max(1, availableWorkers);
}

function calculatePriorityOrderScore(
  requiredWaiters,
  requiredStrengthScore,
  availableWorkers
) {
  const coveragePressure = calculateCoveragePressure(
    requiredWaiters,
    availableWorkers
  );
  const strengthRequirementRatio =
    Number(requiredStrengthScore) / Math.max(1, requiredWaiters * 10);

  return 0.6 * coveragePressure + 0.4 * strengthRequirementRatio;
}

function orderShiftsByPriority(shifts, shiftRequests, excludedShiftIds = []) {
  const excludedShiftIdSet = new Set(excludedShiftIds);

  // סופרים כמה עובדים ביקשו כל משמרת, כי משמרת עם פחות זמינות צריכה לקבל עדיפות גבוהה יותר.
  const availableWorkersByShiftId = new Map();

  for (const shiftRequest of shiftRequests) {
    const currentAvailableWorkerCount =
      availableWorkersByShiftId.get(shiftRequest.shift_id) || 0;

    availableWorkersByShiftId.set(
      shiftRequest.shift_id,
      currentAvailableWorkerCount + 1
    );
  }

  // ממיינים רק משמרות שלא טופלו בכפייה, כדי שהשלב הבא יעבוד מהקשה לקל.
  return shifts
    .filter((shift) => !excludedShiftIdSet.has(shift.id))
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
    .sort((leftShift, rightShift) => {
      if (rightShift.priorityOrderScore !== leftShift.priorityOrderScore) {
        return rightShift.priorityOrderScore - leftShift.priorityOrderScore;
      }

      return leftShift.id - rightShift.id;
    });
}

// שלב 14: דירוג מועמדים
function calculateStrengthGapScore(requiredStrengthScore, currentShiftStrength) {
  return (
    Math.max(0, Number(requiredStrengthScore) - currentShiftStrength) /
    Math.max(1, Number(requiredStrengthScore))
  );
}

function calculateSelectionScore(
  normalizedStrength,
  fairnessGapScore,
  strengthGapScore
) {
  return (
    0.45 * normalizedStrength +
    0.35 * fairnessGapScore +
    0.2 * (normalizedStrength * strengthGapScore)
  );
}

function scoreShiftCandidates(
  candidates,
  requiredStrengthScore,
  currentShiftStrength
) {
  // ציון פער החוזק מחושב פעם אחת למשמרת ברגע הנוכחי, ואז משפיע על כל המועמדים.
  const strengthGapScore = calculateStrengthGapScore(
    requiredStrengthScore,
    currentShiftStrength
  );

  // כאן רק מדרגים מועמדים; הבחירה והשיבוץ בפועל קורים בשלב השיבוץ המרכזי.
  return candidates
    .map((candidate) => ({
      ...candidate,
      strengthGapScore,
      selectionScore: calculateSelectionScore(
        candidate.normalizedStrength,
        candidate.fairnessGapScore,
        strengthGapScore
      ),
    }))
    .sort((leftCandidate, rightCandidate) => {
      if (rightCandidate.selectionScore !== leftCandidate.selectionScore) {
        return rightCandidate.selectionScore - leftCandidate.selectionScore;
      }

      if (rightCandidate.strengthScore !== leftCandidate.strengthScore) {
        return rightCandidate.strengthScore - leftCandidate.strengthScore;
      }

      return leftCandidate.employeeId - rightCandidate.employeeId;
    });
}

// שלב 15: זרימת השיבוץ המרכזית
function buildRequestedShiftCountsByEmployee(shiftRequests) {
  const requestedShiftCountsByEmployee = new Map();

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

function buildRequestedEmployeeIdsByShift(shiftRequests) {
  const requestedEmployeeIdsByShift = new Map();

  for (const shiftRequest of shiftRequests) {
    const existingEmployeeIds =
      requestedEmployeeIdsByShift.get(shiftRequest.shift_id) || [];

    existingEmployeeIds.push(shiftRequest.employee_id);
    requestedEmployeeIdsByShift.set(shiftRequest.shift_id, existingEmployeeIds);
  }

  return requestedEmployeeIdsByShift;
}

function buildAssignedShiftCountsByEmployee(assignments) {
  const assignedShiftCountsByEmployee = new Map();

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

function buildEmployeeStateById(employees, shiftRequests, forcedAssignments) {
  // בונים תמונת מצב התחלתית לכל עובד, כולל כמה ביקש וכמה כבר שובץ בכפייה.
  const requestedShiftCountsByEmployee =
    buildRequestedShiftCountsByEmployee(shiftRequests);
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(forcedAssignments);
  const employeeStateById = new Map();

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

function buildCandidatesForShift(
  shift,
  requestedEmployeeIdsByShift,
  employeeStateById,
  allAssignments
) {
  const requestedEmployeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

  // מועמד תקף הוא עובד שביקש את המשמרת, קיים במצב העובדים, ועדיין לא שובץ לאותה משמרת.
  return requestedEmployeeIds
    .filter(
      (employeeId) =>
        employeeStateById.has(employeeId) &&
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
}

function assignRemainingShifts(scheduleInputs, forcedAssignments = []) {
  const { employees, shifts, shiftRequests } = scheduleInputs;
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

  // מתחילים מהשיבוצים הכפויים, כי הם כבר נסגרו לפני בחירת המועמדים הרגילה.
  const allAssignments = [...forcedAssignments];
  const remainingAssignments = [];

  // עוברים לפי סדר העדיפות כדי לטפל קודם במשמרות שקשה יותר לכסות.
  for (const shift of orderedShifts) {
    let assignedCount = 0;
    let currentShiftStrength = 0;

    while (assignedCount < shift.required_waiters) {
      const candidates = buildCandidatesForShift(
        shift,
        requestedEmployeeIdsByShift,
        employeeStateById,
        allAssignments
      );

      // אם אין מועמדים זמינים, משאירים את המשמרת בחוסר וממשיכים הלאה.
      if (!candidates.length) {
        break;
      }

      const [selectedCandidate] = scoreShiftCandidates(
        candidates,
        shift.required_strength_score,
        currentShiftStrength
      );

      const assignment = {
        shiftId: shift.id,
        employeeId: selectedCandidate.employeeId,
      };

      // אחרי בחירה אחת מעדכנים את מצב האלגוריתם, כדי שהבחירה הבאה תראה את המצב החדש.
      remainingAssignments.push(assignment);
      allAssignments.push(assignment);
      assignedCount += 1;
      currentShiftStrength += selectedCandidate.strengthScore;

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

// שלב 16: סיכום התוצאה
function buildShiftValidationSummaries(shifts, assignments, employees) {
  const strengthScoreByEmployeeId = new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );

  // מרכזים את השיבוצים לפי משמרת כדי לחשב לכל משמרת כיסוי וחוזק מצטבר.
  const assignmentSummaryByShiftId = new Map();

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

  // הסיכום הסופי רק מדווח על מצב המשמרת; הוא לא משנה את השיבוץ.
  return shifts.map((shift) => {
    const summary = assignmentSummaryByShiftId.get(shift.id) || {
      assignedCount: 0,
      assignedStrengthScore: 0,
    };

    return {
      shiftId: shift.id,
      assignedCount: summary.assignedCount,
      assignedStrengthScore: summary.assignedStrengthScore,
      meetsStrengthTarget:
        summary.assignedStrengthScore >= Number(shift.required_strength_score),
      uncoveredSlots: Math.max(0, shift.required_waiters - summary.assignedCount),
    };
  });
}

// פונקציית האלגוריתם הראשית
// הזרימה:
// 1. מאתרים משמרות כפויות ומייצרים מהן שיבוצים ראשוניים.
// 2. משבצים את שאר המשמרות לפי סדר עדיפות ודירוג מועמדים.
// 3. מאחדים את השיבוצים הכפויים והשיבוצים שנוצרו בשלב המרכזי.
// 4. בונים סיכומי בדיקה סופיים כדי שהמערכת תוכל לדווח על איכות התוצאה.
function generateScheduleAlgorithm(scheduleInputs) {
  const forcedShifts = findForcedShifts(
    scheduleInputs.shifts,
    scheduleInputs.shiftRequests
  );

  const forcedAssignments = buildForcedAssignments(forcedShifts);
  const assignmentResult = assignRemainingShifts(
    scheduleInputs,
    forcedAssignments
  );
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
