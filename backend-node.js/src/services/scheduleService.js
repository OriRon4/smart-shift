const scheduleRepository = require("../repositories/scheduleRepository");
const mlRepository = require("../repositories/mlRepository");
const {
  buildRoleValidationSummaries,
  calculateStrengthScore,
  generateScheduleAlgorithm,
} = require("../algorithms/generateScheduleAlgorithm");
const {
  buildScheduleBoardResponse,
} = require("../formatters/scheduleBoardFormatter");
const { PERMISSION_ROLES, SCHEDULE_JOB_ROLES } = require("../constants/roles");
const { createHttpError } = require("../utils/errors");

const STRENGTH_WARNING_THRESHOLD = 1;

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildPersistedAssignments(employees, assignments) {
  // Map: employee.id -> אובייקט עובד, כדי למצוא חוזק לפי employeeId.
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  // האלגוריתם מחזיר shiftId/employeeId/jobRole; לשמירה מוסיפים assignedStrengthScore.
  return assignments.map((assignment) => {
    const employee = employeeById.get(assignment.employeeId);

    return {
      shiftId: assignment.shiftId,
      employeeId: assignment.employeeId,
      jobRole: assignment.jobRole,
      assignedStrengthScore: employee
        ? roundScore(calculateStrengthScore(employee))
        : roundScore(assignment.assignedStrengthScore),
    };
  });
}

function buildAlgorithmResultFromAssignments(scheduleInputs, assignments) {
  return {
    allAssignments: assignments,
    shiftValidationSummaries: buildRoleValidationSummaries(
      scheduleInputs.shifts,
      assignments,
      scheduleInputs.allEmployees || scheduleInputs.employees
    ),
  };
}

function parseScheduleId(scheduleId) {
  const numericScheduleId = Number(scheduleId);

  if (!Number.isInteger(numericScheduleId) || numericScheduleId <= 0) {
    throw createHttpError(400, "scheduleId must be a positive integer");
  }

  return numericScheduleId;
}

