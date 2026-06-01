const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

// קבועים בסיסיים של שלב השיפור.
// בשלב המצומצם הזה הציון בנוי רק מכיסוי וחוזק, בלי הוגנות.
const SCORE_WEIGHTS = {
  coverageWeight: 1000,
  strengthWeight: 10,
};

// מגבלת איטרציות מונעת מהאלגוריתם לרוץ בלי סוף אם יש הרבה אפשרויות להחלפה.
const DEFAULT_MAX_IMPROVEMENT_ITERATIONS = 20;

// מעגלים ציונים כדי שהסיכום יהיה קריא ועקבי.
function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

// ממירים ערכים למספר בטוח כדי שערכים חסרים מה-DB לא ישברו חישובים.
function toNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

// הוותק תורם לציון החוזק, אבל מוגבל ל-10 כדי שלא ישתלט על שאר המדדים.
function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (toNumber(seniorityMonths) / 24) * 10);
}

function calculateStrengthScore(employee) {
  // מחשבים ציון חוזק אחד לעובד לפי מקצועיות, אחריות, לחץ, ותק ופוטנציאל.
  const seniorityScore = calculateSeniorityScore(employee.seniority_months);

  return (
    0.35 * toNumber(employee.professionalism) +
    0.3 * toNumber(employee.responsibility) +
    0.2 * toNumber(employee.pressure_handling) +
    0.1 * seniorityScore +
    0.05 * toNumber(employee.potential)
  );
}

function getRequiredCount(shift, roleConfig) {
  // שולפים את כמות העובדים הנדרשת לפי התפקיד הנוכחי.
  return toNumber(shift[roleConfig.requirementField]);
}

function getRoleStrengthTarget(shift, roleConfig, requiredCount) {
  // אם לא צריך עובדים בתפקיד הזה, אין טעם לחשב יעד חוזק.
  if (requiredCount <= 0) {
    return 0;
  }

  // מחלקים את יעד החוזק הכללי של המשמרת לפי התפקיד שנבדק.
  return (
    (toNumber(shift.required_strength_score) * requiredCount) /
    Math.max(1, toNumber(shift.required_waiters))
  );
}

function buildStrengthRange(requiredStrengthScore) {
  const target = toNumber(requiredStrengthScore);

  // בלי יעד חוזק אין ענישת חוזק, ולכן הטווח מסומן כלא פעיל.
  if (target <= 0) {
    return {
      hasStrengthTarget: false,
      target: 0,
      margin: 0,
      minimum: 0,
    };
  }

  // הטווח נותן מרווח קטן סביב היעד, כדי לא לפסול סידור בגלל פער זעיר.
  const margin = Math.max(2, target * 0.1);

  return {
    hasStrengthTarget: true,
    target,
    margin,
    minimum: Math.max(0, target - margin),
  };
}

function buildStrengthScoreByEmployeeId(employees) {
  // Map: employeeId -> calculated strength score
  // מאפשר לשלוף מהר את חוזק העובד בזמן אבחון והחלפות.
  return new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
}

function buildEmployeeById(employees) {
  // Map: employeeId -> employee object
  // מאפשר לבדוק מהר אם עובד קיים, פעיל, ומה התפקיד שלו.
  return new Map(employees.map((employee) => [employee.id, employee]));
}

function buildAvailabilitySet(shiftRequests) {
  // Set: "employeeId:shiftId" -> employee is available for this shift
  // מאפשר לבדוק זמינות בלי לחפש בכל רשימת הבקשות בכל פעם.
  return new Set(
    shiftRequests.map(
      (shiftRequest) => `${shiftRequest.employee_id}:${shiftRequest.shift_id}`
    )
  );
}

function getAssignmentKey(assignment) {
  // Set key: "shiftId:employeeId:jobRole" -> specific assignment identity
  // אותו מפתח משמש גם לזיהוי שיבוצים כפויים שאסור להזיז.
  return `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`;
}

