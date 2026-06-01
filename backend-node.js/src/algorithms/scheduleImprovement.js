const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

// Constants and helpers - קבועים וכלי עזר בסיסיים.
// המשקלים קובעים כמה כל סוג בעיה משפיע על הציון הכללי של הסידור.
const SCORE_WEIGHTS = {
  coverageWeight: 1000,
  strengthWeight: 10,
  fairnessWeight: 4,
};

// קבועי גבול שמגדירים מתי פער נחשב משמעותי וכמה איטרציות שיפור מותר לבצע.
const FAIRNESS_GAP_THRESHOLD = 0.5;
const DEFAULT_MAX_IMPROVEMENT_ITERATIONS = 20;
const MIN_SCORE_IMPROVEMENT = 0.01;

// מעגלים ציונים כדי שהחישובים והסיכומים יהיו קריאים ועקביים.
function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

// ממירים ערך למספר בטוח כדי שערכים חסרים או לא תקינים לא ישברו את האלגוריתם.
function toNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

// Strength and fairness calculations - חישובי חוזק והוגנות.
// ותק תורם לחוזק העובד, אבל מוגבל לציון מקסימלי כדי לא לתת לו משקל מוגזם.
function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (toNumber(seniorityMonths) / 24) * 10);
}

function calculateStrengthScore(employee) {
  // מחשבים רכיב ותק ואז משלבים אותו עם מדדי איכות כדי לקבל ציון חוזק אחד לעובד.
  const seniorityScore = calculateSeniorityScore(employee.seniority_months);

  return (
    0.35 * toNumber(employee.professionalism) +
    0.3 * toNumber(employee.responsibility) +
    0.2 * toNumber(employee.pressure_handling) +
    0.1 * seniorityScore +
    0.05 * toNumber(employee.potential)
  );
}

function calculateTargetShifts(requestedShifts, strengthScore) {
  // יעד המשמרות משלב בין כמה העובד ביקש לבין החוזק שלו, כדי לשמור על חלוקה הוגנת אך גם יעילה.
  return toNumber(requestedShifts) * (0.55 + 0.45 * (strengthScore / 10));
}

function getRequiredCount(shift, roleConfig) {
  // שולפים את דרישת הכמות לפי התפקיד הנוכחי, למשל מלצרים או ברמנים.
  return toNumber(shift[roleConfig.requirementField]);
}

function getRoleStrengthTarget(shift, roleConfig, requiredCount) {
  // אם אין דרישה לתפקיד הזה במשמרת, אין גם יעד חוזק עבורו.
  if (requiredCount <= 0) {
    return 0;
  }

  // מחלקים את יעד החוזק הכללי לפי כמות העובדים הנדרשת באותו תפקיד.
  return (
    (toNumber(shift.required_strength_score) * requiredCount) /
    Math.max(1, toNumber(shift.required_waiters))
  );
}

function buildStrengthRange(requiredStrengthScore) {
  const target = toNumber(requiredStrengthScore);

  // כשאין יעד חוזק, לא מפעילים ענישה על חוזק באותה קבוצת תפקיד.
  if (target <= 0) {
    return {
      hasStrengthTarget: false,
      target: 0,
      margin: 0,
      minimum: 0,
      comfort: 0,
    };
  }

  // טווח החוזק מאפשר מעט גמישות סביב היעד, כדי לא לפסול סידור בגלל פער קטן.
  const margin = Math.max(2, target * 0.1);

  return {
    hasStrengthTarget: true,
    target,
    margin,
    minimum: Math.max(0, target - margin),
    comfort: target + margin,
  };
}

function buildStrengthScoreByEmployeeId(employees) {
  // Map: employeeId -> calculated strength score
  // המפה מאפשרת לשלוף במהירות את ציון החוזק של כל עובד בזמן אבחון ושיפור.
  return new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
}

function buildRequestedShiftCountsByEmployee(shiftRequests) {
  // Map: employeeId -> number of requested shifts
  // סופרים כמה משמרות כל עובד ביקש כדי לחשב אחר כך האם הוא מתחת או מעל היעד שלו.
  const requestedShiftCountsByEmployee = new Map();

  for (const shiftRequest of shiftRequests) {
    const employeeId = shiftRequest.employee_id;
    const requestedShifts = requestedShiftCountsByEmployee.get(employeeId) || 0;

    requestedShiftCountsByEmployee.set(employeeId, requestedShifts + 1);
  }

  return requestedShiftCountsByEmployee;
}

function buildAssignedShiftCountsByEmployee(assignments) {
  // Map: employeeId -> number of assigned shifts
  // סופרים כמה משמרות העובד קיבל בפועל כדי להשוות מול היעד ההוגן שלו.
  const assignedShiftCountsByEmployee = new Map();

  for (const assignment of assignments) {
    const assignedShifts =
      assignedShiftCountsByEmployee.get(assignment.employeeId) || 0;

    assignedShiftCountsByEmployee.set(assignment.employeeId, assignedShifts + 1);
  }

  return assignedShiftCountsByEmployee;
}

function buildEmployeeById(employees) {
  // Map: employeeId -> employee object
  // המפה חוסכת חיפושים חוזרים ברשימת העובדים בזמן יצירת מועמדים וולידציה.
  return new Map(employees.map((employee) => [employee.id, employee]));
}

function buildShiftById(shifts) {
  // Map: shiftId -> shift object
  // המפה מאפשרת לבדוק במהירות שהמשמרת של מועמד באמת קיימת.
  return new Map(shifts.map((shift) => [shift.id, shift]));
}

function buildAvailabilitySet(shiftRequests) {
  // Set: "employeeId:shiftId" -> employee is available for this shift
  // הסט מאפשר בדיקת זמינות מהירה לפני שמציעים או מאשרים שינוי בסידור.
  return new Set(
    shiftRequests.map(
      (shiftRequest) => `${shiftRequest.employee_id}:${shiftRequest.shift_id}`
    )
  );
}

function getAssignmentKey(assignment) {
  // Set key: "shiftId:employeeId:jobRole" -> assignment state / forced assignment key
  // אותו מפתח משמש לזיהוי שיבוץ בודד, למשל כדי להגן על שיבוצים כפויים.
  return `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`;
}

function buildAssignmentSummaryByShiftRole(assignments, strengthScoreByEmployeeId) {
  // Map: "shiftId:jobRole" -> summary of assigned count and strength
  // לכל משמרת ותפקיד מסכמים כמה עובדים שובצו ומה החוזק המצטבר שלהם.
  const summaryByShiftRole = new Map();

  for (const assignment of assignments) {
    // בונים מפתח לפי משמרת ותפקיד כדי שכל קבוצת תפקיד תאובחן בנפרד.
    const key = `${assignment.shiftId}:${assignment.jobRole}`;
    const summary = summaryByShiftRole.get(key) || {
      assignedCount: 0,
      actualStrength: 0,
    };

    summary.assignedCount += 1;
    summary.actualStrength +=
      strengthScoreByEmployeeId.get(assignment.employeeId) || 0;

    summaryByShiftRole.set(key, summary);
  }

  return summaryByShiftRole;
}

function calculateStrengthPenalty(actualStrength, strengthRange) {
  // אם אין יעד חוזק לקבוצה הזו, לא מוסיפים ענישה על חוזק.
  if (!strengthRange.hasStrengthTarget) {
    return 0;
  }

  // מתחת למינימום יש ענישה מלאה, כי זו משמרת שעלולה להיות חלשה מדי.
  if (actualStrength < strengthRange.minimum) {
    return strengthRange.minimum - actualStrength;
  }

  // בין המינימום ליעד יש ענישה קטנה יותר, כי הסידור סביר אבל לא אידיאלי.
  if (actualStrength < strengthRange.target) {
    return (strengthRange.target - actualStrength) * 0.25;
  }

  return 0;
}