function formatDateKey(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function getSundayForDate(value) {
  const date = new Date(`${formatDateKey(value)}T00:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return formatDateKey(date);
}

function formatDayName(dateKey) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function getDayOfWeek(dateKey) {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

function isWeekend(dayOfWeek) {
  return dayOfWeek === 5 || dayOfWeek === 6;
}

async function resolveScheduleWeek(scheduleId, weekStartDate) {
  const numericScheduleId = parseScheduleId(scheduleId);
  const persistedSchedule = await scheduleRepository.getPersistedScheduleById(
    numericScheduleId
  );

  if (!persistedSchedule) {
    throw createHttpError(404, "Schedule not found");
  }

  if (weekStartDate && weekStartDate !== persistedSchedule.weekStartDate) {
    throw createHttpError(400, "weekStartDate does not match scheduleId");
  }

  return persistedSchedule;
}

function canViewUnpublishedSchedule(user) {
  return user.permissionRole === PERMISSION_ROLES.MANAGER;
}

function canEditScheduleAssignments(user) {
  return (
    user.permissionRole === PERMISSION_ROLES.MANAGER ||
    user.permissionRole === PERMISSION_ROLES.SHIFT_LEADER
  );
}

async function getScheduleForWeek(weekStartDate, user) {
  // זרימת צפייה בסידור: מתחילים מנתוני השבוע והמשמרות.
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  // בודקים אם כבר נשמר סידור לשבוע הזה.
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    scheduleInputs.weekStartDate
  );

  if (!persistedSchedule) {
    // עובד/אחראי משמרת לא רואה סידור שלא נוצר עדיין.
    if (user.permissionRole !== PERMISSION_ROLES.MANAGER) {
      return {
        scheduleId: null,
        weekStartDate: scheduleInputs.weekStartDate,
        weekEndDate: scheduleInputs.weekEndDate,
        publishedAt: null,
        days: [],
        canEdit: false,
        canManage: false,
      };
    }

    // למנהל יוצרים רשומת weekly_schedule ריקה כדי שיהיה board לעריכה.
    const emptySchedule =
      await scheduleRepository.ensureWeeklyScheduleByWeekStartDate(
        scheduleInputs.weekStartDate
      );
    // בונים board ריק מאותם נתוני שבוע.
    const emptyAlgorithmResult = buildAlgorithmResultFromAssignments(
      scheduleInputs,
      []
    );

    return buildScheduleBoardResponse(scheduleInputs, emptyAlgorithmResult, {
      scheduleId: emptySchedule.scheduleId,
      publishedAt: null,
      permissionRole: user.permissionRole,
    });
  }

  if (!persistedSchedule.publishedAt && !canViewUnpublishedSchedule(user)) {
    // אם הסידור לא פורסם, רק manager יכול לראות אותו.
    return {
      message: "Schedule has not been published yet.",
      scheduleId: persistedSchedule.scheduleId,
      weekStartDate: scheduleInputs.weekStartDate,
      weekEndDate: scheduleInputs.weekEndDate,
      publishedAt: null,
      days: [],
      canEdit: false,
      canManage: false,
    };
  }

  // ממירים שיבוצים שמורים למבנה שה-formatter יודע להציג.
  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );

  // מחזירים board מלא ל-Angular להצגה במסך.
  return buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
    scheduleId: persistedSchedule.scheduleId,
    publishedAt: persistedSchedule.publishedAt,
    permissionRole: user.permissionRole,
  });
}

async function generateScheduleForWeek(weekStartDate, user) {
  // שלב 1: מביאים מה-DB את כל הקלטים שהאלגוריתם צריך לשבוע הזה.
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );

  // שלב 2: מריצים את אלגוריתם השיבוץ על הקלטים.
  const algorithmResult = generateScheduleAlgorithm(scheduleInputs);

  // שלב 3: מכינים את השיבוצים למבנה שנשמר בטבלת schedule_assignments.
  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.allEmployees || scheduleInputs.employees,
    algorithmResult.allAssignments
  );

  // שלב 4: שומרים את השיבוצים החדשים ב-DB ומקבלים scheduleId.
  const persistenceResult = await scheduleRepository.saveScheduleAssignments(
    scheduleInputs.weekStartDate,
    persistedAssignments
  );

  return {
    message: "Schedule generated successfully",
    // שלב 5: ה-formatter הופך את תוצאת האלגוריתם למבנה שהמסך יודע להציג.
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: persistenceResult.scheduleId,
      publishedAt: persistenceResult.publishedAt,
      permissionRole: user.permissionRole,
    }),
    persistenceResult,
  };
}

function validateAssignmentPayload(assignments, options = {}) {
  const requireNonEmpty = options.requireNonEmpty !== false;

  if (!Array.isArray(assignments) || (requireNonEmpty && !assignments.length)) {
    throw createHttpError(400, "assignments must be a non-empty array");
  }

  const validJobRoles = new Set(
    SCHEDULE_JOB_ROLES.map((roleConfig) => roleConfig.jobRole)
  );

  const seenAssignmentKeys = new Set();

  return assignments.flatMap((assignment) => {
    const shiftId = Number(assignment.shiftId);
    const employeeId = Number(assignment.employeeId);

    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      throw createHttpError(400, "assignment.shiftId must be a positive integer");
    }

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw createHttpError(400, "assignment.employeeId must be a positive integer");
    }

    if (!validJobRoles.has(assignment.jobRole)) {
      throw createHttpError(400, "assignment.jobRole is invalid");
    }

    const normalizedAssignment = {
      shiftId,
      employeeId,
      jobRole: assignment.jobRole,
    };
    const assignmentKey = `${shiftId}:${assignment.jobRole}:${employeeId}`;

    if (seenAssignmentKeys.has(assignmentKey)) {
      return [];
    }

    seenAssignmentKeys.add(assignmentKey);
    return [normalizedAssignment];
  });
}

function ensureAssignmentsMatchWeekAndRoles(scheduleInputs, assignments) {
  const shiftIds = new Set(scheduleInputs.shifts.map((shift) => shift.id));
  const employeeById = new Map(
    (scheduleInputs.allEmployees || scheduleInputs.employees).map((employee) => [
      employee.id,
      employee,
    ])
  );

  for (const assignment of assignments) {
    if (!shiftIds.has(assignment.shiftId)) {
      throw createHttpError(400, "assignment.shiftId is not in the selected week");
    }

    const employee = employeeById.get(assignment.employeeId);

    if (!employee) {
      throw createHttpError(400, "assignment.employeeId does not exist");
    }
  }
}

function buildManualAssignmentWarnings(scheduleInputs, assignments) {
  const employeesById = new Map(
    (scheduleInputs.allEmployees || scheduleInputs.employees).map((employee) => [
      employee.id,
      employee,
    ])
  );
  const requestedShiftByEmployee = new Set(
    scheduleInputs.shiftRequests.map(
      (shiftRequest) => `${shiftRequest.employee_id}:${shiftRequest.shift_id}`
    )
  );
  const assignmentCountByShiftAndEmployee = new Map();

  for (const assignment of assignments) {
    const shiftEmployeeKey = `${assignment.shiftId}:${assignment.employeeId}`;
    assignmentCountByShiftAndEmployee.set(
      shiftEmployeeKey,
      (assignmentCountByShiftAndEmployee.get(shiftEmployeeKey) || 0) + 1
    );
  }

  return assignments.flatMap((assignment) => {
    const warnings = [];
    const employee = employeesById.get(assignment.employeeId);

    if (!employee) {
      return warnings;
    }

    if (!employee.is_active) {
      warnings.push({
        type: "inactive_employee",
        shiftId: assignment.shiftId,
        employeeId: assignment.employeeId,
        jobRole: assignment.jobRole,
        message: "Employee is inactive",
      });
    }

    if (employee.role !== assignment.jobRole) {
      warnings.push({
        type: "role_mismatch",
        shiftId: assignment.shiftId,
        employeeId: assignment.employeeId,
        jobRole: assignment.jobRole,
        actualRole: employee.role,
        message: "Employee role does not match the assigned role slot",
      });
    }

    if (
      !requestedShiftByEmployee.has(
        `${assignment.employeeId}:${assignment.shiftId}`
      )
    ) {
      warnings.push({
        type: "employee_not_available",
        shiftId: assignment.shiftId,
        employeeId: assignment.employeeId,
        jobRole: assignment.jobRole,
        message: "Employee did not submit availability for this shift",
      });
    }

    if (
      (assignmentCountByShiftAndEmployee.get(
        `${assignment.shiftId}:${assignment.employeeId}`
      ) || 0) > 1
    ) {
      warnings.push({
        type: "employee_scheduled_multiple_roles",
        shiftId: assignment.shiftId,
        employeeId: assignment.employeeId,
        jobRole: assignment.jobRole,
        message: "Employee is scheduled more than once in this shift",
      });
    }

    return warnings;
  });
}

function buildValidationLookups(scheduleInputs) {
  const shiftById = new Map(
    scheduleInputs.shifts.map((shift) => [shift.id, shift])
  );
  const employeeById = new Map(
    (scheduleInputs.allEmployees || scheduleInputs.employees).map((employee) => [
      employee.id,
      employee,
    ])
  );
  const roleLabelByJobRole = new Map(
    SCHEDULE_JOB_ROLES.map((roleConfig) => [
      roleConfig.jobRole,
      roleConfig.label,
    ])
  );

  return {
    shiftById,
    employeeById,
    roleLabelByJobRole,
  };
}

function buildShiftLabel(shift) {
  const date = formatDateKey(shift.shift_date);

  return {
    date,
    dayName: formatDayName(date),
    shiftType: shift.shift_type,
  };
}

function buildCoverageIssues(scheduleInputs, validationSummaries) {
  const { shiftById, roleLabelByJobRole } = buildValidationLookups(scheduleInputs);

  return validationSummaries
    .filter((summary) => summary.uncoveredSlots > 0)
    .map((summary) => {
      const shift = shiftById.get(summary.shiftId);

      return {
        severity: "error",
        type: "coverage_gap",
        shiftId: summary.shiftId,
        ...(shift ? buildShiftLabel(shift) : {}),
        jobRole: summary.jobRole,
        roleLabel: roleLabelByJobRole.get(summary.jobRole) || summary.jobRole,
        requiredCount: Number(summary.requiredCount),
        assignedCount: Number(summary.assignedCount),
        missingCount: Number(summary.uncoveredSlots),
        message: "Required role slots are not fully assigned",
      };
    });
}

function buildStrengthIssues(scheduleInputs, validationSummaries) {
  const { shiftById, roleLabelByJobRole } = buildValidationLookups(scheduleInputs);

  return validationSummaries
    .filter(
      (summary) =>
        roundScore(
          Number(summary.requiredStrengthScore) -
            Number(summary.assignedStrengthScore)
        ) >= STRENGTH_WARNING_THRESHOLD
    )
    .map((summary) => {
      const shift = shiftById.get(summary.shiftId);
      const assignedStrengthScore = roundScore(summary.assignedStrengthScore);
      const requiredStrengthScore = roundScore(summary.requiredStrengthScore);

      return {
        severity: "warning",
        type: "below_strength_target",
        shiftId: summary.shiftId,
        ...(shift ? buildShiftLabel(shift) : {}),
        jobRole: summary.jobRole,
        roleLabel: roleLabelByJobRole.get(summary.jobRole) || summary.jobRole,
        requiredStrengthScore,
        assignedStrengthScore,
        deficit: roundScore(
          Math.max(0, requiredStrengthScore - assignedStrengthScore)
        ),
        message: "Assigned employee strength is below the target",
      };
    });
}

function enrichManualAssignmentIssue(scheduleInputs, warning) {
  const { shiftById, employeeById, roleLabelByJobRole } =
    buildValidationLookups(scheduleInputs);
  const shift = shiftById.get(warning.shiftId);
  const employee = employeeById.get(warning.employeeId);

  return {
    severity:
      warning.type === "employee_not_available"
        ? "warning"
        : "error",
    type: warning.type,
    shiftId: warning.shiftId,
    ...(shift ? buildShiftLabel(shift) : {}),
    employeeId: warning.employeeId,
    employeeName: employee?.full_name || `Employee #${warning.employeeId}`,
    jobRole: warning.jobRole,
    roleLabel: roleLabelByJobRole.get(warning.jobRole) || warning.jobRole,
    actualRole: warning.actualRole,
    message: warning.message,
  };
}

function isSameDayDoubleAssignmentIssue(issue) {
  const message = String(issue.message || "").toLowerCase();

  return (
    issue.type === "same_day_double_shift" ||
    issue.type === "employee_scheduled_multiple_shifts_same_day" ||
    (message.includes("more than once") && message.includes("same day"))
  );
}

function buildFairnessWarnings(scheduleInputs, assignments) {
  const assignedCountsByEmployee = new Map();
  const requestedCountsByEmployee = new Map();

  for (const assignment of assignments) {
    assignedCountsByEmployee.set(
      assignment.employeeId,
      (assignedCountsByEmployee.get(assignment.employeeId) || 0) + 1
    );
  }

  for (const shiftRequest of scheduleInputs.shiftRequests) {
    requestedCountsByEmployee.set(
      shiftRequest.employee_id,
      (requestedCountsByEmployee.get(shiftRequest.employee_id) || 0) + 1
    );
  }

  return scheduleInputs.employees
    .map((employee) => {
      const requestedShifts = requestedCountsByEmployee.get(employee.id) || 0;
      const assignedShifts = assignedCountsByEmployee.get(employee.id) || 0;
      const strengthScore = calculateStrengthScore(employee);
      const normalizedStrength = strengthScore / 10;
      const targetShifts = requestedShifts * (0.55 + 0.45 * normalizedStrength);
      const gap = Math.max(0, targetShifts - assignedShifts);

      return {
        severity: "warning",
        type: "employee_under_target",
        employeeId: employee.id,
        employeeName: employee.full_name,
        requestedShifts,
        assignedShifts,
        targetShifts: roundScore(targetShifts),
        gap: roundScore(gap),
        message: "Employee is assigned below the target based on availability",
      };
    })
    .filter((warning) => warning.requestedShifts > 0 && warning.gap > 0.5);
}

function buildValidationSummary(
  scheduleInputs,
  assignments,
  validationSummaries,
  hasUnsavedChanges
) {
  const significantStrengthSummaries = validationSummaries.filter(
    (summary) =>
      roundScore(
        Number(summary.requiredStrengthScore) -
          Number(summary.assignedStrengthScore)
      ) >= STRENGTH_WARNING_THRESHOLD
  );
  const assignedShiftIds = new Set(assignments.map((assignment) => assignment.shiftId));
  const shiftsWithCoverageIssues = new Set(
    validationSummaries
      .filter((summary) => summary.uncoveredSlots > 0)
      .map((summary) => summary.shiftId)
  );
  const shiftsWithStrengthIssues = new Set(
    significantStrengthSummaries.map((summary) => summary.shiftId)
  );
  const uniqueAssignedEmployees = new Set(
    assignments.map((assignment) => assignment.employeeId)
  );

  return {
    totalShifts: scheduleInputs.shifts.length,
    totalRoleRequirements: validationSummaries.reduce(
      (total, summary) => total + Number(summary.requiredCount),
      0
    ),
    totalAssignments: assignments.length,
    assignedShifts: assignedShiftIds.size,
    fullyCoveredRoleGroups: validationSummaries.filter(
      (summary) => summary.uncoveredSlots === 0
    ).length,
    underCoveredRoleGroups: validationSummaries.filter(
      (summary) => summary.uncoveredSlots > 0
    ).length,
    shiftsWithCoverageIssues: shiftsWithCoverageIssues.size,
    shiftsWithStrengthIssues: shiftsWithStrengthIssues.size,
    belowStrengthRoleGroups: significantStrengthSummaries.length,
    belowStrengthTargetRoleGroups: significantStrengthSummaries.length,
    meetsStrengthTargetRoleGroups: validationSummaries.filter(
      (summary) => summary.meetsStrengthTarget
    ).length,
    uniqueAssignedEmployees: uniqueAssignedEmployees.size,
    unsavedChanges: hasUnsavedChanges ? 1 : 0,
  };
}

function resolveValidationStatus(report) {
  const hasBlockingInvalidAssignments = report.invalidAssignments.some(
    (issue) => issue.severity === "error"
  );

  if (report.coverageIssues.length || hasBlockingInvalidAssignments) {
    return {
      status: "needs_fixes",
      recommendation: "Fix blocking issues before saving the schedule.",
    };
  }

  if (
    report.strengthIssues.length ||
    report.fairnessWarnings.length
  ) {
    return {
      status: "ready_with_warnings",
      recommendation: "You can save, but review the warnings first.",
    };
  }

  return {
    status: "ready_to_save",
    recommendation: "The schedule is ready to save.",
  };
}

async function saveScheduleAssignments(
  scheduleId,
  weekStartDate,
  assignmentsBody,
  overrideWarnings,
  user
) {
  const persistedSchedule = await resolveScheduleWeek(
    scheduleId,
    weekStartDate
  );

  if (!canEditScheduleAssignments(user)) {
    throw createHttpError(403, "Manager permission is required");
  }

  if (
    user.permissionRole === PERMISSION_ROLES.SHIFT_LEADER &&
    !persistedSchedule.publishedAt
  ) {
    throw createHttpError(
      403,
      "Schedule must be published before shift leaders can edit assignments"
    );
  }

  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    persistedSchedule.weekStartDate
  );
  const assignments = validateAssignmentPayload(assignmentsBody);
  ensureAssignmentsMatchWeekAndRoles(scheduleInputs, assignments);
  const warnings = buildManualAssignmentWarnings(scheduleInputs, assignments);

  if (overrideWarnings && user.permissionRole !== PERMISSION_ROLES.MANAGER) {
    throw createHttpError(403, "Only managers can override assignment warnings");
  }

  if (warnings.length && !overrideWarnings) {
    throw createHttpError(
      400,
      "Assignments contain warnings. Review them or save with overrideWarnings as a manager.",
      {
        warnings,
      }
    );
  }

  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.allEmployees || scheduleInputs.employees,
    assignments
  );
  const persistenceResult = await scheduleRepository.saveScheduleAssignments(
    scheduleInputs.weekStartDate,
    persistedAssignments,
    {
      preservePublished: user.permissionRole === PERMISSION_ROLES.SHIFT_LEADER,
    }
  );
  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    assignments
  );

  return {
    message: "Schedule assignments saved successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: persistenceResult.scheduleId,
      publishedAt: persistenceResult.publishedAt,
      permissionRole: user.permissionRole,
    }),
    warnings,
    persistenceResult,
  };
}