function buildAssignmentSummaryByShiftRole(assignments, strengthScoreByEmployeeId) {
  // Map: "shiftId:jobRole" -> summary of assigned count and total strength
  // מסכמים לכל משמרת ותפקיד כמה עובדים שובצו ומה החוזק הכולל שלהם.
  const summaryByShiftRole = new Map();

  for (const assignment of assignments) {
    // כל תפקיד בכל משמרת נבדק בנפרד, לכן המפתח כולל גם shiftId וגם jobRole.
    const key = `${assignment.shiftId}:${assignment.jobRole}`;
    const summary = summaryByShiftRole.get(key) || {
      assignedCount: 0,
      actualStrength: 0,
    };

    summary.assignedCount += 1;
    summary.actualStrength +=
      strengthScoreByEmployeeId.get(assignment.employeeId) || 0;

    // מעדכנים את הסיכום המצטבר כדי שהאבחון יוכל לזהות חוסר כיסוי או חולשה.
    summaryByShiftRole.set(key, summary);
  }

  return summaryByShiftRole;
}

function calculateStrengthPenalty(actualStrength, strengthRange) {
  // אם אין יעד חוזק פעיל, אין ענישה על חוזק.
  if (!strengthRange.hasStrengthTarget) {
    return 0;
  }

  // מתחת למינימום הענישה מלאה, כי המשמרת נחשבת חלשה מדי.
  if (actualStrength < strengthRange.minimum) {
    return strengthRange.minimum - actualStrength;
  }

  // בין המינימום ליעד הענישה חלקית, כי המצב סביר אבל לא מושלם.
  if (actualStrength < strengthRange.target) {
    return (strengthRange.target - actualStrength) * 0.25;
  }

  return 0;
}

function buildShiftRoleDiagnostics(scheduleInputs, assignments) {
  // משתמשים בכל העובדים הרלוונטיים כדי לחשב חוזק גם עבור עובדים שכבר שובצו.
  const employees = scheduleInputs.allEmployees || scheduleInputs.employees || [];

  // Map: employeeId -> calculated strength score
  // המפה משמשת לבניית החוזק המצטבר בכל משמרת ותפקיד.
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);

  // Map: "shiftId:jobRole" -> summary of assigned count and total strength
  // זהו בסיס האבחון: כמה עובדים שובצו ומה החוזק הכולל שלהם.
  const summaryByShiftRole = buildAssignmentSummaryByShiftRole(
    assignments,
    strengthScoreByEmployeeId
  );

  // עוברים על כל משמרת וכל תפקיד כדי לבדוק אם יש חוסר כיסוי או חולשת צוות.
  return (scheduleInputs.shifts || []).flatMap((shift) =>
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      // מחשבים את דרישת הכמות ואת יעד החוזק לקבוצת התפקיד הנוכחית.
      const requiredCount = getRequiredCount(shift, roleConfig);
      const requiredStrengthScore = getRoleStrengthTarget(
        shift,
        roleConfig,
        requiredCount
      );
      const strengthRange = buildStrengthRange(requiredStrengthScore);

      // Map lookup: "shiftId:jobRole" -> summary of assigned count and total strength
      // אם אין שיבוץ לתפקיד הזה במשמרת, מתחילים מסיכום ריק.
      const key = `${shift.id}:${roleConfig.jobRole}`;
      const summary = summaryByShiftRole.get(key) || {
        assignedCount: 0,
        actualStrength: 0,
      };

      // coverageDeficit הוא מספר העובדים החסרים מול הדרישה.
      const coverageDeficit = Math.max(0, requiredCount - summary.assignedCount);

      // strengthPenalty מודד כמה החוזק בפועל נמוך מהטווח הרצוי.
      const strengthPenalty = calculateStrengthPenalty(
        summary.actualStrength,
        strengthRange
      );

      // isWeak מסמן קבוצת תפקיד חלשה שממנה מתחיל חיפוש ה-swap.
      const isWeak =
        strengthRange.hasStrengthTarget &&
        summary.actualStrength < strengthRange.minimum;

      // מחזירים רק שדות שהאלגוריתם צריך כדי למצוא ולבדוק החלפות.
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
      };
    })
  );
}

