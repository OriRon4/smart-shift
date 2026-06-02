const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

// משקלי הניקוד של local search: ציון נמוך יותר טוב יותר, ו-coverage לא חלק מהציון כי הוא נבדק כחוקיות בלבד.
const SCORE_WEIGHTS = {
  strengthWeight: 10,
  fairnessWeight: 1,
};
const DEFAULT_MAX_IMPROVEMENT_ITERATIONS = 20;

// מקבלת ערך מספרי ומחזירה אותו מעוגל, כדי שהאבחון וה-summary יהיו קריאים ויציבים להצגה.
function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

// מקבלת ערך מה-DB/API ומחזירה מספר בטוח לחישובי scoring, גם אם הערך חסר או לא תקין.
function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

// מקבלת עובד ומחזירה האם הוא פעיל, כדי שמועמדי swap/replace לא ישתמשו בעובדים לא פעילים.
function isEmployeeActive(employee) {
  return Boolean(employee?.is_active ?? employee?.isActive);
}

// מקבלת עובד ומחזירה את התפקיד שלו, גם אם השדה הגיע בצורת DB או בצורת API.
function getEmployeeRole(employee) {
  return employee?.role || employee?.jobRole;
}

// מקבלת עובד ומחשבת ציון חוזק; הציון משמש גם לחוזק משמרת וגם ליעד ההוגנות המחושב.
function calculateStrengthScore(employee = {}) {
  const seniorityMonths = employee.seniority_months ?? employee.seniorityMonths;
  const pressureHandling = employee.pressure_handling ?? employee.pressureHandling;
  const seniorityScore = Math.min(10, (toNumber(seniorityMonths) / 24) * 10);

  return (
    0.35 * toNumber(employee.professionalism) +
    0.3 * toNumber(employee.responsibility) +
    0.2 * toNumber(pressureHandling) +
    0.1 * seniorityScore +
    0.05 * toNumber(employee.potential)
  );
}

// מקבלת shiftId ותפקיד ומחזירה key אחיד לטבלאות חיפוש של משמרת-תפקיד.
function shiftRoleKey(shiftId, jobRole) {
  return `${shiftId}:${jobRole}`;
}

// מקבלת shiftId ועובד ומחזירה key שמייצג שיבוץ עובד במשמרת, כדי למנוע כפילויות.
function shiftEmployeeKey(shiftId, employeeId) {
  return `${shiftId}:${employeeId}`;
}

// מקבלת עובד ומשמרת ומחזירה key לבדיקת זמינות/בקשה של העובד למשמרת.
function availabilityKey(employeeId, shiftId) {
  return `${employeeId}:${shiftId}`;
}

// מקבלת assignment ומחזירה key מלא של שיבוץ, כולל תפקיד, כדי לזהות שיבוץ כפוי במדויק.
function getAssignmentKey(assignment) {
  return `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`;
}

// מקבלת משמרת ותצורת תפקיד ומחזירה כמה עובדים נדרשים לתפקיד הזה במשמרת.
function getRequiredCount(shift, roleConfig) {
  return toNumber(shift[roleConfig.requirementField]);
}

// מקבלת משמרת ותפקיד ומחזירה את יעד החוזק היחסי של אותו role group בתוך המשמרת.
function getRoleStrengthTarget(shift, roleConfig, requiredCount) {
  if (requiredCount <= 0) {
    return 0;
  }

  return (
    (toNumber(shift.required_strength_score) * requiredCount) /
    Math.max(1, toNumber(shift.required_waiters))
  );
}

// מקבלת יעד חוזק ומחזירה target/minimum; minimum משמש כחסם חוקיות לפני קבלת מועמד.
function buildStrengthRange(requiredStrengthScore) {
  const target = toNumber(requiredStrengthScore);

  if (target <= 0) {
    return { hasStrengthTarget: false, target: 0, margin: 0, minimum: 0 };
  }

  const margin = Math.max(2, target * 0.1);
  return {
    hasStrengthTarget: true,
    target,
    margin,
    minimum: Math.max(0, target - margin),
  };
}