async function validateSchedule(
  scheduleId,
  weekStartDate,
  assignmentsBody,
  hasUnsavedChanges,
  user
) {
  // מאתרים את השבוע האמיתי של הסידור לפי scheduleId/weekStartDate.
  const persistedScheduleForWeek = await resolveScheduleWeek(
    scheduleId,
    weekStartDate
  );
  // טוענים את כל נתוני השבוע הדרושים לבדיקה.
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    persistedScheduleForWeek.weekStartDate
  );
  // מביאים את הסידור השמור מה-DB.
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    scheduleInputs.weekStartDate
  );

  if (!persistedSchedule) {
    throw createHttpError(404, "No saved schedule exists for this week");
  }

  // אם נשלחו שיבוצים מהמסך בודקים אותם, אחרת משתמשים בשיבוצים השמורים.
  const assignments = Array.isArray(assignmentsBody)
    ? validateAssignmentPayload(assignmentsBody, { requireNonEmpty: false })
    : persistedSchedule.assignments;

  // מוודא שהשיבוצים שייכים לשבוע ולתפקידים הנכונים.
  ensureAssignmentsMatchWeekAndRoles(scheduleInputs, assignments);

  // בונים תוצאת אלגוריתם מתוך השיבוצים כדי להשתמש באותן בדיקות/formatter.
  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    assignments
  );
  // board נבנה כדי להשתמש בסיכום legacy שהמסך עדיין מצפה לו.
  const board = buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
    scheduleId: persistedSchedule.scheduleId,
    publishedAt: persistedSchedule.publishedAt,
    permissionRole: user.permissionRole,
  });
  // בדיקות ידניות: זמינות, כפילויות, תפקיד לא מתאים וכו'.
  const manualWarnings = buildManualAssignmentWarnings(scheduleInputs, assignments);
  // בדיקות כיסוי: האם חסרים עובדים ביחס לדרישות המשמרת.
  const coverageIssues = buildCoverageIssues(
    scheduleInputs,
    algorithmResult.shiftValidationSummaries
  );
  // בדיקות חוזק: האם כוח העובדים במשמרת עומד ביעד.
  const strengthIssues = buildStrengthIssues(
    scheduleInputs,
    algorithmResult.shiftValidationSummaries
  );
  const enrichedManualIssues = manualWarnings
    .map((warning) => enrichManualAssignmentIssue(scheduleInputs, warning))
    .filter((issue) => !isSameDayDoubleAssignmentIssue(issue));
  const availabilityIssues = enrichedManualIssues.filter(
    (issue) => issue.type === "employee_not_available"
  );
  const invalidAssignments = enrichedManualIssues.filter(
    (issue) => issue.type !== "employee_not_available"
  );
  const fairnessWarnings = buildFairnessWarnings(scheduleInputs, assignments);
  // report הוא הדוח שה-Frontend מציג בחלון בדיקת סידור.
  const report = {
    message: "Schedule validation completed",
    summary: buildValidationSummary(
      scheduleInputs,
      assignments,
      algorithmResult.shiftValidationSummaries,
      hasUnsavedChanges
    ),
    coverageIssues,
    strengthIssues,
    availabilityIssues,
    invalidAssignments,
    fairnessWarnings,
    warnings: [
      ...coverageIssues,
      ...strengthIssues,
      ...availabilityIssues,
      ...invalidAssignments,
      ...fairnessWarnings,
    ],
  };
  // קובע אם הדוח תקין, עם אזהרות, או חסום.
  const statusResult = resolveValidationStatus(report);

  return {
    ...report,
    status: statusResult.status,
    recommendation: statusResult.recommendation,
    legacySummary: board.summary,
  };
}