function calculateScheduleScore(diagnosis, weights = SCORE_WEIGHTS) {
  // totalScore הוא מדד הבעיה של הסידור: נמוך יותר אומר סידור טוב יותר.
  // כיסוי מקבל משקל גבוה כדי שלא נעדיף חוזק על פני מחסור בעובדים.
  return roundScore(
    diagnosis.coveragePenalty * weights.coverageWeight +
      diagnosis.strengthPenalty * weights.strengthWeight
  );
}

function diagnoseSchedule(scheduleInputs, assignments) {
  // אבחון לפי משמרת ותפקיד מזהה איפה חסרים עובדים ואיפה הצוות חלש מדי.
  const shiftRoleDiagnostics = buildShiftRoleDiagnostics(
    scheduleInputs,
    assignments
  );

  // coveragePenalty הוא סך כל החוסרים בכמות עובדים בכל המשמרות והתפקידים.
  const coveragePenalty = roundScore(
    shiftRoleDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.coverageDeficit,
      0
    )
  );

  // strengthPenalty הוא סך כל בעיות החוזק במשמרות.
  const strengthPenalty = roundScore(
    shiftRoleDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.strengthPenalty,
      0
    )
  );

  // האבחון מרכז את המידע שהשיפור צריך: ציונים ורשימת משמרות חלשות.
  const diagnosis = {
    shiftRoleDiagnostics,
    coveragePenalty,
    strengthPenalty,
    weakShifts: shiftRoleDiagnostics.filter((diagnostic) => diagnostic.isWeak),
  };

  // הציון הכולל מאפשר להשוות בין הסידור הנוכחי לבין סידור אחרי swap.
  diagnosis.totalScore = calculateScheduleScore(diagnosis);

  return diagnosis;
}

function findShiftRoleDiagnostic(diagnosis, shiftId, jobRole) {
  // מאתרים אבחון של משמרת ותפקיד כדי לבדוק השפעת swap על אותה קבוצה.
  return diagnosis.shiftRoleDiagnostics.find(
    (diagnostic) =>
      diagnostic.shiftId === shiftId && diagnostic.jobRole === jobRole
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
    donorAssignment: assignments.find(
      (assignment) =>
        assignment.shiftId === candidate.donorShiftId &&
        assignment.employeeId === candidate.donorShiftEmployeeId &&
        assignment.jobRole === candidate.jobRole
    ),
  };
}

function createsDuplicateAfterSwap(assignments, candidate) {
  // בודקים שהחלפה לא תיצור מצב שבו עובד נמצא פעמיים באותה משמרת.
  return assignments.some((assignment) => {
    // מתעלמים משני השיבוצים שהולכים לזוז, כי הם עצמם חלק מה-swap.
    const isWeakAssignment =
      assignment.shiftId === candidate.weakShiftId &&
      assignment.employeeId === candidate.weakShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole;
    const isDonorAssignment =
      assignment.shiftId === candidate.donorShiftId &&
      assignment.employeeId === candidate.donorShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole;

    if (isWeakAssignment || isDonorAssignment) {
      return false;
    }

    // אם אחד העובדים כבר נמצא במשמרת היעד של השני, ה-swap ייצור כפילות.
    return (
      (assignment.shiftId === candidate.weakShiftId &&
        assignment.employeeId === candidate.donorShiftEmployeeId) ||
      (assignment.shiftId === candidate.donorShiftId &&
        assignment.employeeId === candidate.weakShiftEmployeeId)
    );
  });
}

function buildAssignmentStateSignature(assignments) {
  // Set key: full assignment signature -> schedule state already visited
  // חתימה של כל הסידור משמשת למניעת חזרה למצב שכבר נבדק.
  return assignments
    .map(
      (assignment) =>
        `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`
    )
    .sort()
    .join("|");
}