// מקבלת חוזק בפועל וטווח חוזק, ומחזירה penalty: מתחת למינימום חמור יותר ממתחת ליעד.
function calculateStrengthPenalty(actualStrength, strengthRange) {
  if (!strengthRange.hasStrengthTarget) {
    return 0;
  }

  if (actualStrength < strengthRange.minimum) {
    return strengthRange.minimum - actualStrength;
  }

  return actualStrength < strengthRange.target
    ? (strengthRange.target - actualStrength) * 0.25
    : 0;
}

// Map: key -> value[]. מוסיף ערך לרשימת ערכים תחת אותו key, כדי לבנות אינדקסים יעילים.
function addToListMap(map, key, value) {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

// מקבלת רשימה ופונקציית key ומחזירה Map: getKey(item) -> count, למשל ספירת שיבוצים לעובד.
function buildCountMap(items, getKey) {
  // Map: derived key -> count.
  const countByKey = new Map();

  for (const item of items) {
    const key = getKey(item);
    countByKey.set(key, (countByKey.get(key) || 0) + 1);
  }

  return countByKey;
}

// מקבלת קלטי schedule ושיבוצים ובונה context של Maps/Sets; זה מאפשר לייצר ולבדוק מועמדים מהר.
function buildContext(scheduleInputs, assignments, options = {}) {
  const activeEmployees = scheduleInputs.employees || [];
  const allEmployees = scheduleInputs.allEmployees || activeEmployees;
  const shiftRequests = scheduleInputs.shiftRequests || [];
  // Map: employeeId -> employee object. חיפוש מהיר של פרטי עובד לצורך role/activity validation.
  const employeeById = new Map(allEmployees.map((employee) => [employee.id, employee]));
  // Map: employeeId -> calculated strength score. משמש לחישוב חוזק משמרת ויעדי fairness.
  const strengthByEmployeeId = new Map(
    allEmployees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
  // Map: employeeId -> assigned shift count. מצב נוכחי של עומס השיבוצים לכל עובד.
  const assignedCountByEmployeeId = buildCountMap(assignments, (assignment) => assignment.employeeId);
  // Map: employeeId -> requested/available shift count. כמה משמרות העובד ביקש או זמין אליהן.
  const requestedCountByEmployeeId = buildCountMap(shiftRequests, (request) => request.employee_id);
  // Map: "shiftId:jobRole" -> assignment[]. כל השיבוצים של תפקיד מסוים במשמרת מסוימת.
  const assignmentsByShiftRole = new Map();
  // Map: jobRole -> assignment[]. כל השיבוצים לפי תפקיד, שימושי למציאת donors ל-swap.
  const assignmentsByRole = new Map();
  // Map: "shiftId:employeeId:jobRole" -> assignment. בדיקה מדויקת ששיבוץ קיים לפני שינוי.
  const assignmentByKey = new Map();
  // Set: "shiftId:employeeId". מונע מצב שבו אותו עובד משובץ פעמיים באותה משמרת.
  const shiftEmployeeSet = new Set();

  for (const assignment of assignments) {
    // ממלאים את אינדקסי השיבוצים הנוכחיים כדי ש-generation ו-validation יהיו O(1) ברוב הבדיקות.
    addToListMap(assignmentsByShiftRole, shiftRoleKey(assignment.shiftId, assignment.jobRole), assignment);
    addToListMap(assignmentsByRole, assignment.jobRole, assignment);
    assignmentByKey.set(getAssignmentKey(assignment), assignment);
    shiftEmployeeSet.add(shiftEmployeeKey(assignment.shiftId, assignment.employeeId));
  }

  // Map: jobRole -> active employee[]. מאגר מועמדים פעילים להחלפה לפי אותו תפקיד.
  const activeEmployeesByRole = new Map();
  // Map: employeeId -> fairness data. כולל assigned/requested/target ומצב over/under target.
  const fairnessByEmployeeId = new Map();

  for (const employee of activeEmployees) {
    if (!isEmployeeActive(employee)) {
      continue;
    }

    const strengthScore = strengthByEmployeeId.get(employee.id) || 0;
    const requestedShifts = requestedCountByEmployeeId.get(employee.id) || 0;
    const assignedShifts = assignedCountByEmployeeId.get(employee.id) || 0;
    // calculatedTargetShifts מחושב מזמינות/בקשות ומחוזק עובד; זה לא שדה שמור ב-DB.
    const calculatedTargetShifts = requestedShifts * (0.55 + 0.45 * (strengthScore / 10));

    // שומרים גם candidate pool לפי תפקיד וגם fairness state כדי לייצר replace ממוקד.
    addToListMap(activeEmployeesByRole, getEmployeeRole(employee), employee);
    fairnessByEmployeeId.set(employee.id, {
      employeeId: employee.id,
      assignedShifts,
      requestedShifts,
      calculatedTargetShifts,
      isOverTarget: assignedShifts > calculatedTargetShifts,
      isUnderTarget: assignedShifts < calculatedTargetShifts,
    });
  }

  return {
    employeeById,
    strengthByEmployeeId,
    assignedCountByEmployeeId,
    assignmentsByShiftRole,
    assignmentsByRole,
    assignmentByKey,
    activeEmployeesByRole,
    // Set: "employeeId:shiftId". בדיקה מהירה שהעובד זמין למשמרת היעד.
    availabilitySet: new Set(shiftRequests.map((request) => availabilityKey(request.employee_id, request.shift_id))),
    // Set: "shiftId:employeeId:jobRole". שיבוצים כפויים שה-local search לא רשאי להזיז.
    forcedAssignmentSet: options.forcedAssignmentSet || new Set(),
    shiftEmployeeSet,
    fairnessByEmployeeId,
  };
}

// מקבלת את הקלט וה-context, ומחזירה אבחון לכל shift-role כדי לזהות חולשה ולחשב strength penalty.
function buildShiftRoleDiagnostics(scheduleInputs, context) {
  return (scheduleInputs.shifts || []).flatMap((shift) =>
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      const requiredCount = getRequiredCount(shift, roleConfig);
      const strengthRange = buildStrengthRange(
        getRoleStrengthTarget(shift, roleConfig, requiredCount)
      );
      // Map usage: "shiftId:jobRole" -> assignment[]. שולף את העובדים ששובצו לקבוצת התפקיד הזו.
      const assignedWorkers =
        context.assignmentsByShiftRole.get(shiftRoleKey(shift.id, roleConfig.jobRole)) || [];
      const actualStrength = assignedWorkers.reduce(
        (total, assignment) => total + (context.strengthByEmployeeId.get(assignment.employeeId) || 0),
        0
      );
      const strengthPenalty = calculateStrengthPenalty(actualStrength, strengthRange);

      return {
        shiftId: shift.id,
        jobRole: roleConfig.jobRole,
        requiredCount,
        assignedCount: assignedWorkers.length,
        actualStrength: roundScore(actualStrength),
        strengthRange: {
          hasStrengthTarget: strengthRange.hasStrengthTarget,
          target: roundScore(strengthRange.target),
          minimum: roundScore(strengthRange.minimum),
        },
        strengthPenalty: roundScore(strengthPenalty),
        isWeak: strengthRange.hasStrengthTarget && actualStrength < strengthRange.minimum,
      };
    })
  );
}