async function clearScheduleAssignments(scheduleId, user) {
  const numericScheduleId = parseScheduleId(scheduleId);
  const clearResult = await scheduleRepository.clearScheduleAssignments(
    numericScheduleId
  );
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    clearResult.weekStartDate
  );
  const algorithmResult = buildAlgorithmResultFromAssignments(scheduleInputs, []);

  return {
    message: "Schedule cleared successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: clearResult.scheduleId,
      publishedAt: clearResult.publishedAt,
      permissionRole: user.permissionRole,
    }),
    clearResult,
  };
}

async function publishSchedule(scheduleId, user) {
  // ממירים ובודקים שה-scheduleId תקין.
  const numericScheduleId = parseScheduleId(scheduleId);
  // repository מעדכן published_at במסד.
  const publishResult = await scheduleRepository.publishSchedule(numericScheduleId);
  // אחרי העדכון טוענים שוב נתוני שבוע ושיבוצים כדי להחזיר board מלא.
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    publishResult.weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleById(
    numericScheduleId
  );
  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );

  return {
    // ה-Frontend משתמש ב-board שחוזר כדי להציג מצב published.
    message: "Schedule published successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: publishResult.scheduleId,
      publishedAt: publishResult.publishedAt,
      permissionRole: user.permissionRole,
    }),
    publishResult,
  };
}