function generateSwapCandidates(
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  const employees = scheduleInputs.employees || [];

  // Map: employeeId -> employee object
  // נדרש כדי לבדוק פעילות ותפקיד של שני העובדים בהחלפה.
  const employeeById = buildEmployeeById(employees);

  // Map: employeeId -> calculated strength score
  // נדרש כדי לוודא שהעובד מהמשמרת התורמת באמת חזק יותר.
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // שני העובדים חייבים להיות זמינים למשמרות שאליהן הם עוברים.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // שיבוצים כפויים לא יוזזו על ידי שלב השיפור.
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const candidates = [];

  // מתחילים רק ממשמרות חלשות, כי המטרה של האלגוריתם המצומצם היא שיפור חוזק.
  for (const weakShift of diagnosis.weakShifts) {
    // מחפשים עובדים מהמשמרת החלשה שאפשר להזיז, בלי לגעת בשיבוצים כפויים.
    const weakAssignments = assignments.filter(
      (assignment) =>
        assignment.shiftId === weakShift.shiftId &&
        assignment.jobRole === weakShift.jobRole &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );

    // מחפשים עובדים מאותו תפקיד במשמרות אחרות שיכולים לתרום חוזק.
    const donorAssignments = assignments.filter(
      (assignment) =>
        assignment.shiftId !== weakShift.shiftId &&
        assignment.jobRole === weakShift.jobRole &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );

    for (const weakAssignment of weakAssignments) {
      for (const donorAssignment of donorAssignments) {
        // Map lookup: employeeId -> employee object
        // שולפים את שני העובדים כדי לבדוק שהם קיימים, פעילים ובאותו תפקיד.
        const weakEmployee = employeeById.get(weakAssignment.employeeId);
        const donorEmployee = employeeById.get(donorAssignment.employeeId);

        // Map lookup: employeeId -> calculated strength score
        // בודקים שהעובד התורם חזק יותר מהעובד שנמצא במשמרת החלשה.
        const weakEmployeeStrength =
          strengthScoreByEmployeeId.get(weakAssignment.employeeId) || 0;
        const donorEmployeeStrength =
          strengthScoreByEmployeeId.get(donorAssignment.employeeId) || 0;

        // יוצרים מועמד רק אם שני העובדים פעילים, באותו תפקיד, זמינים, וההחלפה באמת מחזקת.
        if (
          !weakEmployee ||
          !donorEmployee ||
          !weakEmployee.is_active ||
          !donorEmployee.is_active ||
          weakEmployee.role !== weakShift.jobRole ||
          donorEmployee.role !== weakShift.jobRole ||
          donorEmployeeStrength <= weakEmployeeStrength ||
          !availabilitySet.has(
            `${weakAssignment.employeeId}:${donorAssignment.shiftId}`
          ) ||
          !availabilitySet.has(
            `${donorAssignment.employeeId}:${weakShift.shiftId}`
          )
        ) {
          continue;
        }

        // המועמד מתאר החלפה אפשרית בלבד; האם היא באמת טובה ייבדק בשלב ההערכה.
        const candidate = {
          type: "swap",
          weakShiftId: weakShift.shiftId,
          donorShiftId: donorAssignment.shiftId,
          jobRole: weakShift.jobRole,
          weakShiftEmployeeId: weakAssignment.employeeId,
          donorShiftEmployeeId: donorAssignment.employeeId,
          reason: "Swap stronger same-role employee into weak shift.",
        };

        // לא מוסיפים מועמד אם הוא ייצור כפילות באחת המשמרות.
        if (!createsDuplicateAfterSwap(assignments, candidate)) {
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
}

function applySwapCandidate(assignments, candidate) {
  // הפונקציה לא מחליטה אם ה-swap טוב; היא רק יוצרת רשימת שיבוצים אחרי ההחלפה.
  return assignments.map((assignment) => {
    // העובד מהמשמרת החלשה עובר למשמרת התורמת.
    if (
      assignment.shiftId === candidate.weakShiftId &&
      assignment.employeeId === candidate.weakShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return {
        ...assignment,
        shiftId: candidate.donorShiftId,
      };
    }

    // העובד החזק מהמשמרת התורמת עובר למשמרת החלשה.
    if (
      assignment.shiftId === candidate.donorShiftId &&
      assignment.employeeId === candidate.donorShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return {
        ...assignment,
        shiftId: candidate.weakShiftId,
      };
    }

    // כל שיבוץ אחר נשאר כמו שהוא, כדי שהשינוי יהיה ממוקד רק בשני העובדים.
    return {
      ...assignment,
    };
  });
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

  // Map: employeeId -> employee object
  // משמש לוודא ששני העובדים קיימים, פעילים ומתאימים לתפקיד.
  const employeeById = buildEmployeeById(employees);

  // Set: "employeeId:shiftId" -> employee is available for this shift
  // משמש לבדוק זמינות אחרי ההחלפה.
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // מגן על שיבוצים כפויים מפני שינוי.
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();

  // מאתרים את שני השיבוצים בפועל כדי לוודא שהמועמד מבוסס על מצב אמיתי.
  const { weakAssignment, donorAssignment } = findSwapAssignments(
    assignments,
    candidate
  );

  // אם אחד השיבוצים לא קיים, אי אפשר לבצע swap חוקי.
  if (!weakAssignment) {
    reasons.push("Weak shift assignment does not exist.");
  }

  if (!donorAssignment) {
    reasons.push("Donor shift assignment does not exist.");
  }

  if (weakAssignment && donorAssignment) {
    // שני השיבוצים חייבים להיות באותו תפקיד כדי לא להחליף בין תפקידים שונים.
    if (weakAssignment.jobRole !== donorAssignment.jobRole) {
      reasons.push("Swap assignments are not in the same jobRole.");
    }

    // Set lookup: "shiftId:employeeId:jobRole" -> forced assignment key
    // אם אחד השיבוצים כפוי, האלגוריתם לא רשאי להזיז אותו.
    if (
      forcedAssignmentSet.has(getAssignmentKey(weakAssignment)) ||
      forcedAssignmentSet.has(getAssignmentKey(donorAssignment))
    ) {
      reasons.push("Cannot swap a forced assignment.");
    }
  }

  // Map lookup: employeeId -> employee object
  // בודקים את פרטי העובדים שמופיעים במועמד.
  const weakEmployee = employeeById.get(candidate.weakShiftEmployeeId);
  const donorEmployee = employeeById.get(candidate.donorShiftEmployeeId);

  // עובד חסר או לא פעיל לא יכול להשתתף בסידור.
  if (!weakEmployee || !donorEmployee) {
    reasons.push("Swap employee does not exist.");
  } else {
    if (!weakEmployee.is_active || !donorEmployee.is_active) {
      reasons.push("Swap employee is not active.");
    }

    // גם לפי העובד עצמו, שני הצדדים חייבים להתאים לתפקיד של המועמד.
    if (
      weakEmployee.role !== candidate.jobRole ||
      donorEmployee.role !== candidate.jobRole
    ) {
      reasons.push("Swap employee does not match candidate jobRole.");
    }
  }

  // Set lookup: "employeeId:shiftId" -> employee is available for this shift
  // כל עובד חייב להיות זמין למשמרת שאליה הוא יעבור אחרי ה-swap.
  if (
    !availabilitySet.has(
      `${candidate.weakShiftEmployeeId}:${candidate.donorShiftId}`
    ) ||
    !availabilitySet.has(
      `${candidate.donorShiftEmployeeId}:${candidate.weakShiftId}`
    )
  ) {
    reasons.push("Swap employee is not available for the target shift.");
  }

  // הגנה מפני מצב שבו אותו עובד יופיע פעמיים באותה משמרת.
  if (createsDuplicateAfterSwap(assignments, candidate)) {
    reasons.push("Swap would create a duplicate employee assignment.");
  }

  // רק אחרי בדיקות החוקיות הבסיסיות מדמים את ההשפעה על הסידור.
  if (!reasons.length) {
    const candidateAssignments = applySwapCandidate(assignments, candidate);
    const candidateDiagnosis = diagnoseSchedule(
      scheduleInputs,
      candidateAssignments
    );

    // בודקים את המשמרת התורמת אחרי ההחלפה, כדי לוודא שלא החלשנו אותה יותר מדי.
    const donorDiagnosticAfter = findShiftRoleDiagnostic(
      candidateDiagnosis,
      candidate.donorShiftId,
      candidate.jobRole
    );

    // אסור לשפר חוזק אם זה מגדיל בעיית כיסוי.
    if (candidateDiagnosis.coveragePenalty > diagnosis.coveragePenalty) {
      reasons.push("Swap would worsen coverage.");
    }

    // המשמרת שתרמה עובד חזק לא יכולה לרדת מתחת למינימום החוזק שלה.
    if (
      donorDiagnosticAfter &&
      donorDiagnosticAfter.strengthRange.hasStrengthTarget &&
      donorDiagnosticAfter.actualStrength <
        donorDiagnosticAfter.strengthRange.minimum
    ) {
      reasons.push("Swap would move the donor shift below the minimum strength range.");
    }

    // בסוף, ה-swap חייב לשפר את totalScore כדי להתקבל.
    if (candidateDiagnosis.totalScore >= diagnosis.totalScore) {
      reasons.push("Swap would not improve total score.");
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

function evaluateSwapCandidate(
  candidate,
  scheduleInputs,
  assignments,
  diagnosis,
  context = {}
) {
  // ההערכה מתחילה בוולידציה, כי מועמד לא חוקי לא אמור לעבור סימולציה מלאה.
  const validation = validateSwapCandidate(
    candidate,
    scheduleInputs,
    assignments,
    diagnosis,
    context
  );

  // אם המועמד לא חוקי, מחזירים תוצאה שמסבירה למה ולא מחשבים ציון אחרי.
  if (!validation.valid) {
    return {
      candidate,
      validation,
      scoreBefore: diagnosis.totalScore,
      scoreAfter: null,
      coveragePenaltyBefore: diagnosis.coveragePenalty,
      coveragePenaltyAfter: null,
      strengthPenaltyBefore: diagnosis.strengthPenalty,
      strengthPenaltyAfter: null,
      diagnosisAfter: null,
      assignmentsAfter: null,
    };
  }

  // מדמים את הסידור אחרי ה-swap כדי לבדוק איך הוא משפיע בפועל.
  const assignmentsAfter = applySwapCandidate(assignments, candidate);

  // מאבחנים את הסידור המדומה כדי לקבל ציון וכמות ענישות אחרי ההחלפה.
  const diagnosisAfter = diagnoseSchedule(scheduleInputs, assignmentsAfter);

  // מחזירים השוואה בין לפני ואחרי כדי ששלב הבחירה יוכל לבחור את השיפור הכי טוב.
  return {
    candidate,
    validation,
    scoreBefore: diagnosis.totalScore,
    scoreAfter: diagnosisAfter.totalScore,
    coveragePenaltyBefore: diagnosis.coveragePenalty,
    coveragePenaltyAfter: diagnosisAfter.coveragePenalty,
    strengthPenaltyBefore: diagnosis.strengthPenalty,
    strengthPenaltyAfter: diagnosisAfter.strengthPenalty,
    diagnosisAfter,
    assignmentsAfter,
  };
}

function selectBestSwapEvaluation(
  evaluations,
  currentDiagnosis,
  visitedAssignmentStates
) {
  let repeatedStateCandidatesCount = 0;

  // בוחרים רק מועמדים חוקיים שמורידים את הציון הכללי של הסידור.
  const bestEvaluation =
    evaluations
      .filter((evaluation) => {
        if (
          !evaluation.validation.valid ||
          evaluation.scoreAfter === null ||
          evaluation.scoreAfter >= currentDiagnosis.totalScore
        ) {
          return false;
        }

        // Set lookup: full assignment signature -> schedule state already visited
        // דוחים מועמד שמחזיר אותנו לסידור שכבר ראינו, כדי למנוע לולאות.
        const candidateSignature = buildAssignmentStateSignature(
          evaluation.assignmentsAfter
        );

        if (visitedAssignmentStates.has(candidateSignature)) {
          repeatedStateCandidatesCount += 1;
          return false;
        }

        return true;
      })

      // hill climbing: בכל איטרציה בוחרים את ה-swap עם שיפור הציון הגדול ביותר.
      .sort((leftEvaluation, rightEvaluation) => {
        const leftImprovement =
          currentDiagnosis.totalScore - leftEvaluation.scoreAfter;
        const rightImprovement =
          currentDiagnosis.totalScore - rightEvaluation.scoreAfter;

        if (rightImprovement !== leftImprovement) {
          return rightImprovement - leftImprovement;
        }

        // אם יש תיקו בשיפור, משתמשים בסדר קבוע לפי מזהי המשמרות כדי שהתוצאה תהיה יציבה.
        if (leftEvaluation.candidate.weakShiftId !== rightEvaluation.candidate.weakShiftId) {
          return (
            leftEvaluation.candidate.weakShiftId -
            rightEvaluation.candidate.weakShiftId
          );
        }

        return (
          leftEvaluation.candidate.donorShiftId -
          rightEvaluation.candidate.donorShiftId
        );
      })[0] || null;

  return {
    bestEvaluation,
    repeatedStateCandidatesCount,
  };
}

function buildAcceptedChange(evaluation, currentDiagnosis, candidateDiagnosis) {
  // זהו מידע לדיווח: איזה swap התקבל ומה השתנה בציונים.
  return {
    ...evaluation.candidate,
    scoreBefore: currentDiagnosis.totalScore,
    scoreAfter: candidateDiagnosis.totalScore,
    coveragePenaltyBefore: currentDiagnosis.coveragePenalty,
    coveragePenaltyAfter: candidateDiagnosis.coveragePenalty,
    strengthPenaltyBefore: currentDiagnosis.strengthPenalty,
    strengthPenaltyAfter: candidateDiagnosis.strengthPenalty,
  };
}

function buildImprovementSummary(
  initialDiagnosis,
  finalDiagnosis,
  enabled = true,
  acceptedChanges = [],
  loopSummary = {}
) {
  // הסיכום נשאר מינימלי: הוא מציג את מצב הסידור לפני ואחרי ואת כמות המועמדים שנבדקו.
  return {
    enabled,
    phase: "swap-only-hill-climbing",
    maxIterations:
      loopSummary.maxIterations || DEFAULT_MAX_IMPROVEMENT_ITERATIONS,
    iterationsRun: acceptedChanges.length,
    stopReason: loopSummary.stopReason || "not_started",
    acceptedChangesCount: acceptedChanges.length,
    acceptedChanges,
    initialScore: initialDiagnosis.totalScore,
    finalScore: finalDiagnosis.totalScore,
    scoreImprovement: roundScore(
      initialDiagnosis.totalScore - finalDiagnosis.totalScore
    ),
    initialCoveragePenalty: initialDiagnosis.coveragePenalty,
    finalCoveragePenalty: finalDiagnosis.coveragePenalty,
    initialStrengthPenalty: initialDiagnosis.strengthPenalty,
    finalStrengthPenalty: finalDiagnosis.strengthPenalty,
    candidatesChecked: loopSummary.candidatesChecked || 0,
    validCandidatesCount: loopSummary.validCandidatesCount || 0,
    rejectedRepeatedStateCandidatesCount:
      loopSummary.rejectedRepeatedStateCandidatesCount || 0,
  };
}

function runScheduleImprovement(scheduleInputs, initialAssignments, options = {}) {
  // מתחילים באבחון הסידור הראשוני כדי לדעת מה צריך לשפר.
  const initialDiagnosis = diagnoseSchedule(scheduleInputs, initialAssignments);

  // Set: "shiftId:employeeId:jobRole" -> forced assignment key
  // שיבוצים כפויים עוברים דרך context כדי שכל שלבי השיפור יכבדו אותם.
  const context = {
    forcedAssignmentSet: options.forcedAssignmentSet || new Set(),
  };

  // קובעים את מספר האיטרציות המקסימלי, עם ברירת מחדל אם לא נשלחה אפשרות חיצונית.
  const maxIterations = Number.isInteger(options.maxIterations)
    ? Math.max(0, options.maxIterations)
    : DEFAULT_MAX_IMPROVEMENT_ITERATIONS;

  // acceptedChanges שומר רק swaps שבאמת התקבלו והשפיעו על הסידור.
  const acceptedChanges = [];

  // Set: full assignment signature -> schedule state already visited
  // מתחילים מהמצב הראשוני כדי לא לחזור אליו בהמשך.
  const visitedAssignmentStates = new Set([
    buildAssignmentStateSignature(initialAssignments),
  ]);

  // currentAssignments ו-currentDiagnosis הם המצב הנוכחי שהלולאה משפרת בכל סבב.
  let currentAssignments = initialAssignments;
  let currentDiagnosis = initialDiagnosis;

  // stopReason מסביר בסוף למה האלגוריתם עצר.
  let stopReason = maxIterations === 0 ? "max_iterations" : "no_improving_swap";

  // המונים האלה מיועדים לסיכום בלבד, ולא משפיעים על בחירת המועמד.
  let candidatesChecked = 0;
  let validCandidatesCount = 0;
  let rejectedRepeatedStateCandidatesCount = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    // מייצרים רק מועמדי swap שמנסים לחזק משמרות חלשות.
    const candidates = generateSwapCandidates(
      scheduleInputs,
      currentAssignments,
      currentDiagnosis,
      context
    );

    // כל מועמד עובר ולידציה, סימולציה, ואבחון לפני/אחרי.
    const evaluations = candidates.map((candidate) =>
      evaluateSwapCandidate(
        candidate,
        scheduleInputs,
        currentAssignments,
        currentDiagnosis,
        context
      )
    );

    // בוחרים את ה-swap החוקי שנותן את שיפור הציון הגדול ביותר.
    const selectionResult = selectBestSwapEvaluation(
      evaluations,
      currentDiagnosis,
      visitedAssignmentStates
    );
    const bestEvaluation = selectionResult.bestEvaluation;

    // מעדכנים מוני דיווח כדי להבין כמה אפשרויות נבדקו בכל הריצה.
    candidatesChecked += candidates.length;
    validCandidatesCount += evaluations.filter(
      (evaluation) => evaluation.validation.valid
    ).length;
    rejectedRepeatedStateCandidatesCount +=
      selectionResult.repeatedStateCandidatesCount;

    // אם אין swap משפר, האלגוריתם סיים את העבודה.
    if (!bestEvaluation) {
      stopReason = "no_improving_swap";
      break;
    }

    // ה-evaluation כבר מכיל את הסידור והאבחון אחרי ה-swap שנבחר.
    const nextAssignments = bestEvaluation.assignmentsAfter;
    const nextDiagnosis = bestEvaluation.diagnosisAfter;

    // שומרים את השינוי שהתקבל כדי שאפשר יהיה להסביר מה האלגוריתם עשה.
    acceptedChanges.push(
      buildAcceptedChange(bestEvaluation, currentDiagnosis, nextDiagnosis)
    );

    // Set update: full assignment signature -> schedule state already visited
    // מוסיפים את המצב החדש כדי למנוע חזרה אליו באיטרציות הבאות.
    visitedAssignmentStates.add(buildAssignmentStateSignature(nextAssignments));

    // הסידור אחרי ה-swap הופך לנקודת הפתיחה של האיטרציה הבאה.
    currentAssignments = nextAssignments;
    currentDiagnosis = nextDiagnosis;

    // אם הגענו למקסימום האיטרציות, זו סיבת העצירה.
    if (iteration === maxIterations) {
      stopReason = "max_iterations";
    }
  }

  // בונים סיכום קצר של השיפור: ציונים לפני/אחרי, swaps שהתקבלו, ומוני בדיקה.
  const improvementSummary = buildImprovementSummary(
    initialDiagnosis,
    currentDiagnosis,
    options.enabled !== false,
    acceptedChanges,
    {
      maxIterations,
      stopReason,
      candidatesChecked,
      validCandidatesCount,
      rejectedRepeatedStateCandidatesCount,
    }
  );

  // מחזירים את הסידור הסופי, האבחון הסופי, וסיכום השיפור לשלב יצירת הסידור.
  return {
    assignments: currentAssignments,
    diagnosis: currentDiagnosis,
    improvementSummary,
  };
}

// ייצוא הפונקציות שהאלגוריתם הראשי או בדיקות יכולות להשתמש בהן.
module.exports = {
  SCORE_WEIGHTS,
  buildStrengthRange,
  calculateStrengthScore,
  diagnoseSchedule,
  calculateScheduleScore,
  generateSwapCandidates,
  validateSwapCandidate,
  applySwapCandidate,
  evaluateSwapCandidate,
  runScheduleImprovement,
};