// מקבלת context ומחזירה fairness penalty לפי ריבוע הפער מהיעד המחושב, כדי להעניש חוסר איזון גדול.
function calculateFairnessPenalty(context) {
  let fairnessPenalty = 0;

  // Map usage: employeeId -> fairness data. כל עובד תורם penalty לפי מרחק מהיעד שלו.
  for (const fairness of context.fairnessByEmployeeId.values()) {
    const gap = fairness.assignedShifts - fairness.calculatedTargetShifts;
    fairnessPenalty += gap * gap;
  }

  return roundScore(fairnessPenalty);
}

// מקבלת diagnosis ומשקלים ומחזירה totalScore יחיד שה-hill climbing מנסה להקטין.
function calculateScheduleScore(diagnosis, weights = SCORE_WEIGHTS) {
  return roundScore(
    diagnosis.strengthPenalty * weights.strengthWeight +
      diagnosis.fairnessPenalty * weights.fairnessWeight
  );
}

// מקבלת מצב שיבוצים קונקרטי ומחזירה אבחון מלא: strength, fairness, weak shifts ו-totalScore.
function diagnoseSchedule(scheduleInputs, assignments, options = {}) {
  const context = options.employeeById ? options : buildContext(scheduleInputs, assignments, options);
  const shiftRoleDiagnostics = buildShiftRoleDiagnostics(scheduleInputs, context);
  const strengthPenalty = roundScore(
    shiftRoleDiagnostics.reduce((total, diagnostic) => total + diagnostic.strengthPenalty, 0)
  );
  const fairnessPenalty = calculateFairnessPenalty(context);
  const diagnosis = {
    shiftRoleDiagnostics,
    strengthPenalty,
    fairnessPenalty,
    weakShifts: shiftRoleDiagnostics.filter((diagnostic) => diagnostic.isWeak),
  };

  diagnosis.totalScore = calculateScheduleScore(diagnosis);
  return diagnosis;
}