async function unpublishSchedule(scheduleId, user) {
  // ביטול פרסום עובד על אותו scheduleId ושומר את השיבוצים כמו שהם.
  const numericScheduleId = parseScheduleId(scheduleId);
  const unpublishResult = await scheduleRepository.unpublishSchedule(
    numericScheduleId
  );
  // טוענים מחדש כדי להחזיר board מלא עם publishedAt = null.
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    unpublishResult.weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleById(
    numericScheduleId
  );
  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );

  return {
    message: "Schedule unpublished successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: unpublishResult.scheduleId,
      publishedAt: null,
      permissionRole: user.permissionRole,
    }),
    unpublishResult,
  };
}

async function updateShiftRequiredStrength(shiftId, requiredStrengthScore, user) {
  const numericShiftId = Number(shiftId);
  const numericStrength = Number(requiredStrengthScore);

  if (!Number.isInteger(numericShiftId) || numericShiftId <= 0) {
    throw createHttpError(400, "shiftId must be a positive integer");
  }

  if (
    !Number.isFinite(numericStrength) ||
    numericStrength < 0 ||
    numericStrength > 100
  ) {
    throw createHttpError(400, "requiredStrengthScore must be between 0 and 100");
  }

  const updatedShift = await scheduleRepository.updateShiftRequiredStrength(
    numericShiftId,
    numericStrength
  );

  if (!updatedShift) {
    throw createHttpError(404, "Shift not found");
  }

  const weekStartDate = getSundayForDate(updatedShift.shift_date);
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    weekStartDate
  );

  if (!persistedSchedule) {
    return {
      message: "Shift required strength updated successfully",
      shiftId: numericShiftId,
      requiredStrengthScore: numericStrength,
    };
  }

  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );

  return {
    message: "Shift required strength updated successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: persistedSchedule.scheduleId,
      publishedAt: persistedSchedule.publishedAt,
      permissionRole: user.permissionRole,
    }),
  };
}

