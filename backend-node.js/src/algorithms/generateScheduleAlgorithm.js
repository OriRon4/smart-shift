const { SCHEDULE_JOB_ROLES } = require("../constants/roles");
const { runScheduleImprovement } = require("./scheduleImprovement");

const ENABLE_SCHEDULE_IMPROVEMENT = true;

function getAssignmentKey(assignment) {
  return `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`;
}

// מחשב ציון ותק בסקאלה של 0 עד 10.
// אחרי 24 חודשי ותק העובד מקבל את מלוא ציון הוותק.
function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (seniorityMonths / 24) * 10);
}

// מחשב ציון חוזק כולל לעובד.
// הציון משלב מקצועיות, אחריות, עבודה בלחץ, ותק ופוטנציאל.
function calculateStrengthScore(employee) {
  const seniorityScore = calculateSeniorityScore(employee.seniority_months);

  return (
    0.35 * Number(employee.professionalism) +
    0.3 * Number(employee.responsibility) +
    0.2 * Number(employee.pressure_handling) +
    0.1 * seniorityScore +
    0.05 * Number(employee.potential)
  );
}

// הופך ציון חוזק מ-0 עד 10 לערך יחסי בין 0 ל-1.
function calculateNormalizedStrength(strengthScore) {
  return strengthScore / 10;
}

// מחזיר כמה עובדים נדרשים למשמרת עבור התפקיד הנוכחי.
// roleConfig.requirementField מצביע לשדה כמו required_waiters.
function getRequiredCount(shift, roleConfig) {
  return Number(shift[roleConfig.requirementField] || 0);
}

// מחשב יעד משמרות לעובד לפי כמות הזמינויות שלו ולפי החוזק שלו.
// עובד חזק יותר מקבל יעד מעט גבוה יותר, אבל עדיין לפי זמינות.
function calculateTargetShifts(requestedShifts, normalizedStrength) {
  return requestedShifts * (0.35 + 0.65 * normalizedStrength);
}

// מחשב כמה העובד עדיין רחוק מיעד המשמרות שלו.
function calculateFairnessGap(targetShifts, assignedShifts) {
  return Math.max(0, targetShifts - assignedShifts);
}

// הופך את פער ההוגנות לציון יחסי.
// ככל שהעובד רחוק יותר מהיעד שלו, הציון גבוה יותר.
function calculateFairnessGapScore(fairnessGap, targetShifts) {
  return fairnessGap / Math.max(1, targetShifts);
}

// מעגל ציון כדי שהתוצאות יהיו יציבות ונוחות להצגה.
function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