// מקבלת diagnosis, shift ותפקיד ומחזירה את אבחון ה-role group הספציפי לבדיקות אחרי סימולציה.
function findShiftRoleDiagnostic(diagnosis, shiftId, jobRole) {
  return diagnosis.shiftRoleDiagnostics.find(
    (diagnostic) => diagnostic.shiftId === shiftId && diagnostic.jobRole === jobRole
  );
}

// Set usage: "shiftId:employeeId:jobRole". בודק אם assignment מוגן ואסור להזזה.
function isForcedAssignment(assignment, context) {
  return assignment && context.forcedAssignmentSet.has(getAssignmentKey(assignment));
}

// מקבלת אבחון אחרי סימולציה ובודקת אם role group נפגע מתחת למינימום החוקי.
function isBelowMinimum(diagnosis, shiftId, jobRole) {
  const diagnostic = findShiftRoleDiagnostic(diagnosis, shiftId, jobRole);
  return (
    diagnostic &&
    diagnostic.strengthRange.hasStrengthTarget &&
    diagnostic.actualStrength < diagnostic.strengthRange.minimum
  );
}

// מקבלת schedule נוכחי ומייצרת רק swap candidates סביב משמרות חלשות, כדי לשפר strength בלי חיפוש ענק.
function generateSwapCandidates(scheduleInputs, assignments, diagnosis, context) {
  const candidates = [];

  for (const weakShift of diagnosis.weakShifts) {
    // Map usage: "shiftId:jobRole" -> assignment[]. העובדים שנמצאים כרגע בקבוצה החלשה.
    const weakAssignments =
      context.assignmentsByShiftRole.get(shiftRoleKey(weakShift.shiftId, weakShift.jobRole)) || [];
    // Map usage: jobRole -> assignment[]. donors מגיעים רק מאותו תפקיד כדי לא לשבור דרישות role.
    const donorAssignments = context.assignmentsByRole.get(weakShift.jobRole) || [];

    for (const weakAssignment of weakAssignments) {
      if (isForcedAssignment(weakAssignment, context)) {
        continue;
      }

      for (const donorAssignment of donorAssignments) {
        const weakStrength = context.strengthByEmployeeId.get(weakAssignment.employeeId) || 0;
        const donorStrength = context.strengthByEmployeeId.get(donorAssignment.employeeId) || 0;

        // כאן מסננים רק מועמדים לא רלוונטיים; חוקיות מלאה נבדקת ב-validateCandidate.
        if (
          donorAssignment.shiftId === weakShift.shiftId ||
          donorAssignment.employeeId === weakAssignment.employeeId ||
          isForcedAssignment(donorAssignment, context) ||
          donorStrength <= weakStrength
        ) {
          continue;
        }

        candidates.push({
          type: "swap",
          jobRole: weakShift.jobRole,
          weakShiftId: weakShift.shiftId,
          donorShiftId: donorAssignment.shiftId,
          weakShiftEmployeeId: weakAssignment.employeeId,
          donorShiftEmployeeId: donorAssignment.employeeId,
        });
      }
    }
  }

  return candidates;
}