function readIntegerRequirement(value, fieldName, min) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue < min) {
    throw createHttpError(400, `${fieldName} must be an integer greater than or equal to ${min}`);
  }

  return numberValue;
}

function normalizeShiftRequirements(body) {
  const requiredStrengthScore = Number(body.requiredStrengthScore);

  if (
    !Number.isFinite(requiredStrengthScore) ||
    requiredStrengthScore < 0 ||
    requiredStrengthScore > 100
  ) {
    throw createHttpError(400, "requiredStrengthScore must be between 0 and 100");
  }

  return {
    requiredWaiters: readIntegerRequirement(body.requiredWaiters, "requiredWaiters", 1),
    requiredBartenders: readIntegerRequirement(body.requiredBartenders, "requiredBartenders", 0),
    requiredShiftLeaders: readIntegerRequirement(body.requiredShiftLeaders, "requiredShiftLeaders", 0),
    requiredStrengthScore,
  };
}

const CUSTOMER_LOAD_SCORES = {
  low: 3,
  normal: 5,
  high: 8,
  extreme: 10,
};

const WAITER_SUITABILITY_VALUES = new Set([
  "needs_more_waiters",
  "suitable",
  "too_many_waiters",
]);

const TEAM_PERFORMANCE_SCORES = {
  weak: 4,
  reasonable: 6,
  good: 8,
  excellent: 10,
};