// ממיר תאריך למפתח טקסט קבוע בפורמט YYYY-MM-DD.
function formatDateKey(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function buildRequestedShiftCountsByEmployee(shiftRequests) {
  // Map: employee_id -> מספר המשמרות שהעובד ביקש.
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
  // Map: shift_id -> מערך employee_id של עובדים זמינים למשמרת.
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
  // Map: employeeId -> מספר המשמרות שהעובד כבר שובץ אליהן.
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

function buildEmployeeStateById(employees, shiftRequests, assignments) {
  // Map: employee_id -> מספר זמינויות שהעובד הגיש.
  const requestedShiftCountsByEmployee =
    buildRequestedShiftCountsByEmployee(shiftRequests);
  // Map: employeeId -> מספר שיבוצים קיימים לעובד.
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(assignments);
  // Map: employee.id -> מצב חישובי של העובד בזמן האלגוריתם.
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

function calculateCoveragePressure(requiredCount, availableWorkers) {
  // ככל שיש פחות זמינים ביחס לדרישה, לחץ הכיסוי גבוה יותר.
  return requiredCount / Math.max(1, availableWorkers);
}

function calculatePriorityOrderScore(
  requiredCount,
  requiredStrengthScore,
  availableWorkers
) {
  const coveragePressure = calculateCoveragePressure(
    requiredCount,
    availableWorkers
  );
  // יחס בין החוזק הנדרש לבין חוזק מקסימלי תאורטי של כל התקנים.
  const strengthRequirementRatio =
    Number(requiredStrengthScore) / Math.max(1, requiredCount * 10);

  // 60 אחוז לחץ כיסוי, 40 אחוז דרישת חוזק.
  return 0.6 * coveragePressure + 0.4 * strengthRequirementRatio;
}

function orderShiftsByPriority(shifts, shiftRequests, roleConfig) {
  // Map: shift_id -> מספר עובדים זמינים למשמרת.
  const availableWorkersByShiftId = new Map();

  for (const shiftRequest of shiftRequests) {
    const currentAvailableWorkerCount =
      availableWorkersByShiftId.get(shiftRequest.shift_id) || 0;

    availableWorkersByShiftId.set(
      shiftRequest.shift_id,
      currentAvailableWorkerCount + 1
    );
  }

  return shifts
    .map((shift) => {
      // מעשירים כל משמרת בנתוני עדיפות עבור התפקיד הנוכחי.
      const requiredCount = getRequiredCount(shift, roleConfig);
      const availableWorkers = availableWorkersByShiftId.get(shift.id) || 0;
      const coveragePressure = calculateCoveragePressure(
        requiredCount,
        availableWorkers
      );
      const priorityOrderScore = calculatePriorityOrderScore(
        requiredCount,
        shift.required_strength_score,
        availableWorkers
      );

      return {
        ...shift,
        requiredCount,
        availableWorkers,
        coveragePressure,
        priorityOrderScore,
      };
    })
    // משמרות שלא דורשות את התפקיד הנוכחי לא רלוונטיות לשיבוץ הזה.
    .filter((shift) => shift.requiredCount > 0)
    .sort((leftShift, rightShift) => {
      // משמרת עם ציון עדיפות גבוה יותר משובצת קודם.
      if (rightShift.priorityOrderScore !== leftShift.priorityOrderScore) {
        return rightShift.priorityOrderScore - leftShift.priorityOrderScore;
      }

      // במקרה של שוויון, הסדר יציב לפי id.
      return leftShift.id - rightShift.id;
    });
}

function findForcedAssignments(shifts, shiftRequests, roleConfig) {
  // Map: shift_id -> מערך employee_id של עובדים זמינים למשמרת.
  const requestedEmployeeIdsByShift = buildRequestedEmployeeIdsByShift(
    shiftRequests
  );

  return shifts.flatMap((shift) => {
    const requiredCount = getRequiredCount(shift, roleConfig);
    const employeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

    // אם יש יותר זמינים ממספר התקנים, עדיין יש בחירה ולכן לא כופים שיבוץ.
    if (requiredCount <= 0 || employeeIds.length > requiredCount) {
      return [];
    }

    // אם מספר הזמינים קטן או שווה לדרישה, כל הזמינים משתבצים.
    return employeeIds.map((employeeId) => ({
      shiftId: shift.id,
      employeeId,
      jobRole: roleConfig.jobRole,
    }));
  });
}

function calculateStrengthGapScore(requiredStrengthScore, currentShiftStrength) {
  // מחשב כמה חוזק עדיין חסר במשמרת ביחס ליעד החוזק.
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
  // ציון בחירה משלב חוזק עובד, הוגנות וחוסר חוזק במשמרת.
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
  // אותו חוסר חוזק רלוונטי לכל המועמדים של המשמרת הנוכחית.
  const strengthGapScore = calculateStrengthGapScore(
    requiredStrengthScore,
    currentShiftStrength
  );

  return candidates
    .map((candidate) => ({
      // מוסיפים לכל מועמד את ציון החוסר ואת ציון הבחירה הסופי.
      ...candidate,
      strengthGapScore,
      selectionScore: calculateSelectionScore(
        candidate.normalizedStrength,
        candidate.fairnessGapScore,
        strengthGapScore
      ),
    }))
    .sort((leftCandidate, rightCandidate) => {
      // המועמד עם ציון הבחירה הגבוה ביותר מגיע ראשון.
      if (rightCandidate.selectionScore !== leftCandidate.selectionScore) {
        return rightCandidate.selectionScore - leftCandidate.selectionScore;
      }

      // במקרה של שוויון, מעדיפים עובד עם חוזק גבוה יותר.
      if (rightCandidate.strengthScore !== leftCandidate.strengthScore) {
        return rightCandidate.strengthScore - leftCandidate.strengthScore;
      }

      // במקרה של שוויון מלא, הסדר יציב לפי employeeId.
      return leftCandidate.employeeId - rightCandidate.employeeId;
    });
}

function buildCandidatesForShift(
  shift,
  requestedEmployeeIdsByShift,
  employeeStateById,
  allAssignments
) {
  // requestedEmployeeIdsByShift הוא Map: shift_id -> מערך employee_id זמינים.
  const requestedEmployeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

  return requestedEmployeeIds
    .filter(
      (employeeId) =>
        // בודקים שהעובד קיים במצב החישובי ולא שובץ כבר לאותה משמרת.
        employeeStateById.has(employeeId) &&
        !allAssignments.some(
          (assignment) =>
            assignment.shiftId === shift.id &&
            assignment.employeeId === employeeId
        )
    )
    .map((employeeId) => {
      // employeeStateById הוא Map: employee.id -> מצב העובד באלגוריתם.
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
        // זה המידע הדרוש כדי לדרג את המועמד למשמרת.
        employeeId,
        strengthScore: employeeState.strengthScore,
        normalizedStrength: employeeState.normalizedStrength,
        fairnessGapScore,
      };
    });
}

function assignRole(scheduleInputs, roleConfig) {
  // מסננים עובדים לפי התפקיד הנוכחי, כדי להתמקד רק בקבוצה הרלוונטית של מועמדים.
  const employees = scheduleInputs.employees.filter(
    (employee) => employee.role === roleConfig.jobRole
  );
  // Set: employee.id של עובדים ששייכים לתפקיד הנוכחי.
  const employeeIds = new Set(employees.map((employee) => employee.id));
  // משאירים רק בקשות זמינות של עובדים מהתפקיד הנוכחי.
  const shiftRequests = scheduleInputs.shiftRequests.filter((shiftRequest) =>
    employeeIds.has(shiftRequest.employee_id)
  );
  // שיבוצים שאין בהם בחירה: כל מי שזמין נכנס כי אין עודף מועמדים.
  const forcedAssignments = findForcedAssignments(
    scheduleInputs.shifts,
    shiftRequests,
    roleConfig
  );
  // Set: shiftId של משמרות שכבר קיבלו שיבוץ כפוי.
  const forcedShiftIds = new Set(
    forcedAssignments.map((assignment) => assignment.shiftId)
  );
  // מסדרים משמרות לפי קושי, ומדלגים על משמרות שכבר נסגרו בכפייה.
  const orderedShifts = orderShiftsByPriority(
    scheduleInputs.shifts,
    shiftRequests,
    roleConfig
  ).filter((shift) => !forcedShiftIds.has(shift.id));
  // Map: employee.id -> מצב העובד בזמן השיבוץ.
    // נתונים על העובד ברגע נתון - חוזק, כמה קיבל, target...
  const employeeStateById = buildEmployeeStateById(
    employees,
    shiftRequests,
    forcedAssignments
  );
  // Map: shift_id -> מערך employee_id של זמינים.
  const requestedEmployeeIdsByShift = buildRequestedEmployeeIdsByShift(
    shiftRequests
  );
  // מתחילים את רשימת השיבוצים עם השיבוצים הכפויים.
  const allAssignments = [...forcedAssignments];

  for (const shift of orderedShifts) {
    // מונה כמה עובדים כבר שובצו לתפקיד הזה במשמרת הנוכחית.
    let assignedCount = 0;
    // החוזק המצטבר של העובדים ששובצו למשמרת הנוכחית.
    let currentShiftStrength = 0;

    while (assignedCount < shift.requiredCount) {
      // בונים מועמדים זמינים שעדיין לא שובצו למשמרת הזו.
      const candidates = buildCandidatesForShift(
        shift,
        requestedEmployeeIdsByShift,
        employeeStateById,
        allAssignments
      );

      if (!candidates.length) {
        // אם אין מועמדים זמינים, המשמרת תישאר עם חוסר.
        break;
      }

      // אחרי המיון, המועמד הראשון הוא הבחירה הטובה ביותר.
      const [selectedCandidate] = scoreShiftCandidates(
        candidates,
        shift.required_strength_score,
        currentShiftStrength
      );

      // זהו שיבוץ אחד בפועל: משמרת, עובד ותפקיד.
      const assignment = {
        shiftId: shift.id,
        employeeId: selectedCandidate.employeeId,
        jobRole: roleConfig.jobRole,
      };

      allAssignments.push(assignment);
      assignedCount += 1;
      currentShiftStrength += selectedCandidate.strengthScore;

      // מעדכנים את מצב העובד כדי שהוגנות תשפיע על הבחירות הבאות.
      const employeeState = employeeStateById.get(selectedCandidate.employeeId);
      employeeState.assignedShifts += 1;
    }
  }

  return {
    // מחזירים תוצאה של תפקיד אחד מתוך כל התפקידים.
    jobRole: roleConfig.jobRole,
    orderedShifts,
    forcedAssignments,
    assignments: allAssignments,
  };
}

function buildRoleValidationSummaries(shifts, assignments, employees) {
  // Map: employee.id -> ציון חוזק של העובד.
  const strengthScoreByEmployeeId = new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
  // Map: "shiftId:jobRole" -> סיכום כמות וחוזק ששובצו לקבוצת תפקיד במשמרת.
  const assignmentsByShiftAndRole = new Map();

  for (const assignment of assignments) {
    // key מזהה קבוצת תפקיד בתוך משמרת מסוימת.
    const key = `${assignment.shiftId}:${assignment.jobRole}`;//
    const existingSummary = assignmentsByShiftAndRole.get(key) || {
      assignedCount: 0,//
      assignedStrengthScore: 0,//
    };

    existingSummary.assignedCount += 1;
    existingSummary.assignedStrengthScore +=
      strengthScoreByEmployeeId.get(assignment.employeeId) || 0;

    assignmentsByShiftAndRole.set(key, existingSummary);
  }

  return shifts.flatMap((shift) =>
    // לכל משמרת בונים סיכום עבור כל תפקיד שמופיע בסידור.
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      const requiredCount = getRequiredCount(shift, roleConfig);
      const key = `${shift.id}:${roleConfig.jobRole}`;
      const summary = assignmentsByShiftAndRole.get(key) || {
        assignedCount: 0,
        assignedStrengthScore: 0,
      };
      const roleStrengthTarget =
        // יעד החוזק הכללי מתחלק בין התפקידים לפי כמות העובדים הנדרשת.
        requiredCount === 0
          ? 0
          : (Number(shift.required_strength_score) *
              requiredCount) /
            Math.max(1, Number(shift.required_waiters));

      return {
        shiftId: shift.id,
        jobRole: roleConfig.jobRole,
        requiredCount,
        assignedCount: summary.assignedCount,
        assignedStrengthScore: summary.assignedStrengthScore,
        requiredStrengthScore: roleStrengthTarget,
        meetsStrengthTarget:
          summary.assignedStrengthScore >= roleStrengthTarget,
        uncoveredSlots: Math.max(0, requiredCount - summary.assignedCount),
      };
    })
  );
}