// Schedule diagnosis - אבחון מצב הסידור.
function buildShiftRoleDiagnostics(scheduleInputs, assignments) {
  // לוקחים את כל העובדים האפשריים כדי לחשב חוזק גם עבור עובדים שכבר שובצו.
  const employees = scheduleInputs.allEmployees || scheduleInputs.employees || [];

  // Map: employeeId -> calculated strength score
  // משמש לחישוב החוזק המצטבר של כל קבוצת תפקיד במשמרת.
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);

  // Map: "shiftId:jobRole" -> summary of assigned count and strength
  // הסיכום הזה הוא הבסיס לזיהוי חוסר בכיסוי או חולשה במשמרת.
  const summaryByShiftRole = buildAssignmentSummaryByShiftRole(
    assignments,
    strengthScoreByEmployeeId
  );

  // עוברים על כל משמרת וכל תפקיד כדי לבדוק כל קבוצת תפקיד בנפרד.
  return (scheduleInputs.shifts || []).flatMap((shift) =>
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      // מחשבים כמה עובדים נדרשים ומה יעד החוזק של התפקיד במשמרת הזו.
      const requiredCount = getRequiredCount(shift, roleConfig);
      const requiredStrengthScore = getRoleStrengthTarget(
        shift,
        roleConfig,
        requiredCount
      );
      const strengthRange = buildStrengthRange(requiredStrengthScore);

      // Map lookup: "shiftId:jobRole" -> summary of assigned count and strength
      // אם אין שיבוצים לקבוצה הזו, מתחילים מסיכום ריק כדי לזהות חוסר כיסוי.
      const key = `${shift.id}:${roleConfig.jobRole}`;
      const summary = summaryByShiftRole.get(key) || {
        assignedCount: 0,
        actualStrength: 0,
      };

      // coverageDeficit מודד כמה עובדים חסרים ביחס לדרישה של המשמרת והתפקיד.
      const coverageDeficit = Math.max(0, requiredCount - summary.assignedCount);

      // strengthPenalty מודד כמה החוזק בפועל נמוך מהטווח הרצוי.
      const strengthPenalty = calculateStrengthPenalty(
        summary.actualStrength,
        strengthRange
      );

      // עודף חוזק מסמן משמרת שאולי אפשר לקחת ממנה עובד חזק לטובת משמרת חלשה.
      const strengthSurplus =
        strengthRange.hasStrengthTarget &&
        summary.actualStrength > strengthRange.comfort
          ? summary.actualStrength - strengthRange.comfort
          : 0;

      // משמרת חלשה היא קבוצה שהחוזק שלה מתחת למינימום ולכן מועמדת לשיפור מסוג swap.
      const isWeak =
        strengthRange.hasStrengthTarget &&
        summary.actualStrength < strengthRange.minimum;
      const hasSurplus = strengthSurplus > 0;

      // מחזירים רק את שדות האבחון שהאלגוריתם צריך להמשך יצירת מועמדים וניקוד.
      return {
        shiftId: shift.id,
        jobRole: roleConfig.jobRole,
        coverageDeficit,
        actualStrength: roundScore(summary.actualStrength),
        strengthRange: {
          hasStrengthTarget: strengthRange.hasStrengthTarget,
          minimum: roundScore(strengthRange.minimum),
        },
        strengthPenalty: roundScore(strengthPenalty),
        isWeak,
        hasSurplus,
      };
    })
  );
}

function buildEmployeeDiagnostics(scheduleInputs, assignments) {
  const employees = scheduleInputs.employees || [];

  // Map: employeeId -> number of requested shifts
  // מספר הבקשות עוזר לחשב יעד הוגן לכל עובד.
  const requestedShiftCountsByEmployee = buildRequestedShiftCountsByEmployee(
    scheduleInputs.shiftRequests || []
  );

  // Map: employeeId -> number of assigned shifts
  // מספר השיבוצים בפועל מושווה ליעד כדי למצוא עובדים שקיבלו יותר מדי או פחות מדי.
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(assignments);

  // לכל עובד מחשבים האם הוא מתחת ליעד או מעל היעד, כדי לזהות בעיות הוגנות.
  return employees.map((employee) => {
    const strengthScore = calculateStrengthScore(employee);
    const requestedShifts = requestedShiftCountsByEmployee.get(employee.id) || 0;
    const assignedShifts = assignedShiftCountsByEmployee.get(employee.id) || 0;
    const targetShifts = calculateTargetShifts(requestedShifts, strengthScore);
    const underTargetGap = Math.max(0, targetShifts - assignedShifts);
    const overTargetGap = Math.max(0, assignedShifts - targetShifts);

    // האבחון הזה משמש בעיקר ל-replace: להחליף עובד מעל היעד בעובד מתחת ליעד מאותו תפקיד.
    return {
      employeeId: employee.id,
      jobRole: employee.role,
      isUnderTarget: underTargetGap > FAIRNESS_GAP_THRESHOLD,
      isOverTarget: overTargetGap > FAIRNESS_GAP_THRESHOLD,
      fairnessPenalty:
        underTargetGap > FAIRNESS_GAP_THRESHOLD ||
        overTargetGap > FAIRNESS_GAP_THRESHOLD
          ? roundScore(underTargetGap + overTargetGap)
          : 0,
    };
  });
}

function calculateScheduleScore(diagnosis, weights = SCORE_WEIGHTS) {
  // totalScore מייצג את רמת הבעיה של הסידור: ככל שהוא נמוך יותר, הסידור טוב יותר.
  // כיסוי מקבל משקל גבוה במיוחד כדי לא לשפר הוגנות או חוזק על חשבון עובדים חסרים.
  return roundScore(
    diagnosis.coveragePenalty * weights.coverageWeight +
      diagnosis.strengthPenalty * weights.strengthWeight +
      diagnosis.fairnessPenalty * weights.fairnessWeight
  );
}

function diagnoseSchedule(scheduleInputs, assignments) {
  // בונים אבחון לפי משמרת ותפקיד כדי למצוא בעיות כיסוי וחוזק.
  const shiftRoleDiagnostics = buildShiftRoleDiagnostics(
    scheduleInputs,
    assignments
  );

  // בונים אבחון לפי עובד כדי למצוא פערי הוגנות בחלוקת המשמרות.
  const employeeDiagnostics = buildEmployeeDiagnostics(
    scheduleInputs,
    assignments
  );

  // coveragePenalty הוא סך כל החוסרים בכמות העובדים מול הדרישות.
  const coveragePenalty = roundScore(
    shiftRoleDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.coverageDeficit,
      0
    )
  );

  // strengthPenalty הוא סך בעיות החוזק בכל קבוצות התפקידים במשמרות.
  const strengthPenalty = roundScore(
    shiftRoleDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.strengthPenalty,
      0
    )
  );

  // fairnessPenalty הוא סך פערי ההוגנות בין יעד המשמרות לבין השיבוץ בפועל.
  const fairnessPenalty = roundScore(
    employeeDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.fairnessPenalty,
      0
    )
  );

  // מרכזים את האבחון כדי שהשלבים הבאים יוכלו ליצור מועמדים ולחשב שיפור.
  const diagnosis = {
    shiftRoleDiagnostics,
    employeeDiagnostics,
    coveragePenalty,
    strengthPenalty,
    fairnessPenalty,

    // weakShifts משמש ליצירת swap: משמרות שצריכות עובד חזק יותר.
    weakShifts: shiftRoleDiagnostics.filter((diagnostic) => diagnostic.isWeak),

    // surplusShifts משמש ליצירת swap: משמרות שאפשר אולי לקחת מהן עובד חזק.
    surplusShifts: shiftRoleDiagnostics.filter(
      (diagnostic) => diagnostic.hasSurplus
    ),

    // עובדים מתחת ליעד ומעל היעד משמשים ליצירת replace לטובת הוגנות.
    employeesUnderTarget: employeeDiagnostics.filter(
      (diagnostic) => diagnostic.isUnderTarget
    ),
    employeesOverTarget: employeeDiagnostics.filter(
      (diagnostic) => diagnostic.isOverTarget
    ),
  };

  // מחשבים ציון אחד מסכם כדי להשוות בקלות בין הסידור הנוכחי לבין מועמד לשיפור.
  diagnosis.totalScore = calculateScheduleScore(diagnosis);

  return diagnosis;
}