function normalizeFinishShiftFeedback(body) {
  const actualCustomerLoad = String(body.actualCustomerLoad || "").trim();
  const waiterSuitability = String(body.waiterSuitability || "").trim();
  const teamPerformance = String(body.teamPerformance || "").trim();

  if (!Object.prototype.hasOwnProperty.call(CUSTOMER_LOAD_SCORES, actualCustomerLoad)) {
    throw createHttpError(400, "actualCustomerLoad is invalid");
  }

  if (!WAITER_SUITABILITY_VALUES.has(waiterSuitability)) {
    throw createHttpError(400, "waiterSuitability is invalid");
  }

  if (!Object.prototype.hasOwnProperty.call(TEAM_PERFORMANCE_SCORES, teamPerformance)) {
    throw createHttpError(400, "teamPerformance is invalid");
  }

  return {
    actualCustomerLoad,
    waiterSuitability,
    teamPerformance,
    expectedCustomerLoad: CUSTOMER_LOAD_SCORES[actualCustomerLoad],
    managerRating: TEAM_PERFORMANCE_SCORES[teamPerformance],
  };
}

function calculateFeedbackWaiterCount(waiterAssignmentCount, waiterSuitability) {
  if (waiterSuitability === "needs_more_waiters") {
    return waiterAssignmentCount + 1;
  }

  if (waiterSuitability === "too_many_waiters") {
    return Math.max(1, waiterAssignmentCount - 1);
  }

  return waiterAssignmentCount;
}

function calculateAssignedWaiterStrength(assignments, employees) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  return roundScore(
    assignments
      .filter((assignment) => assignment.jobRole === "waiter")
      .reduce((total, assignment) => {
        const employee = employeeById.get(assignment.employeeId);
        return total + (employee ? calculateStrengthScore(employee) : 0);
      }, 0)
  );
}