function rebuildRoleResultsWithAssignments(roleResults, assignments) {
  // מעדכנים את תוצאת כל תפקיד לפי השיבוצים הסופיים אחרי שלב השיפור.
  return roleResults.map((roleResult) => ({
    ...roleResult,
    assignments: assignments.filter(
      (assignment) => assignment.jobRole === roleResult.jobRole
    ),
  }));
}

function generateScheduleAlgorithm(scheduleInputs) {
  // הפונקציה הראשית של האלגוריתם.
  // קלט: עובדים, משמרות, זמינויות... scheduleInputs.
  // פלט: שיבוצים, סיכומי בדיקה וסיכום שיפור.

  // מריצים שיבוץ נפרד לכל תפקיד שמוגדר במערכת.
  const roleResults = SCHEDULE_JOB_ROLES.map((roleConfig) =>
    assignRole(scheduleInputs, roleConfig)
  );
  // מאחדים את השיבוצים של כל התפקידים לרשימה אחת.
  const initialAssignments = roleResults.flatMap(
    (roleResult) => roleResult.assignments
  );
  const forcedAssignmentSet = new Set(
    roleResults
      .flatMap((roleResult) => roleResult.forcedAssignments)
      .map((assignment) => getAssignmentKey(assignment))
  );
  // V2 post-processing improves the initial schedule with guarded local search.
  // If it fails, the initial V1 assignments remain the final schedule.
  let allAssignments = initialAssignments;
  let improvementSummary = {
    enabled: false,
  };

  if (ENABLE_SCHEDULE_IMPROVEMENT) {
    try {
      const improvementResult = runScheduleImprovement(
        scheduleInputs,
        initialAssignments,
        {
          enabled: true,
          forcedAssignmentSet,
        }
      );

      allAssignments = improvementResult.assignments;
      improvementSummary = improvementResult.improvementSummary;
    } catch (error) {
      allAssignments = initialAssignments;
      improvementSummary = {
        enabled: true,
        failed: true,
        error: error.message,
      };
    }
  }
  // בונים סיכומי בדיקה לכל משמרת ותפקיד.
  const shiftValidationSummaries = buildRoleValidationSummaries(
    scheduleInputs.shifts,
    allAssignments,
    scheduleInputs.employees
  );

  return {
    // roleResults נשמרים לפי תפקיד, אבל עם השיבוצים הסופיים.
    roleResults: rebuildRoleResultsWithAssignments(roleResults, allAssignments),
    // כל השיבוצים הסופיים ברשימה אחת.
    allAssignments,
    // סיכום כיסוי וחוזק לכל משמרת ותפקיד.
    shiftValidationSummaries,
    improvementSummary,
    // פירוט השיפורים שבוצעו אחרי השיבוץ הראשוני.
  };
}

module.exports = {
  calculateStrengthScore,
  buildRoleValidationSummaries,
  generateScheduleAlgorithm,
};