// מקבלת מצב נוכחי ומייצרת replace candidates: עובד over-target יוצא ועובד under-target מאותו תפקיד נכנס.
function generateReplaceCandidates(scheduleInputs, assignments, diagnosis, context) {
  const candidates = [];

  for (const assignment of assignments) {
    const removedFairness = context.fairnessByEmployeeId.get(assignment.employeeId);

    if (isForcedAssignment(assignment, context) || !removedFairness?.isOverTarget) {
      continue;
    }

    // Map usage: jobRole -> active employee[]. מחפשים מחליפים פעילים מאותו תפקיד בלבד.
    for (const addedEmployee of context.activeEmployeesByRole.get(assignment.jobRole) || []) {
      const addedFairness = context.fairnessByEmployeeId.get(addedEmployee.id);

      // Set usage: availabilitySet "employeeId:shiftId"; shiftEmployeeSet "shiftId:employeeId".
      if (
        addedEmployee.id === assignment.employeeId ||
        !addedFairness?.isUnderTarget ||
        !context.availabilitySet.has(availabilityKey(addedEmployee.id, assignment.shiftId)) ||
        context.shiftEmployeeSet.has(shiftEmployeeKey(assignment.shiftId, addedEmployee.id))
      ) {
        continue;
      }

      candidates.push({
        type: "replace",
        shiftId: assignment.shiftId,
        jobRole: assignment.jobRole,
        removedEmployeeId: assignment.employeeId,
        addedEmployeeId: addedEmployee.id,
      });
    }
  }

  return candidates;
}

// מקבלת שיבוצים ומועמד, ומחזירה מערך שיבוצים חדש שמדמה את השינוי בלי לשנות את המקור.
function applyCandidate(assignments, candidate) {
  return assignments.map((assignment) => {
    // Swap: העובד החזק יותר מה-donor shift נכנס למשמרת החלשה.
    if (
      candidate.type === "swap" &&
      assignment.shiftId === candidate.weakShiftId &&
      assignment.employeeId === candidate.weakShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return { ...assignment, employeeId: candidate.donorShiftEmployeeId };
    }

    // Swap: העובד מהמשמרת החלשה עובר למשמרת של ה-donor.
    if (
      candidate.type === "swap" &&
      assignment.shiftId === candidate.donorShiftId &&
      assignment.employeeId === candidate.donorShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return { ...assignment, employeeId: candidate.weakShiftEmployeeId };
    }

    // Replace: רק employeeId משתנה; המשמרת והתפקיד נשארים זהים.
    if (
      candidate.type === "replace" &&
      assignment.shiftId === candidate.shiftId &&
      assignment.employeeId === candidate.removedEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return { ...assignment, employeeId: candidate.addedEmployeeId };
    }

    return { ...assignment };
  });
}