async function updateShiftRequirements(shiftId, body, user) {
  const numericShiftId = Number(shiftId);

  if (!Number.isInteger(numericShiftId) || numericShiftId <= 0) {
    throw createHttpError(400, "shiftId must be a positive integer");
  }

  const requirements = normalizeShiftRequirements(body);
  const updatedShift = await scheduleRepository.updateShiftRequirements(
    numericShiftId,
    requirements
  );

  if (!updatedShift) {
    throw createHttpError(404, "Shift not found");
  }

  const weekStartDate = getSundayForDate(updatedShift.shift_date);
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    weekStartDate
  );

  if (!persistedSchedule) {
    return {
      message: "Shift requirements updated successfully",
      shiftId: numericShiftId,
      requirements,
    };
  }

  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );

  return {
    message: "Shift requirements updated successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: persistedSchedule.scheduleId,
      publishedAt: persistedSchedule.publishedAt,
      permissionRole: user.permissionRole,
    }),
  };
}

async function finishShift(shiftId, body, user) {
  const numericShiftId = Number(shiftId);

  if (!Number.isInteger(numericShiftId) || numericShiftId <= 0) {
    throw createHttpError(400, "shiftId must be a positive integer");
  }

  if (
    user.permissionRole !== PERMISSION_ROLES.MANAGER &&
    user.permissionRole !== PERMISSION_ROLES.SHIFT_LEADER
  ) {
    throw createHttpError(403, "Manager or shift manager permission is required");
  }

  const feedback = normalizeFinishShiftFeedback(body);
  const shift = await scheduleRepository.getShiftById(numericShiftId);

  if (!shift) {
    throw createHttpError(404, "Shift not found");
  }

  const existingFeedback = await mlRepository.getPerformanceLogByShift(shift);

  if (existingFeedback) {
    throw createHttpError(409, "Shift feedback was already submitted");
  }

  const weekStartDate = getSundayForDate(shift.shift_date);
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    weekStartDate
  );

  if (!persistedSchedule) {
    throw createHttpError(400, "A saved schedule is required before finishing a shift");
  }

  const shiftAssignments = persistedSchedule.assignments.filter(
    (assignment) => assignment.shiftId === numericShiftId
  );
  const assignedWaiterCount = shiftAssignments.filter(
    (assignment) => assignment.jobRole === "waiter"
  ).length;
  const actualWaitersCount = calculateFeedbackWaiterCount(
    assignedWaiterCount,
    feedback.waiterSuitability
  );
  const actualStrengthScore = calculateAssignedWaiterStrength(
    shiftAssignments,
    scheduleInputs.allEmployees || scheduleInputs.employees
  );
  const shiftDate = formatDateKey(shift.shift_date);
  const dayOfWeek = getDayOfWeek(shiftDate);

  await mlRepository.saveShiftPerformanceLog({
    shiftDate,
    shiftType: shift.shift_type,
    dayOfWeek,
    isWeekend: isWeekend(dayOfWeek),
    expectedCustomerLoad: feedback.expectedCustomerLoad,
    actualWaitersCount,
    actualStrengthScore,
    managerRating: feedback.managerRating,
  });

  const refreshedScheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const algorithmResult = buildAlgorithmResultFromAssignments(
    refreshedScheduleInputs,
    persistedSchedule.assignments
  );

  return {
    message: "Shift feedback saved successfully",
    feedback: {
      shiftId: numericShiftId,
      actualCustomerLoad: feedback.actualCustomerLoad,
      waiterSuitability: feedback.waiterSuitability,
      teamPerformance: feedback.teamPerformance,
      expectedCustomerLoad: feedback.expectedCustomerLoad,
      actualWaitersCount,
      actualStrengthScore,
      managerRating: feedback.managerRating,
    },
    ...buildScheduleBoardResponse(refreshedScheduleInputs, algorithmResult, {
      scheduleId: persistedSchedule.scheduleId,
      publishedAt: persistedSchedule.publishedAt,
      permissionRole: user.permissionRole,
    }),
  };
}

module.exports = {
  getScheduleForWeek,
  generateScheduleForWeek,
  saveScheduleAssignments,
  validateSchedule,
  clearScheduleAssignments,
  publishSchedule,
  unpublishSchedule,
  updateShiftRequiredStrength,
  updateShiftRequirements,
  finishShift,
  buildPersistedAssignments,
};