function isEmployeeAssignedToShift(assignments, employeeId, shiftId) {
  // בדיקה זו מונעת מצב שבו אותו עובד מופיע פעמיים באותה משמרת.
  return assignments.some(
    (assignment) =>
      assignment.employeeId === employeeId && assignment.shiftId === shiftId
  );
}

function findAssignmentForCandidate(assignments, candidate) {
  // מאתרים את השיבוץ שהחלפת replace אמורה להסיר לפני שמדמים את השינוי.
  return assignments.find(
    (assignment) =>
      assignment.shiftId === candidate.shiftId &&
      assignment.employeeId === candidate.removedEmployeeId &&
      assignment.jobRole === candidate.jobRole
  );
}

function findSwapAssignments(assignments, candidate) {
  // מאתרים את שני השיבוצים שה-swap אמור להחליף ביניהם.
  return {
    weakAssignment: assignments.find(
      (assignment) =>
        assignment.shiftId === candidate.weakShiftId &&
        assignment.employeeId === candidate.weakShiftEmployeeId &&
        assignment.jobRole === candidate.jobRole
    ),
    surplusAssignment: assignments.find(
      (assignment) =>
        assignment.shiftId === candidate.surplusShiftId &&
        assignment.employeeId === candidate.surplusShiftEmployeeId &&
        assignment.jobRole === candidate.jobRole
    ),
  };
}

function findShiftRoleDiagnostic(diagnosis, shiftId, jobRole) {
  // שולפים אבחון של משמרת ותפקיד כדי לבדוק השפעת שינוי על אותה קבוצה.
  return diagnosis.shiftRoleDiagnostics.find(
    (diagnostic) =>
      diagnostic.shiftId === shiftId && diagnostic.jobRole === jobRole
  );
}

// Candidate generation - יצירת מועמדים לשיפור.
function createsDuplicateAfterSwap(assignments, candidate) {
  // בודקים האם החלפת swap תגרום לעובד להיות משובץ פעמיים באותה משמרת.
  return assignments.some((assignment) => {
    // מתעלמים משני השיבוצים שה-swap עצמו אמור להזיז, כי הם עומדים להשתנות.
    const isWeakAssignment =
      assignment.shiftId === candidate.weakShiftId &&
      assignment.employeeId === candidate.weakShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole;
    const isSurplusAssignment =
      assignment.shiftId === candidate.surplusShiftId &&
      assignment.employeeId === candidate.surplusShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole;

    if (isWeakAssignment || isSurplusAssignment) {
      return false;
    }

    // אם אחד העובדים כבר נמצא במשמרת היעד של השני, ה-swap ייצור כפילות אסורה.
    return (
      (assignment.shiftId === candidate.weakShiftId &&
        assignment.employeeId === candidate.surplusShiftEmployeeId) ||
      (assignment.shiftId === candidate.surplusShiftId &&
        assignment.employeeId === candidate.weakShiftEmployeeId)
    );
  });
}

function calculateReplaceStrengthAfterCandidate(
  candidate,
  diagnostic,
  employeeById
) {
  // Map lookup: employeeId -> employee object
  // שולפים את העובד שיוצא ואת העובד שנכנס כדי לחשב את החוזק אחרי replace.
  const removedEmployee = employeeById.get(candidate.removedEmployeeId);
  const addedEmployee = employeeById.get(candidate.addedEmployeeId);

  // מחליפים את תרומת החוזק של העובד הישן בתרומת החוזק של העובד החדש.
  return (
    diagnostic.actualStrength -
    calculateStrengthScore(removedEmployee || {}) +
    calculateStrengthScore(addedEmployee || {})
  );
}

function generateReplaceCandidates(
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  const employees = scheduleInputs.employees || [];

  // Map: employeeId -> employee object
  // נדרש כדי לבדוק במהירות שהעובד החדש פעיל ושייך לאותו תפקיד.
  const employeeById = buildEmployeeById(employees);

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // replace מותר רק אם העובד החדש ביקש או זמין למשמרת הזו.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // שיבוץ כפוי לא נחשב לבחירה של האלגוריתם ולכן לא מזיזים אותו בשיפור.
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const candidates = [];

  // replace מיועד בעיקר להוגנות: מתחילים מעובד שקיבל יותר משמרות מהיעד שלו.
  for (const overTargetEmployee of diagnosis.employeesOverTarget) {
    // מחפשים שיבוצים של העובד שאפשר להסיר בלי לפגוע בשיבוץ כפוי.
    const removableAssignments = assignments.filter(
      (assignment) =>
        assignment.employeeId === overTargetEmployee.employeeId &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );

    for (const assignment of removableAssignments) {
      // מחפשים עובד מתחת ליעד באותו תפקיד, כדי שהשינוי לא ישבור התאמת תפקיד.
      const underTargetEmployees = diagnosis.employeesUnderTarget.filter(
        (employeeDiagnostic) =>
          employeeDiagnostic.jobRole === assignment.jobRole &&
          employeeDiagnostic.employeeId !== assignment.employeeId
      );

      for (const underTargetEmployee of underTargetEmployees) {
        // Map lookup: employeeId -> employee object
        // כאן בודקים את פרטי העובד שנרצה להכניס במקום העובד שמעל היעד.
        const addedEmployee = employeeById.get(underTargetEmployee.employeeId);

        // יוצרים מועמד רק אם העובד פעיל, באותו תפקיד, זמין, ולא כבר משובץ למשמרת.
        if (
          !addedEmployee ||
          !addedEmployee.is_active ||
          addedEmployee.role !== assignment.jobRole ||
          !availabilitySet.has(
            `${underTargetEmployee.employeeId}:${assignment.shiftId}`
          ) ||
          isEmployeeAssignedToShift(
            assignments,
            underTargetEmployee.employeeId,
            assignment.shiftId
          )
        ) {
          continue;
        }

        // המועמד מתאר את השינוי בלבד; האם הוא באמת טוב ייבדק בשלב ההערכה.
        candidates.push({
          type: "replace",
          shiftId: assignment.shiftId,
          jobRole: assignment.jobRole,
          removedEmployeeId: assignment.employeeId,
          addedEmployeeId: underTargetEmployee.employeeId,
          reason: "Replace over-target employee with under-target available employee in the same role.",
        });
      }
    }
  }

  return candidates;
}