// מקבלת מועמד ובודקת חוקיות לפני scoring: role, availability, forced assignments, כפילויות ומינימום strength.
function validateCandidate(candidate, scheduleInputs, assignments, diagnosis, context) {
  const reasons = [];

  if (candidate.type === "swap") {
    // Map usage: "shiftId:employeeId:jobRole" -> assignment. מאמת ששני צדדי ה-swap קיימים.
    const weakAssignment = context.assignmentByKey.get(
      getAssignmentKey({ shiftId: candidate.weakShiftId, employeeId: candidate.weakShiftEmployeeId, jobRole: candidate.jobRole })
    );
    const donorAssignment = context.assignmentByKey.get(
      getAssignmentKey({ shiftId: candidate.donorShiftId, employeeId: candidate.donorShiftEmployeeId, jobRole: candidate.jobRole })
    );
    const weakEmployee = context.employeeById.get(candidate.weakShiftEmployeeId);
    const donorEmployee = context.employeeById.get(candidate.donorShiftEmployeeId);

    // Swap חייב לשמור על role, זמינות, שיבוץ כפוי, ולמנוע כפילות עובד באותה משמרת.
    if (!weakAssignment || !donorAssignment) reasons.push("Swap assignment does not exist.");
    if (isForcedAssignment(weakAssignment, context) || isForcedAssignment(donorAssignment, context)) reasons.push("Cannot swap a forced assignment.");
    if (!weakEmployee || !donorEmployee || !isEmployeeActive(weakEmployee) || !isEmployeeActive(donorEmployee)) reasons.push("Swap employee is missing or inactive.");
    if (getEmployeeRole(weakEmployee) !== candidate.jobRole || getEmployeeRole(donorEmployee) !== candidate.jobRole) reasons.push("Swap employee role does not match.");
    if (
      !context.availabilitySet.has(availabilityKey(candidate.weakShiftEmployeeId, candidate.donorShiftId)) ||
      !context.availabilitySet.has(availabilityKey(candidate.donorShiftEmployeeId, candidate.weakShiftId))
    ) reasons.push("Swap employee is not available for the target shift.");
    if (
      context.shiftEmployeeSet.has(shiftEmployeeKey(candidate.weakShiftId, candidate.donorShiftEmployeeId)) ||
      context.shiftEmployeeSet.has(shiftEmployeeKey(candidate.donorShiftId, candidate.weakShiftEmployeeId))
    ) reasons.push("Swap would create a duplicate assignment.");
  } else if (candidate.type === "replace") {
    // Map usage: "shiftId:employeeId:jobRole" -> assignment. מאמת שהשיבוץ שאותו מסירים באמת קיים.
    const removedAssignment = context.assignmentByKey.get(
      getAssignmentKey({ shiftId: candidate.shiftId, employeeId: candidate.removedEmployeeId, jobRole: candidate.jobRole })
    );
    const removedEmployee = context.employeeById.get(candidate.removedEmployeeId);
    const addedEmployee = context.employeeById.get(candidate.addedEmployeeId);
    const removedFairness = context.fairnessByEmployeeId.get(candidate.removedEmployeeId);
    const addedFairness = context.fairnessByEmployeeId.get(candidate.addedEmployeeId);

    // Replace חייב להעביר עומס מ-over-target ל-under-target בלי לשבור חוקיות בסיסית.
    if (!removedAssignment) reasons.push("Replace assignment does not exist.");
    if (isForcedAssignment(removedAssignment, context)) reasons.push("Cannot replace a forced assignment.");
    if (!removedFairness?.isOverTarget) reasons.push("Removed employee is not over calculated target shifts.");
    if (!addedFairness?.isUnderTarget) reasons.push("Added employee is not under calculated target shifts.");
    if (!removedEmployee || !addedEmployee || !isEmployeeActive(addedEmployee)) reasons.push("Replace employee is missing or inactive.");
    if (getEmployeeRole(removedEmployee) !== candidate.jobRole || getEmployeeRole(addedEmployee) !== candidate.jobRole) reasons.push("Replace employee role does not match.");
    if (!context.availabilitySet.has(availabilityKey(candidate.addedEmployeeId, candidate.shiftId))) reasons.push("Added employee is not available for the shift.");
    if (context.shiftEmployeeSet.has(shiftEmployeeKey(candidate.shiftId, candidate.addedEmployeeId))) reasons.push("Replace would create a duplicate assignment.");
  } else {
    reasons.push("Unknown candidate type.");
  }

  if (reasons.length) {
    return { valid: false, reasons, assignmentsAfter: null, diagnosisAfter: null };
  }

  // אחרי בדיקות בסיסיות מדמים את השינוי ואז בודקים שהקבוצות שנפגעו לא ירדו מתחת למינימום strength.
  const assignmentsAfter = applyCandidate(assignments, candidate);
  const contextAfter = buildContext(scheduleInputs, assignmentsAfter, {
    forcedAssignmentSet: context.forcedAssignmentSet,
  });
  const diagnosisAfter = diagnoseSchedule(scheduleInputs, assignmentsAfter, contextAfter);

  if (
    candidate.type === "swap" &&
    (isBelowMinimum(diagnosisAfter, candidate.weakShiftId, candidate.jobRole) ||
      isBelowMinimum(diagnosisAfter, candidate.donorShiftId, candidate.jobRole))
  ) {
    reasons.push("Swap would leave an affected shift below minimum strength.");
  }

  if (
    candidate.type === "replace" &&
    isBelowMinimum(diagnosisAfter, candidate.shiftId, candidate.jobRole)
  ) {
    reasons.push("Replace would leave the shift below minimum strength.");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    assignmentsAfter: reasons.length ? null : assignmentsAfter,
    diagnosisAfter: reasons.length ? null : diagnosisAfter,
  };
}

