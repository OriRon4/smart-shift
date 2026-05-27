const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

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
  return requestedShifts * (0.55 + 0.45 * normalizedStrength);
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

/*
שלב שיפור הסידור בהחלפות הושבת כרגע.
הקוד נשמר כאן כהערה בלבד, כדי שלא יהיה חלק מהזרימה במגן.
הסידור עדיין נוצר לפי assignRole, ואז נבדק עם buildRoleValidationSummaries.

function buildShiftById(shifts) {
  // Map: shift.id -> אובייקט המשמרת.
  return new Map(shifts.map((shift) => [shift.id, shift]));
}

function buildAvailabilitySet(shiftRequests) {
  // Set: "employee_id:shift_id" -> קיים אם העובד זמין למשמרת.
  return new Set(
    shiftRequests.map(
      (shiftRequest) => `${shiftRequest.employee_id}:${shiftRequest.shift_id}`
    )
  );
}

function buildEmployeeById(employees) {
  // Map: employee.id -> אובייקט העובד.
  return new Map(employees.map((employee) => [employee.id, employee]));
}

function findSameDayDoubleShiftIssues(assignments, shifts) {
  // Map: shift.id -> אובייקט המשמרת, כדי למצוא תאריך לפי shiftId.
  const shiftById = buildShiftById(shifts);
  // Map: "employeeId:date" -> מערך שיבוצים של העובד באותו יום.
  const assignmentsByEmployeeAndDate = new Map();

  for (const assignment of assignments) {
    const shift = shiftById.get(assignment.shiftId);

    if (!shift) {
      continue;
    }

    const dateKey = formatDateKey(shift.shift_date);
    const key = `${assignment.employeeId}:${dateKey}`;
    const existingAssignments = assignmentsByEmployeeAndDate.get(key) || [];

    existingAssignments.push(assignment);
    assignmentsByEmployeeAndDate.set(key, existingAssignments);
  }

  return [...assignmentsByEmployeeAndDate.entries()].flatMap(
    ([key, dayAssignments]) => {
      // אם לעובד יש שיבוץ אחד בלבד באותו יום, אין בעיה.
      if (dayAssignments.length <= 1) {
        return [];
      }

      const [employeeId, date] = key.split(":");

      return [
        {
          // בעיה זו מסמנת עובד ששובץ ליותר ממשמרת אחת באותו יום.
          type: "same_day_double_shift",
          employeeId: Number(employeeId),
          date,
          assignmentCount: dayAssignments.length,
          extraAssignments: dayAssignments.length - 1,
          shiftIds: dayAssignments.map((assignment) => assignment.shiftId),
        },
      ];
    }
  );
}

function findFairnessIssues(scheduleInputs, assignments) {
  // Map: employee.id -> מצב עובד כולל יעד, שיבוצים ופער הוגנות.
  const employeeStateById = buildEmployeeStateById(
    scheduleInputs.employees,
    scheduleInputs.shiftRequests,
    assignments
  );

  return [...employeeStateById.values()]
    .map((employeeState) => {
      // gap חיובי אומר שהעובד קיבל פחות מהיעד המחושב שלו.
      const gap = calculateFairnessGap(
        employeeState.targetShifts,
        employeeState.assignedShifts
      );

      return {
        type: "employee_under_target",
        employeeId: employeeState.employeeId,
        requestedShifts: employeeState.requestedShifts,
        assignedShifts: employeeState.assignedShifts,
        targetShifts: roundScore(employeeState.targetShifts),
        gap: roundScore(gap),
      };
    })
    // מציגים רק פער משמעותי, כדי לא להציף באזהרות קטנות.
    .filter((issue) => issue.requestedShifts > 0 && issue.gap > 0.5);
}

function findScheduleIssues(scheduleInputs, assignments) {
  // סיכום בסיסי לכל משמרת ותפקיד: דרישה, שיבוץ, חוזק וחוסרים.
  const validationSummaries = buildRoleValidationSummaries(
    scheduleInputs.shifts,
    assignments,
    scheduleInputs.employees
  );
  // קבוצות תפקיד שבהן חסרים עובדים.
  const uncoveredRoleGroups = validationSummaries
    .filter((summary) => summary.uncoveredSlots > 0)
    .map((summary) => ({
      type: "uncovered_role_group",
      shiftId: summary.shiftId,
      jobRole: summary.jobRole,
      uncoveredSlots: summary.uncoveredSlots,
    }));
  // קבוצות תפקיד שבהן החוזק ששובץ נמוך מהיעד.
  const belowStrengthRoleGroups = validationSummaries
    .filter((summary) => !summary.meetsStrengthTarget)
    .map((summary) => ({
      type: "below_strength_target",
      shiftId: summary.shiftId,
      jobRole: summary.jobRole,
      assignedStrengthScore: roundScore(summary.assignedStrengthScore),
      requiredStrengthScore: roundScore(summary.requiredStrengthScore),
      strengthDeficit: roundScore(
        Math.max(
          0,
          Number(summary.requiredStrengthScore) -
            Number(summary.assignedStrengthScore)
        )
      ),
    }));
  // בעיות של אותו עובד ביותר ממשמרת אחת באותו יום.
  const sameDayDoubleShifts = findSameDayDoubleShiftIssues(
    assignments,
    scheduleInputs.shifts
  );
  // אזהרות הוגנות לעובדים שקיבלו פחות מהיעד.
  const employeesUnderTarget = findFairnessIssues(scheduleInputs, assignments);

  return {
    // אובייקט בעיות מלא, כולל ספירות לשימוש בציון ובדוחות.
    uncoveredRoleGroups,
    belowStrengthRoleGroups,
    sameDayDoubleShifts,
    employeesUnderTarget,
    counts: {
      uncoveredRoleGroups: uncoveredRoleGroups.length,
      belowStrengthRoleGroups: belowStrengthRoleGroups.length,
      sameDayDoubleShifts: sameDayDoubleShifts.length,
      employeesUnderTarget: employeesUnderTarget.length,
    },
  };
}

function scoreSchedule(scheduleInputs, assignments) {
  // קודם מוצאים את כל סוגי הבעיות בסידור.
  const issues = findScheduleIssues(scheduleInputs, assignments);
  // חוסר בעובדים הוא הבעיה החמורה ביותר.
  const uncoveredSlots = issues.uncoveredRoleGroups.reduce(
    (total, issue) => total + issue.uncoveredSlots,
    0
  );
  // סך פערי החוזק בכל קבוצות התפקיד.
  const strengthDeficit = issues.belowStrengthRoleGroups.reduce(
    (total, issue) => total + issue.strengthDeficit,
    0
  );
  // כמות שיבוצים עודפים באותו יום.
  const sameDayPenaltyCount = issues.sameDayDoubleShifts.reduce(
    (total, issue) => total + issue.extraAssignments,
    0
  );
  // סך פערי ההוגנות.
  const fairnessGap = issues.employeesUnderTarget.reduce(
    (total, issue) => total + issue.gap,
    0
  );
  // ציון נמוך יותר הוא טוב יותר; חוסר עובדים מקבל קנס גדול במיוחד.
  const totalScore =
    uncoveredSlots * 1000 +
    strengthDeficit * 10 +
    sameDayPenaltyCount * 0.1 +
    fairnessGap * 2;

  return {
    totalScore: roundScore(totalScore),
    uncoveredSlots,
    strengthDeficit: roundScore(strengthDeficit),
    sameDayPenaltyCount,
    fairnessGap: roundScore(fairnessGap),
  };
}

function createsDuplicateShiftAssignment(assignments, assignmentIndex, swap) {
  const assignment = assignments[assignmentIndex];
  // swap הוא Map: assignmentIndex -> shiftId חדש אחרי החלפה.
  const targetShiftId = swap.get(assignmentIndex) || assignment.shiftId;

  return assignments.some((otherAssignment, otherIndex) => {
    if (otherIndex === assignmentIndex) {
      return false;
    }

    const otherTargetShiftId =
      swap.get(otherIndex) || otherAssignment.shiftId;

    // בודקים שלא נוצר מצב שבו אותו עובד מופיע פעמיים באותה משמרת.
    return (
      otherTargetShiftId === targetShiftId &&
      otherAssignment.employeeId === assignment.employeeId
    );
  });
}

function isValidSameRoleSwap(
  scheduleInputs,
  assignments,
  leftIndex,
  rightIndex,
  availabilitySet,
  employeeById
) {
  const leftAssignment = assignments[leftIndex];
  const rightAssignment = assignments[rightIndex];

  // החלפה חוקית רק בין אותו תפקיד, ורק אם מדובר בשתי משמרות שונות.
  if (
    leftAssignment.jobRole !== rightAssignment.jobRole ||
    leftAssignment.shiftId === rightAssignment.shiftId
  ) {
    return false;
  }

  const leftEmployee = employeeById.get(leftAssignment.employeeId);
  const rightEmployee = employeeById.get(rightAssignment.employeeId);

  // שני העובדים חייבים להיות קיימים, פעילים, ובאותו תפקיד של השיבוץ.
  if (
    !leftEmployee ||
    !rightEmployee ||
    !leftEmployee.is_active ||
    !rightEmployee.is_active ||
    leftEmployee.role !== leftAssignment.jobRole ||
    rightEmployee.role !== rightAssignment.jobRole
  ) {
    return false;
  }

  // availabilitySet הוא Set: "employeeId:shiftId" -> העובד זמין למשמרת.
  if (
    !availabilitySet.has(
      `${leftAssignment.employeeId}:${rightAssignment.shiftId}`
    ) ||
    !availabilitySet.has(
      `${rightAssignment.employeeId}:${leftAssignment.shiftId}`
    )
  ) {
    return false;
  }

  // Map: assignmentIndex -> shiftId החדש לאחר החלפה בין שני השיבוצים.
  const swap = new Map([
    [leftIndex, rightAssignment.shiftId],
    [rightIndex, leftAssignment.shiftId],
  ]);

  return (
    // גם אחרי ההחלפה אסור ליצור כפילות של עובד באותה משמרת.
    !createsDuplicateShiftAssignment(assignments, leftIndex, swap) &&
    !createsDuplicateShiftAssignment(assignments, rightIndex, swap)
  );
}

function swapAssignmentShiftIds(assignments, leftIndex, rightIndex) {
  // יוצרים עותק כדי לא לשנות את מערך השיבוצים המקורי.
  const improvedAssignments = assignments.map((assignment) => ({
    ...assignment,
  }));
  // מחליפים רק את shiftId בין שני שיבוצים.
  const leftShiftId = improvedAssignments[leftIndex].shiftId;

  improvedAssignments[leftIndex].shiftId =
    improvedAssignments[rightIndex].shiftId;
  improvedAssignments[rightIndex].shiftId = leftShiftId;

  return improvedAssignments;
}

function tryImproveBySameRoleSwaps(scheduleInputs, assignments, currentScore) {
  // Set: "employee_id:shift_id" -> קיים אם העובד זמין למשמרת.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests);
  // Map: employee.id -> אובייקט העובד.
  const employeeById = buildEmployeeById(scheduleInputs.employees);
  // נשמרת ההחלפה החוקית שנותנת את השיפור הכי טוב.
  let bestImprovement = null;
  let rejectedSwaps = 0;

  // עוברים על כל זוג אפשרי של שיבוצים.
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assignments.length;
      rightIndex += 1
    ) {
      if (
        // דוחים החלפה אם היא לא חוקית מבחינת תפקיד, זמינות או כפילות.
        !isValidSameRoleSwap(
          scheduleInputs,
          assignments,
          leftIndex,
          rightIndex,
          availabilitySet,
          employeeById
        )
      ) {
        rejectedSwaps += 1;
        continue;
      }

      // יוצרים מועמד חדש: אותו סידור, אבל עם החלפת משמרות בין שני עובדים.
      const candidateAssignments = swapAssignmentShiftIds(
        assignments,
        leftIndex,
        rightIndex
      );
      // מחשבים ציון לסידור המועמד.
      const candidateScore = scoreSchedule(
        scheduleInputs,
        candidateAssignments
      );

      // מקבלים רק החלפה שמשפרת את הציון הכולל.
      if (candidateScore.totalScore >= currentScore.totalScore) {
        rejectedSwaps += 1;
        continue;
      }

      if (
        // אם זו ההחלפה הכי טובה עד עכשיו, שומרים אותה.
        !bestImprovement ||
        candidateScore.totalScore < bestImprovement.score.totalScore
      ) {
        bestImprovement = {
          assignments: candidateAssignments,
          score: candidateScore,
          swap: {
            leftEmployeeId: assignments[leftIndex].employeeId,
            rightEmployeeId: assignments[rightIndex].employeeId,
            jobRole: assignments[leftIndex].jobRole,
            leftFromShiftId: assignments[leftIndex].shiftId,
            leftToShiftId: assignments[rightIndex].shiftId,
            rightFromShiftId: assignments[rightIndex].shiftId,
            rightToShiftId: assignments[leftIndex].shiftId,
          },
        };
      }
    }
  }

  return {
    bestImprovement,
    rejectedSwaps,
  };
}

function improveScheduleWithIterations(
  scheduleInputs,
  initialAssignments,
  maxIterations = 50
) {
  // מתחילים מעותק של השיבוץ הראשוני.
  let assignments = initialAssignments.map((assignment) => ({ ...assignment }));
  // מצב הבעיות לפני שלב השיפור.
  const issuesBefore = findScheduleIssues(scheduleInputs, assignments);
  // ציון הסידור לפני שיפור.
  const scoreBefore = scoreSchedule(scheduleInputs, assignments);
  let currentScore = scoreBefore;
  let rejectedSwaps = 0;
  // מערך החלפות שהתקבלו בפועל.
  const acceptedSwaps = [];
  // יומן קצר של תיקונים שבוצעו.
  const correctionLog = [];
  // היסטוריית איטרציות מפורטת.
  const iterationHistory = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    // בכל איטרציה מחפשים את ההחלפה החוקית הכי טובה.
    const improvement = tryImproveBySameRoleSwaps(
      scheduleInputs,
      assignments,
      currentScore
    );

    rejectedSwaps += improvement.rejectedSwaps;

    if (!improvement.bestImprovement) {
      // אם אין החלפה שמשפרת, מסיימים את שלב השיפור.
      break;
    }

    const scoreBeforeIteration = currentScore;
    const scoreAfterIteration = improvement.bestImprovement.score;

    iterationHistory.push({
      // שומרים תיעוד של השיפור שהתקבל באיטרציה הזו.
      iteration,
      accepted: true,
      scoreBefore: scoreBeforeIteration,
      scoreAfter: scoreAfterIteration,
      delta: roundScore(
        scoreBeforeIteration.totalScore - scoreAfterIteration.totalScore
      ),
      swap: improvement.bestImprovement.swap,
    });

    // מקבלים את השיבוץ המשופר וממשיכים ממנו לאיטרציה הבאה.
    assignments = improvement.bestImprovement.assignments;
    currentScore = scoreAfterIteration;
    acceptedSwaps.push(improvement.bestImprovement.swap);
    correctionLog.push({
      iteration,
      scoreAfterSwap: currentScore.totalScore,
      swap: improvement.bestImprovement.swap,
    });
  }

  // מחשבים שוב בעיות וציון אחרי כל השיפורים.
  const issuesAfter = findScheduleIssues(scheduleInputs, assignments);
  const scoreAfter = scoreSchedule(scheduleInputs, assignments);

  return {
    // מחזירים את השיבוצים הסופיים ואת סיכום השיפור.
    assignments,
    improvementSummary: {
      iterationsRun: acceptedSwaps.length,
      scoreBefore,
      scoreAfter,
      issuesBefore: issuesBefore.counts,
      issuesAfter: issuesAfter.counts,
      acceptedSwaps,
      rejectedSwaps,
      correctionLog,
      iterationHistory,
    },
  };
}

*/

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
  // קלט: עובדים, משמרות, זמינויות ולוגים מתוך scheduleInputs.
  // פלט: שיבוצים, סיכומי בדיקה וסיכום שיפור.

  // מריצים שיבוץ נפרד לכל תפקיד שמוגדר במערכת.
  const roleResults = SCHEDULE_JOB_ROLES.map((roleConfig) =>
    assignRole(scheduleInputs, roleConfig)
  );
  // מאחדים את השיבוצים של כל התפקידים לרשימה אחת.
  const initialAssignments = roleResults.flatMap(
    (roleResult) => roleResult.assignments
  );
  // מנסים לשפר את השיבוץ הראשוני בעזרת החלפות חוקיות.
  // שלב השיפור בהחלפות מושבת; השיבוץ הראשוני הוא השיבוץ הסופי.
  // אלה השיבוצים הסופיים אחרי שלב השיפור.
  const allAssignments = initialAssignments;
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
    // פירוט השיפורים שבוצעו אחרי השיבוץ הראשוני.
  };
}

module.exports = {
  calculateStrengthScore,
  buildRoleValidationSummaries,
  generateScheduleAlgorithm,
};