function generateSwapCandidates(
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  const employees = scheduleInputs.employees || [];

  // Map: employeeId -> employee object
  // ב-swap צריך לבדוק את פרטי העובדים משתי המשמרות.
  const employeeById = buildEmployeeById(employees);

  // Map: employeeId -> calculated strength score
  // המפה מאפשרת להשוות חוזק בין העובד במשמרת החלשה לעובד במשמרת החזקה.
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // שני העובדים חייבים להיות זמינים למשמרות שאליהן הם יעברו.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // שיבוץ כפוי לא יוזז גם אם החלפה יכולה לשפר את הציון.
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const candidates = [];

  // swap מיועד בעיקר לשיפור חוזק: מתחילים ממשמרות חלשות שצריכות עובד חזק יותר.
  for (const weakShift of diagnosis.weakShifts) {
    // מחפשים את העובדים במשמרת החלשה שאפשר להזיז, בלי לגעת בשיבוצים כפויים.
    const weakAssignments = assignments.filter(
      (assignment) =>
        assignment.shiftId === weakShift.shiftId &&
        assignment.jobRole === weakShift.jobRole &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );

    // מחפשים משמרות מאותו תפקיד שיש להן עודף חוזק ויכולות אולי לתרום עובד חזק.
    const surplusShifts = diagnosis.surplusShifts.filter(
      (surplusShift) => surplusShift.jobRole === weakShift.jobRole
    );

    for (const surplusShift of surplusShifts) {
      // מאתרים את השיבוצים במשמרת החזקה שמותר להזיז.
      const surplusAssignments = assignments.filter(
        (assignment) =>
          assignment.shiftId === surplusShift.shiftId &&
          assignment.jobRole === surplusShift.jobRole &&
          !forcedAssignmentSet.has(getAssignmentKey(assignment))
      );

      for (const weakAssignment of weakAssignments) {
        for (const surplusAssignment of surplusAssignments) {
          // Map lookup: employeeId -> employee object
          // שולפים את שני העובדים כדי לבדוק תפקיד, פעילות וחוזק.
          const weakEmployee = employeeById.get(weakAssignment.employeeId);
          const surplusEmployee = employeeById.get(surplusAssignment.employeeId);

          // Map lookup: employeeId -> calculated strength score
          // ה-swap רלוונטי רק אם העובד מהמשמרת החזקה באמת חזק יותר.
          const weakEmployeeStrength =
            strengthScoreByEmployeeId.get(weakAssignment.employeeId) || 0;
          const surplusEmployeeStrength =
            strengthScoreByEmployeeId.get(surplusAssignment.employeeId) || 0;

          // שני העובדים חייבים להיות פעילים, באותו תפקיד, זמינים למשמרות ההפוכות, והעובד המחליף חייב להיות חזק יותר.
          if (
            !weakEmployee ||
            !surplusEmployee ||
            !weakEmployee.is_active ||
            !surplusEmployee.is_active ||
            weakEmployee.role !== weakShift.jobRole ||
            surplusEmployee.role !== weakShift.jobRole ||
            surplusEmployeeStrength <= weakEmployeeStrength ||
            !availabilitySet.has(
              `${weakAssignment.employeeId}:${surplusShift.shiftId}`
            ) ||
            !availabilitySet.has(
              `${surplusAssignment.employeeId}:${weakShift.shiftId}`
            )
          ) {
            continue;
          }

          // המועמד מתאר החלפה בין שתי משמרות באותו תפקיד.
          const candidate = {
            type: "swap",
            weakShiftId: weakShift.shiftId,
            surplusShiftId: surplusShift.shiftId,
            jobRole: weakShift.jobRole,
            weakShiftEmployeeId: weakAssignment.employeeId,
            surplusShiftEmployeeId: surplusAssignment.employeeId,
            reason: "Swap stronger same-role employee from surplus shift into weak shift.",
          };

          // לא מוסיפים מועמד שיגרום לעובד להופיע פעמיים באותה משמרת.
          if (createsDuplicateAfterSwap(assignments, candidate)) {
            continue;
          }

          // בשלב הזה המועמד חוקי בסיסית, והאם הוא באמת משפר ייבדק בהערכה.
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
}

// Candidate validation - בדיקת חוקיות מועמדים.
function validateSwapAssignments(candidate, assignments, forcedAssignmentSet) {
  const reasons = [];

  // מאתרים את שני השיבוצים שהמועמד טוען שהוא רוצה להחליף.
  const { weakAssignment, surplusAssignment } = findSwapAssignments(
    assignments,
    candidate
  );

  // אם אחד השיבוצים לא קיים, אי אפשר לבצע את ה-swap בצורה אמינה.
  if (!weakAssignment) {
    reasons.push("Weak shift assignment does not exist.");
  }

  if (!surplusAssignment) {
    reasons.push("Surplus shift assignment does not exist.");
  }

  if (weakAssignment && surplusAssignment) {
    // שני הצדדים חייבים להיות באותו תפקיד כדי שלא נחליף מלצר בברמן וכדומה.
    if (weakAssignment.jobRole !== surplusAssignment.jobRole) {
      reasons.push("Swap assignments are not in the same jobRole.");
    }

    // swap אמור להעביר עובדים בין שתי משמרות שונות, לא בתוך אותה משמרת.
    if (weakAssignment.shiftId === surplusAssignment.shiftId) {
      reasons.push("Swap assignments must belong to different shifts.");
    }

    // Set: "shiftId:employeeId:jobRole" -> forced assignment key
    // הגנה על שיבוץ כפוי מונעת מהשיפור להזיז החלטה שהוגדרה מראש.
    if (
      forcedAssignmentSet.has(getAssignmentKey(weakAssignment)) ||
      forcedAssignmentSet.has(getAssignmentKey(surplusAssignment))
    ) {
      reasons.push("Cannot swap a forced assignment.");
    }
  }

  return reasons;
}

function validateSwapEmployees(candidate, employees, strengthScoreByEmployeeId) {
  const reasons = [];

  // Map: employeeId -> employee object
  // שולפים את שני העובדים כדי לוודא שהם קיימים, פעילים ומתאימים לתפקיד.
  const employeeById = buildEmployeeById(employees);
  const weakEmployee = employeeById.get(candidate.weakShiftEmployeeId);
  const surplusEmployee = employeeById.get(candidate.surplusShiftEmployeeId);

  // swap לא יכול להתבצע אם אחד העובדים כבר לא קיים במערכת.
  if (!weakEmployee || !surplusEmployee) {
    reasons.push("Swap employee does not exist.");
  } else {
    // עובד לא פעיל לא יכול להשתתף בשיבוץ או בשיפור.
    if (!weakEmployee.is_active || !surplusEmployee.is_active) {
      reasons.push("Swap employee is not active.");
    }

    // שני העובדים חייבים להתאים לתפקיד של המועמד.
    if (
      weakEmployee.role !== candidate.jobRole ||
      surplusEmployee.role !== candidate.jobRole
    ) {
      reasons.push("Swap employee does not match candidate jobRole.");
    }

    // Map lookup: employeeId -> calculated strength score
    // בודקים שהעובד שמגיע מהמשמרת החזקה באמת חזק יותר מהעובד שהוא מחליף.
    const weakEmployeeStrength =
      strengthScoreByEmployeeId.get(candidate.weakShiftEmployeeId) || 0;
    const surplusEmployeeStrength =
      strengthScoreByEmployeeId.get(candidate.surplusShiftEmployeeId) || 0;

    if (surplusEmployeeStrength <= weakEmployeeStrength) {
      reasons.push("Surplus shift employee is not stronger than weak shift employee.");
    }
  }

  return reasons;
}

function validateSwapAvailability(candidate, availabilitySet) {
  const reasons = [];

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // שני העובדים חייבים להיות זמינים למשמרת שאליה הם יעברו אחרי ההחלפה.
  if (
    !availabilitySet.has(
      `${candidate.weakShiftEmployeeId}:${candidate.surplusShiftId}`
    ) ||
    !availabilitySet.has(
      `${candidate.surplusShiftEmployeeId}:${candidate.weakShiftId}`
    )
  ) {
    reasons.push("Swap employee is not available for the target shift.");
  }

  return reasons;
}

function validateSwapNoDuplicates(assignments, candidate) {
  const reasons = [];

  // הגנה מפני כפילות: אותו עובד לא יכול להיות משובץ פעמיים באותה משמרת.
  if (createsDuplicateAfterSwap(assignments, candidate)) {
    reasons.push("Swap would create a duplicate employee assignment.");
  }

  return reasons;
}

function validateSwapImpact(candidate, scheduleInputs, assignments, diagnosis) {
  const reasons = [];

  // מדמים את ה-swap כדי לבדוק את ההשפעה שלו על הסידור בלי לשנות עדיין את הסידור האמיתי.
  const candidateAssignments = applyCandidate(assignments, candidate);
  const candidateDiagnosis = diagnoseSchedule(
    scheduleInputs,
    candidateAssignments
  );

  // מאתרים את המשמרת שממנה נלקח העובד החזק כדי לוודא שהיא לא נחלשה יותר מדי.
  const surplusDiagnosticAfter = findShiftRoleDiagnostic(
    candidateDiagnosis,
    candidate.surplusShiftId,
    candidate.jobRole
  );

  // השיפור לא אמור לשנות כיסוי; אסור לתקן חוזק על חשבון כמות עובדים חסרה.
  if (candidateDiagnosis.coveragePenalty !== diagnosis.coveragePenalty) {
    reasons.push("Swap would change coverage.");
  }

  // אם ענישת החוזק גדלה, ההחלפה לא באמת משפרת את מטרת ה-swap.
  if (candidateDiagnosis.strengthPenalty > diagnosis.strengthPenalty) {
    reasons.push("Swap would increase strength penalty.");
  }

  // מאפשרים שינוי קטן בהוגנות, אבל לא החמרה משמעותית.
  if (candidateDiagnosis.fairnessPenalty > diagnosis.fairnessPenalty + 0.5) {
    reasons.push("Swap would significantly worsen fairness.");
  }

  // בסוף ה-swap חייב להוריד את הציון הכללי, אחרת אין סיבה לקבל אותו.
  if (candidateDiagnosis.totalScore >= diagnosis.totalScore) {
    reasons.push("Swap would not improve total score.");
  }

  // מוודאים שהמשמרת שתרמה את העובד החזק לא יורדת מתחת למינימום חוזק.
  if (
    surplusDiagnosticAfter &&
    surplusDiagnosticAfter.strengthRange.hasStrengthTarget &&
    surplusDiagnosticAfter.actualStrength <
      surplusDiagnosticAfter.strengthRange.minimum
  ) {
    reasons.push("Swap would move the surplus shift below the minimum strength range.");
  }

  return reasons;
}

function validateSwapCandidate(
  candidate,
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  const reasons = [];
  const employees = scheduleInputs.employees || [];

  // Map: employeeId -> calculated strength score
  // משמש לוולידציה שה-swap באמת מעביר עובד חזק יותר למשמרת החלשה.
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // משמש לוודא ששני העובדים זמינים למשמרות שאליהן יעברו.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // משמש למנוע הזזה של שיבוצים כפויים.
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();

  // ולידציית swap מחולקת לשלבים כדי להבין איזה חוק נכשל אם המועמד לא חוקי.
  reasons.push(
    ...validateSwapAssignments(candidate, assignments, forcedAssignmentSet)
  );
  reasons.push(
    ...validateSwapEmployees(candidate, employees, strengthScoreByEmployeeId)
  );
  reasons.push(...validateSwapAvailability(candidate, availabilitySet));
  reasons.push(...validateSwapNoDuplicates(assignments, candidate));

  // רק אם כל בדיקות החוקיות עברו, מדמים את ההשפעה על הציון והעונשים.
  if (!reasons.length) {
    reasons.push(
      ...validateSwapImpact(candidate, scheduleInputs, assignments, diagnosis)
    );
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

function validateCandidate(
  candidate,
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  const reasons = [];
  const employees = scheduleInputs.employees || [];

  // Map: employeeId -> employee object
  // נדרש לבדיקת העובד שנכנס ב-replace.
  const employeeById = buildEmployeeById(employees);

  // Map: shiftId -> shift object
  // נדרש לוודא שהמשמרת של המועמד קיימת.
  const shiftById = buildShiftById(scheduleInputs.shifts || []);

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // replace מותר רק אם העובד החדש זמין למשמרת.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // מגן על שיבוץ כפוי מהחלפה.
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();

  // ולידציה כללית מגנה על האלגוריתם ממועמד לא מוכר או לא תקין.
  if (!candidate || !["replace", "swap"].includes(candidate.type)) {
    reasons.push("Unsupported candidate type.");
    return {
      valid: false,
      reasons,
    };
  }

  // מועמד swap נבדק במסלול הוולידציה הייעודי שלו.
  if (candidate.type === "swap") {
    return validateSwapCandidate(
      candidate,
      scheduleInputs,
      assignments,
      diagnosis,
      context
    );
  }

  // עבור replace מאתרים את השיבוץ שיוסר, העובד שייכנס, והמשמרת הרלוונטית.
  const removedAssignment = findAssignmentForCandidate(assignments, candidate);
  const addedEmployee = employeeById.get(candidate.addedEmployeeId);
  const shift = shiftById.get(candidate.shiftId);

  // אי אפשר להחליף שיבוץ שלא קיים, ואי אפשר להחליף שיבוץ כפוי.
  if (!removedAssignment) {
    reasons.push("Removed assignment does not exist.");
  } else if (forcedAssignmentSet.has(getAssignmentKey(removedAssignment))) {
    reasons.push("Cannot replace a forced assignment.");
  }

  if (!shift) {
    reasons.push("Shift does not exist.");
  }

  // העובד שנכנס חייב להיות קיים, פעיל, ומתאים לתפקיד של השיבוץ.
  if (!addedEmployee) {
    reasons.push("Added employee does not exist.");
  } else {
    if (!addedEmployee.is_active) {
      reasons.push("Added employee is not active.");
    }

    if (addedEmployee.role !== candidate.jobRole) {
      reasons.push("Added employee does not match candidate jobRole.");
    }
  }

  if (removedAssignment && removedAssignment.jobRole !== candidate.jobRole) {
    reasons.push("Removed assignment does not match candidate jobRole.");
  }

  // Set lookup: "employeeId:shiftId" -> employee is available for this shift
  // בדיקת זמינות מונעת הכנסת עובד למשמרת שהוא לא יכול לעבוד בה.
  if (!availabilitySet.has(`${candidate.addedEmployeeId}:${candidate.shiftId}`)) {
    reasons.push("Added employee is not available for the shift.");
  }

  // מוודאים שהעובד שנכנס לא כבר מופיע באותה משמרת.
  if (
    isEmployeeAssignedToShift(
      assignments,
      candidate.addedEmployeeId,
      candidate.shiftId
    )
  ) {
    reasons.push("Added employee is already assigned to this shift.");
  }

  // בודקים את אבחון המשמרת כדי לוודא שה-replace לא יוריד את החוזק מתחת למינימום.
  const diagnostic = findShiftRoleDiagnostic(
    diagnosis,
    candidate.shiftId,
    candidate.jobRole
  );

  if (!diagnostic) {
    reasons.push("Shift role diagnostic does not exist.");
  } else {
    // אם יש יעד חוזק, מחשבים את החוזק הצפוי אחרי ההחלפה לפני שמאשרים אותה.
    if (diagnostic.strengthRange.hasStrengthTarget) {
      const strengthAfterReplace = calculateReplaceStrengthAfterCandidate(
        candidate,
        diagnostic,
        employeeById
      );

      if (strengthAfterReplace < diagnostic.strengthRange.minimum) {
        reasons.push("Shift strength would drop below the minimum range.");
      }
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

// Candidate application and evaluation - החלת מועמד והערכתו.
function applyCandidate(assignments, candidate) {
  // הפונקציה לא מחליטה אם מועמד טוב; היא רק בונה את רשימת השיבוצים אחרי השינוי.
  if (!candidate || !["replace", "swap"].includes(candidate.type)) {
    return assignments.map((assignment) => ({ ...assignment }));
  }

  // ב-swap מחליפים רק את shiftId בין שני העובדים, והתפקיד נשאר אותו תפקיד.
  if (candidate.type === "swap") {
    return assignments.map((assignment) => {
      // העובד מהמשמרת החלשה עובר למשמרת שממנה הגיע העובד החזק.
      if (
        assignment.shiftId === candidate.weakShiftId &&
        assignment.employeeId === candidate.weakShiftEmployeeId &&
        assignment.jobRole === candidate.jobRole
      ) {
        return {
          ...assignment,
          shiftId: candidate.surplusShiftId,
        };
      }

      // העובד החזק עובר למשמרת החלשה כדי לשפר את החוזק שלה.
      if (
        assignment.shiftId === candidate.surplusShiftId &&
        assignment.employeeId === candidate.surplusShiftEmployeeId &&
        assignment.jobRole === candidate.jobRole
      ) {
        return {
          ...assignment,
          shiftId: candidate.weakShiftId,
        };
      }

      return {
        ...assignment,
      };
    });
  }

  // ב-replace מסירים שיבוץ אחד ומייצרים רשימה חדשה בלי לשנות את המקור.
  const nextAssignments = assignments
    .filter(
      (assignment) =>
        !(
          assignment.shiftId === candidate.shiftId &&
          assignment.employeeId === candidate.removedEmployeeId &&
          assignment.jobRole === candidate.jobRole
        )
    )
    .map((assignment) => ({ ...assignment }));

  // לאחר ההסרה מוסיפים את העובד החדש לאותה משמרת ולאותו תפקיד.
  nextAssignments.push({
    shiftId: candidate.shiftId,
    employeeId: candidate.addedEmployeeId,
    jobRole: candidate.jobRole,
  });

  return nextAssignments;
}

function evaluateCandidate(
  candidate,
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  // קודם מאמתים את המועמד, כי אין טעם לחשב שיפור למועמד לא חוקי.
  const validation = validateCandidate(
    candidate,
    scheduleInputs,
    assignments,
    diagnosis,
    context
  );

  // מועמד לא חוקי חוזר עם מידע בסיסי, אבל בלי סימולציה ובלי ציון אחרי.
  if (!validation.valid) {
    return {
      candidate,
      validation,
      scoreBefore: diagnosis.totalScore,
      scoreAfter: null,
      improvesScore: false,
      improvesFairness: false,
      improvesStrength: false,
      coveragePenaltyBefore: diagnosis.coveragePenalty,
      coveragePenaltyAfter: null,
      strengthPenaltyBefore: diagnosis.strengthPenalty,
      strengthPenaltyAfter: null,
      fairnessPenaltyBefore: diagnosis.fairnessPenalty,
      fairnessPenaltyAfter: null,
      diagnosisAfter: null,
      assignmentsAfter: null,
    };
  }

  // מדמים את הסידור אחרי החלת המועמד כדי לראות מה יקרה אם נקבל אותו.
  const candidateAssignments = applyCandidate(assignments, candidate);

  // מאבחנים את הסידור המדומה כדי לקבל כיסוי, חוזק, הוגנות וציון כולל אחרי השינוי.
  const candidateDiagnosis = diagnoseSchedule(
    scheduleInputs,
    candidateAssignments
  );

  // משווים לפני ואחרי כדי ששלב הבחירה יוכל לדעת האם המועמד באמת משפר.
  return {
    candidate,
    validation,
    scoreBefore: diagnosis.totalScore,
    scoreAfter: candidateDiagnosis.totalScore,
    improvesScore: candidateDiagnosis.totalScore < diagnosis.totalScore,
    improvesFairness:
      candidateDiagnosis.fairnessPenalty < diagnosis.fairnessPenalty,
    improvesStrength:
      candidateDiagnosis.strengthPenalty < diagnosis.strengthPenalty,
    coveragePenaltyBefore: diagnosis.coveragePenalty,
    coveragePenaltyAfter: candidateDiagnosis.coveragePenalty,
    strengthPenaltyBefore: diagnosis.strengthPenalty,
    strengthPenaltyAfter: candidateDiagnosis.strengthPenalty,
    fairnessPenaltyBefore: diagnosis.fairnessPenalty,
    fairnessPenaltyAfter: candidateDiagnosis.fairnessPenalty,
    diagnosisAfter: candidateDiagnosis,
    assignmentsAfter: candidateAssignments,
  };
}

// Candidate selection - בחירת המועמד הטוב ביותר.
function buildAssignmentStateSignature(assignments) {
  // Set key: "shiftId:employeeId:jobRole" -> assignment state / forced assignment key
  // כאן מחברים את כל השיבוצים למחרוזת אחת כדי לזהות מצב סידור שכבר ראינו.
  return assignments
    .map(
      (assignment) =>
        `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`
    )
    .sort()
    .join("|");
}

function isAcceptableImprovement(evaluation, currentDiagnosis) {
  // מסננים מועמדים לא חוקיים, מועמדים בלי ציון, או שיפור קטן מדי.
  if (
    !evaluation.validation.valid ||
    evaluation.scoreAfter === null ||
    currentDiagnosis.totalScore - evaluation.scoreAfter < MIN_SCORE_IMPROVEMENT ||
    evaluation.coveragePenaltyAfter > evaluation.coveragePenaltyBefore
  ) {
    return false;
  }

  // replace נועד לשפר הוגנות, לכן הוא חייב להקטין את ענישת ההוגנות.
  if (
    evaluation.candidate.type === "replace" &&
    evaluation.fairnessPenaltyAfter >= evaluation.fairnessPenaltyBefore
  ) {
    return false;
  }

  // swap נועד לשפר חוזק, ולכן הוא חייב להקטין ענישת חוזק בלי לפגוע משמעותית בהוגנות.
  if (
    evaluation.candidate.type === "swap" &&
    (evaluation.strengthPenaltyAfter >= evaluation.strengthPenaltyBefore ||
      evaluation.fairnessPenaltyAfter > evaluation.fairnessPenaltyBefore + 0.5)
  ) {
    return false;
  }

  // בסוף כל מועמד חייב להוריד את הציון הכללי של הסידור.
  return evaluation.scoreAfter < currentDiagnosis.totalScore;
}

function selectBestCandidateEvaluation(
  evaluations,
  currentDiagnosis,
  visitedAssignmentStates
) {
  let repeatedStateCandidatesCount = 0;

  // מסננים רק מועמדים שהם שיפור אמיתי לפי כללי הקבלה של האלגוריתם.
  const bestEvaluation =
    evaluations
      .filter((evaluation) => {
        if (!isAcceptableImprovement(evaluation, currentDiagnosis)) {
          return false;
        }

        // Set: full assignment signature -> schedule state was already visited
        // דוחים מצב שכבר ראינו כדי למנוע לולאה שחוזרת לאותו סידור.
        const candidateSignature = buildAssignmentStateSignature(
          evaluation.assignmentsAfter
        );

        if (visitedAssignmentStates.has(candidateSignature)) {
          repeatedStateCandidatesCount += 1;
          return false;
        }

        return true;
      })

      // בוחרים את המועמד עם השיפור הגדול ביותר בציון הכולל.
      .sort((leftEvaluation, rightEvaluation) => {
        const leftImprovement =
          currentDiagnosis.totalScore - leftEvaluation.scoreAfter;
        const rightImprovement =
          currentDiagnosis.totalScore - rightEvaluation.scoreAfter;

        if (rightImprovement !== leftImprovement) {
          return rightImprovement - leftImprovement;
        }

        // אם השיפור זהה, משתמשים בסדר יציב לפי סוג המועמד.
        return leftEvaluation.candidate.type.localeCompare(
          rightEvaluation.candidate.type
        );
      })[0] || null;

  return {
    bestEvaluation,
    repeatedStateCandidatesCount,
  };
}

// Summary building - בניית סיכום ריצה.
function buildAcceptedChange(evaluation, currentDiagnosis, candidateDiagnosis) {
  // הסיכום הזה מיועד לדיווח: איזה שינוי התקבל ומה השתנה בציונים.
  return {
    ...evaluation.candidate,
    scoreBefore: currentDiagnosis.totalScore,
    scoreAfter: candidateDiagnosis.totalScore,
    fairnessPenaltyBefore: currentDiagnosis.fairnessPenalty,
    fairnessPenaltyAfter: candidateDiagnosis.fairnessPenalty,
    strengthPenaltyBefore: currentDiagnosis.strengthPenalty,
    strengthPenaltyAfter: candidateDiagnosis.strengthPenalty,
    coveragePenaltyBefore: currentDiagnosis.coveragePenalty,
    coveragePenaltyAfter: candidateDiagnosis.coveragePenalty,
  };
}

function buildIterationHistoryEntry(
  iteration,
  evaluation,
  currentDiagnosis,
  candidateDiagnosis,
  iterationStats
) {
  // היסטוריית האיטרציות משמשת להסבר ולבדיקה, לא לבחירת מועמדים בהמשך.
  return {
    iteration,
    acceptedChangeType: evaluation.candidate.type,
    scoreBefore: currentDiagnosis.totalScore,
    scoreAfter: candidateDiagnosis.totalScore,
    scoreImprovement: roundScore(
      currentDiagnosis.totalScore - candidateDiagnosis.totalScore
    ),
    coveragePenaltyBefore: currentDiagnosis.coveragePenalty,
    coveragePenaltyAfter: candidateDiagnosis.coveragePenalty,
    strengthPenaltyBefore: currentDiagnosis.strengthPenalty,
    strengthPenaltyAfter: candidateDiagnosis.strengthPenalty,
    strengthPenaltyImprovement: roundScore(
      currentDiagnosis.strengthPenalty - candidateDiagnosis.strengthPenalty
    ),
    fairnessPenaltyBefore: currentDiagnosis.fairnessPenalty,
    fairnessPenaltyAfter: candidateDiagnosis.fairnessPenalty,
    fairnessPenaltyImprovement: roundScore(
      currentDiagnosis.fairnessPenalty - candidateDiagnosis.fairnessPenalty
    ),
    candidatesGenerated: iterationStats.candidatesGenerated,
    validCandidatesCount: iterationStats.validCandidatesCount,
    replaceCandidatesCount: iterationStats.replaceCandidatesCount,
    swapCandidatesCount: iterationStats.swapCandidatesCount,
    rejectedRepeatedStateCandidatesCount:
      iterationStats.rejectedRepeatedStateCandidatesCount,
  };
}

function buildImprovementSummary(
  initialDiagnosis,
  finalDiagnosis,
  enabled = true,
  candidateStats = {},
  acceptedChanges = [],
  loopSummary = {}
) {
  // סיכום השיפור מציג תמונה קצרה של הריצה: לפני, אחרי, כמה מועמדים וכמה שינויים התקבלו.
  return {
    enabled,
    phase: "iterative-local-search",
    maxIterations:
      loopSummary.maxIterations || DEFAULT_MAX_IMPROVEMENT_ITERATIONS,
    iterationsRun: acceptedChanges.length,
    stopReason: loopSummary.stopReason || "not_started",
    rejectedRepeatedStateCandidatesCount:
      loopSummary.rejectedRepeatedStateCandidatesCount || 0,
    acceptedChangesCount: acceptedChanges.length,
    acceptedChanges,
    iterationHistory: loopSummary.iterationHistory || [],
    initialScore: initialDiagnosis.totalScore,
    finalScore: finalDiagnosis.totalScore,
    scoreImprovement: roundScore(
      initialDiagnosis.totalScore - finalDiagnosis.totalScore
    ),
    initialCoveragePenalty: initialDiagnosis.coveragePenalty,
    finalCoveragePenalty: finalDiagnosis.coveragePenalty,
    initialStrengthPenalty: initialDiagnosis.strengthPenalty,
    finalStrengthPenalty: finalDiagnosis.strengthPenalty,
    initialFairnessPenalty: initialDiagnosis.fairnessPenalty,
    finalFairnessPenalty: finalDiagnosis.fairnessPenalty,
    replaceCandidatesCount: candidateStats.replaceCandidatesCount || 0,
    validReplaceCandidatesCount:
      candidateStats.validReplaceCandidatesCount || 0,
    swapCandidatesCount: candidateStats.swapCandidatesCount || 0,
    validSwapCandidatesCount: candidateStats.validSwapCandidatesCount || 0,
  };
}

// Main improvement loop - לולאת השיפור הראשית.
function runScheduleImprovement(scheduleInputs, initialAssignments, options = {}) {
  // בונים אבחון ראשוני של הסידור כדי לדעת מה מצב הכיסוי, החוזק וההוגנות לפני שמנסים לשפר.
  const initialDiagnosis = diagnoseSchedule(scheduleInputs, initialAssignments);

  // שומרים את השיבוצים הכפויים כדי ששלב השיפור לא ינסה להזיז שיבוץ שלא באמת הייתה בו בחירה.
  const context = {
    // Set: "shiftId:employeeId:jobRole" -> forced assignment key
    forcedAssignmentSet: options.forcedAssignmentSet || new Set(),
  };

  // קובעים גבול איטרציות כדי שהשיפור יישאר נשלט ולא ירוץ בלי סוף.
  const maxIterations = Number.isInteger(options.maxIterations)
    ? Math.max(0, options.maxIterations)
    : DEFAULT_MAX_IMPROVEMENT_ITERATIONS;

  // מונים כמה מועמדים נוצרו ונמצאו חוקיים; זה מיועד לסיכום ולא לבחירת המועמד.
  const candidateStats = {
    replaceCandidatesCount: 0,
    validReplaceCandidatesCount: 0,
    swapCandidatesCount: 0,
    validSwapCandidatesCount: 0,
    rejectedRepeatedStateCandidatesCount: 0,
  };

  // שומרים את השינויים שהתקבלו בפועל כדי להסביר מה האלגוריתם עשה.
  const acceptedChanges = [];

  // שומרים היסטוריה קצרה של כל איטרציה שהתקבלה לצורך דיווח ובדיקה.
  const iterationHistory = [];

  // Set: full assignment signature -> schedule state was already visited
  // מתחילים מהמצב הראשוני כדי שלא נחזור אליו בהמשך וניצור לולאה.
  const visitedAssignmentStates = new Set([
    buildAssignmentStateSignature(initialAssignments),
  ]);

  // משתנים אלה מייצגים את מצב הסידור הנוכחי שהלולאה מנסה לשפר.
  let rejectedRepeatedStateCandidatesCount = 0;
  let currentAssignments = initialAssignments;
  let currentDiagnosis = initialDiagnosis;

  // ברירת המחדל היא שאין מועמד משפר; הסיבה תשתנה אם הגענו למגבלת איטרציות או סף שיפור.
  let stopReason = maxIterations === 0 ? "max_iterations" : "no_improving_candidate";

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    // יוצרים מועמדי replace שמטרתם העיקרית היא לשפר הוגנות בין עובדים.
    const replaceCandidates = generateReplaceCandidates(
      scheduleInputs,
      currentAssignments,
      currentDiagnosis,
      context
    );

    // יוצרים מועמדי swap שמטרתם העיקרית היא לחזק משמרות חלשות.
    const swapCandidates = generateSwapCandidates(
      scheduleInputs,
      currentAssignments,
      currentDiagnosis,
      context
    );

    // מעריכים כל replace: קודם ולידציה, אחר כך סימולציה, ואז השוואת ציון לפני/אחרי.
    const replaceCandidateEvaluations = replaceCandidates.map((candidate) =>
      evaluateCandidate(
        candidate,
        scheduleInputs,
        currentAssignments,
        currentDiagnosis,
        context
      )
    );

    // מעריכים כל swap באותו תהליך כדי שאפשר יהיה להשוות את כל המועמדים יחד.
    const swapCandidateEvaluations = swapCandidates.map((candidate) =>
      evaluateCandidate(
        candidate,
        scheduleInputs,
        currentAssignments,
        currentDiagnosis,
        context
      )
    );

    // מאחדים את כל ההערכות כדי לבחור מתוכן את השיפור הטוב ביותר באיטרציה הזו.
    const allCandidateEvaluations = [
      ...replaceCandidateEvaluations,
      ...swapCandidateEvaluations,
    ];

    // בוחרים מועמד אחד בלבד: חוקי, משפר, לא חוזר למצב קודם, ובעל שיפור הציון הגדול ביותר.
    const selectionResult = selectBestCandidateEvaluation(
      allCandidateEvaluations,
      currentDiagnosis,
      visitedAssignmentStates
    );
    const bestCandidateEvaluation = selectionResult.bestEvaluation;

    // סופרים מועמדים שנדחו כי היו מחזירים את הסידור למצב שכבר נבדק.
    rejectedRepeatedStateCandidatesCount +=
      selectionResult.repeatedStateCandidatesCount;

    // סופרים כמה מועמדים עברו ולידציה כדי להציג בסיכום כמה אפשרויות אמיתיות היו.
    const validReplaceCandidatesCount = replaceCandidateEvaluations.filter(
      (evaluation) => evaluation.validation.valid
    ).length;
    const validSwapCandidatesCount = swapCandidateEvaluations.filter(
      (evaluation) => evaluation.validation.valid
    ).length;

    // נתוני איטרציה משמשים רק לדיווח על מה קרה בסבב הנוכחי.
    const iterationStats = {
      candidatesGenerated:
        replaceCandidates.length + swapCandidates.length,
      validCandidatesCount:
        validReplaceCandidatesCount + validSwapCandidatesCount,
      replaceCandidatesCount: replaceCandidates.length,
      swapCandidatesCount: swapCandidates.length,
      rejectedRepeatedStateCandidatesCount:
        selectionResult.repeatedStateCandidatesCount,
    };

    // מעדכנים סטטיסטיקות מצטברות לסיכום הסופי.
    candidateStats.replaceCandidatesCount += replaceCandidates.length;
    candidateStats.validReplaceCandidatesCount +=
      validReplaceCandidatesCount;
    candidateStats.swapCandidatesCount += swapCandidates.length;
    candidateStats.validSwapCandidatesCount += validSwapCandidatesCount;
    candidateStats.rejectedRepeatedStateCandidatesCount =
      rejectedRepeatedStateCandidatesCount;

    // אם לא נמצא מועמד משפר, הלולאה מסתיימת כי אין עוד שינוי בטוח שמועיל לסידור.
    if (!bestCandidateEvaluation) {
      stopReason = "no_improving_candidate";
      break;
    }

    // משתמשים בתוצאה שכבר חושבה בהערכה, ואם היא חסרה מחשבים אותה מחדש.
    const candidateAssignments =
      bestCandidateEvaluation.assignmentsAfter ||
      applyCandidate(currentAssignments, bestCandidateEvaluation.candidate);
    const candidateDiagnosis =
      bestCandidateEvaluation.diagnosisAfter ||
      diagnoseSchedule(scheduleInputs, candidateAssignments);
    const scoreImprovement =
      currentDiagnosis.totalScore - candidateDiagnosis.totalScore;

    // אם השיפור קטן מדי, לא מקבלים אותו כדי לא לבצע שינוי חסר משמעות.
    if (scoreImprovement < MIN_SCORE_IMPROVEMENT) {
      stopReason = "min_improvement_threshold";
      break;
    }

    // מתעדים את השינוי שהתקבל כדי שיהיה אפשר להסביר מה השתנה בסידור.
    acceptedChanges.push(
      buildAcceptedChange(
        bestCandidateEvaluation,
        currentDiagnosis,
        candidateDiagnosis
      )
    );

    // שומרים רשומת איטרציה עם הציונים לפני ואחרי לצורך סיכום ובדיקה.
    iterationHistory.push(
      buildIterationHistoryEntry(
        iteration,
        bestCandidateEvaluation,
        currentDiagnosis,
        candidateDiagnosis,
        iterationStats
      )
    );

    // Set: full assignment signature -> schedule state was already visited
    // מוסיפים את המצב החדש כדי שלא נבחר בעתיד שינוי שמחזיר אותנו אליו.
    visitedAssignmentStates.add(
      buildAssignmentStateSignature(candidateAssignments)
    );

    // מעכשיו הסידור המשופר הוא נקודת ההתחלה לאיטרציה הבאה.
    currentAssignments = candidateAssignments;
    currentDiagnosis = candidateDiagnosis;

    // אם הגענו לאיטרציה האחרונה, הסיבה לעצירה היא מגבלת האיטרציות.
    if (iteration === maxIterations) {
      stopReason = "max_iterations";
    }
  }

  // בונים סיכום מינימלי שמציג את איכות הסידור לפני ואחרי ואת פעולת השיפור.
  const improvementSummary = buildImprovementSummary(
    initialDiagnosis,
    currentDiagnosis,
    options.enabled !== false,
    candidateStats,
    acceptedChanges,
    {
      maxIterations,
      stopReason,
      rejectedRepeatedStateCandidatesCount,
      iterationHistory,
    }
  );

  // מחזירים את השיבוצים הסופיים, הסיכום, והאבחון הסופי לשכבת יצירת הסידור.
  return {
    assignments: currentAssignments,
    improvementSummary,
    diagnosis: currentDiagnosis,
  };
}

// Exports - ייצוא פונקציות לשימוש באלגוריתם הראשי ובבדיקות.
module.exports = {
  SCORE_WEIGHTS,
  FAIRNESS_GAP_THRESHOLD,
  buildStrengthRange,
  diagnoseSchedule,
  calculateScheduleScore,
  generateReplaceCandidates,
  generateSwapCandidates,
  validateCandidate,
  applyCandidate,
  evaluateCandidate,
  buildImprovementSummary,
  runScheduleImprovement,
};