// מקבלת מועמד, מריצה validation+simulation, ומחזירה האם הוא משפר totalScore ואת פרטי האבחון אחרי.
function evaluateCandidate(candidate, scheduleInputs, assignments, diagnosis, context) {
  const validation = validateCandidate(candidate, scheduleInputs, assignments, diagnosis, context);

  if (!validation.valid) {
    return { candidate, validation, scoreBefore: diagnosis.totalScore, scoreAfter: null, improvement: 0 };
  }

  const diagnosisAfter = validation.diagnosisAfter;
  const improvesTotalScore = diagnosisAfter.totalScore < diagnosis.totalScore;
  const improvesFairness = candidate.type !== "replace" || diagnosisAfter.fairnessPenalty < diagnosis.fairnessPenalty;
  const valid = improvesTotalScore && improvesFairness;

  return {
    candidate,
    validation: {
      ...validation,
      valid,
      reasons: valid ? [] : ["Candidate does not improve the score."],
    },
    scoreBefore: diagnosis.totalScore,
    scoreAfter: diagnosisAfter.totalScore,
    improvement: roundScore(diagnosis.totalScore - diagnosisAfter.totalScore),
    assignmentsAfter: validation.assignmentsAfter,
    diagnosisAfter,
  };
}

// מקבלת evaluations ובוחרת את המועמד החוקי עם השיפור הכי גדול; זה ה-best-improvement step של hill climbing.
function selectBestEvaluation(evaluations) {
  return (
    evaluations
      .filter((evaluation) => evaluation.validation.valid && evaluation.improvement > 0)
      .sort((left, right) => {
        if (right.improvement !== left.improvement) {
          return right.improvement - left.improvement;
        }

        return left.candidate.type.localeCompare(right.candidate.type);
      })[0] || null
  );
}

// מקבלת evaluation שהתקבל ובונה רשומת acceptedChange ברורה להצגה: מי זז, אילו משמרות ומה השתנה בציון.
function buildAcceptedChange(evaluation, diagnosisBefore) {
  const candidate = evaluation.candidate;
  const diagnosisAfter = evaluation.diagnosisAfter;
  const affectedShiftIds =
    candidate.type === "swap" ? [candidate.weakShiftId, candidate.donorShiftId] : [candidate.shiftId];
  const affectedEmployeeIds =
    candidate.type === "swap"
      ? [candidate.weakShiftEmployeeId, candidate.donorShiftEmployeeId]
      : [candidate.removedEmployeeId, candidate.addedEmployeeId];

  return {
    ...candidate,
    affectedShiftIds,
    affectedEmployeeIds,
    scoreBefore: diagnosisBefore.totalScore,
    scoreAfter: diagnosisAfter.totalScore,
    strengthPenaltyBefore: diagnosisBefore.strengthPenalty,
    strengthPenaltyAfter: diagnosisAfter.strengthPenalty,
    fairnessPenaltyBefore: diagnosisBefore.fairnessPenalty,
    fairnessPenaltyAfter: diagnosisAfter.fairnessPenalty,
  };
}

// מקבלת אבחון התחלתי/סופי ונתוני loop, ומחזירה summary שמסביר לפרונט מה השיפור עשה.
function buildImprovementSummary(initialDiagnosis, finalDiagnosis, enabled, acceptedChanges, loopSummary) {
  return {
    enabled,
    phase: "local-search-swap-replace",
    maxIterations: loopSummary.maxIterations,
    iterationsRun: loopSummary.iterationsRun,
    stopReason: loopSummary.stopReason,
    acceptedChangesCount: acceptedChanges.length,
    acceptedChanges,
    initialScore: initialDiagnosis.totalScore,
    finalScore: finalDiagnosis.totalScore,
    scoreImprovement: roundScore(initialDiagnosis.totalScore - finalDiagnosis.totalScore),
    initialStrengthPenalty: initialDiagnosis.strengthPenalty,
    finalStrengthPenalty: finalDiagnosis.strengthPenalty,
    initialFairnessPenalty: initialDiagnosis.fairnessPenalty,
    finalFairnessPenalty: finalDiagnosis.fairnessPenalty,
    candidatesChecked: loopSummary.candidatesChecked,
    validCandidatesCount: loopSummary.validCandidatesCount,
  };
}

// API ראשי: מקבל schedule חוקי, מריץ local-search-swap-replace, ומחזיר שיבוצים משופרים ו-summary.
function runScheduleImprovement(scheduleInputs, initialAssignments, options = {}) {
  const maxIterations = Number.isInteger(options.maxIterations)
    ? Math.max(0, options.maxIterations)
    : DEFAULT_MAX_IMPROVEMENT_ITERATIONS;
  const acceptedChanges = [];
  let currentAssignments = initialAssignments.map((assignment) => ({ ...assignment }));
  let currentContext = buildContext(scheduleInputs, currentAssignments, options);
  const initialDiagnosis = diagnoseSchedule(scheduleInputs, currentAssignments, currentContext);
  let currentDiagnosis = initialDiagnosis;
  let candidatesChecked = 0;
  let validCandidatesCount = 0;
  let iterationsRun = 0;
  let stopReason = maxIterations === 0 ? "max_iterations" : "no_improving_candidate";

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    // בכל איטרציה מייצרים שני סוגי מועמדים מתוך המצב הנוכחי: swap לחוזק ו-replace להוגנות.
    const candidates = [
      ...generateSwapCandidates(scheduleInputs, currentAssignments, currentDiagnosis, currentContext),
      ...generateReplaceCandidates(scheduleInputs, currentAssignments, currentDiagnosis, currentContext),
    ];
    // כל מועמד עובר validation, simulation ו-scoring לפני שבוחרים את השיפור הכי טוב.
    const evaluations = candidates.map((candidate) =>
      evaluateCandidate(candidate, scheduleInputs, currentAssignments, currentDiagnosis, currentContext)
    );
    const bestEvaluation = selectBestEvaluation(evaluations);

    candidatesChecked += candidates.length;
    validCandidatesCount += evaluations.filter((evaluation) => evaluation.validation.valid).length;

    if (!bestEvaluation) {
      stopReason = "no_improving_candidate";
      break;
    }

    // מקבלים רק את המהלך הכי טוב, בונים context חדש, וממשיכים מה-schedule המשופר.
    acceptedChanges.push(buildAcceptedChange(bestEvaluation, currentDiagnosis));
    currentAssignments = bestEvaluation.assignmentsAfter;
    currentContext = buildContext(scheduleInputs, currentAssignments, options);
    currentDiagnosis = bestEvaluation.diagnosisAfter;
    iterationsRun = iteration;

    if (iteration === maxIterations) {
      stopReason = "max_iterations";
    }
  }

  return {
    assignments: currentAssignments,
    diagnosis: currentDiagnosis,
    improvementSummary: buildImprovementSummary(
      initialDiagnosis,
      currentDiagnosis,
      options.enabled !== false,
      acceptedChanges,
      { maxIterations, iterationsRun, stopReason, candidatesChecked, validCandidatesCount }
    ),
  };
}

// הייצוא הציבורי משמש את מחולל הסידור וגם בדיקות ממוקדות של אלגוריתם השיפור.
module.exports = {
  SCORE_WEIGHTS,
  buildStrengthRange,
  calculateStrengthScore,
  diagnoseSchedule,
  calculateScheduleScore,
  generateSwapCandidates,
  generateReplaceCandidates,
  validateCandidate,
  applyCandidate,
  evaluateCandidate,
  runScheduleImprovement,
};
