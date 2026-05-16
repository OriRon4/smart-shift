const scheduleRepository = require("../repositories/scheduleRepository");
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

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildPersistedAssignments(employees, assignments) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

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
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    scheduleInputs.weekStartDate
  );

  if (!persistedSchedule) {
    return {
      scheduleId: null,
      weekStartDate: scheduleInputs.weekStartDate,
      weekEndDate: scheduleInputs.weekEndDate,
      publishedAt: null,
      days: [],
      canEdit: false,
      canManage: user.permissionRole === PERMISSION_ROLES.MANAGER,
    };
  }

  if (!persistedSchedule.publishedAt && !canViewUnpublishedSchedule(user)) {
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

  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );

  return buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
    scheduleId: persistedSchedule.scheduleId,
    publishedAt: persistedSchedule.publishedAt,
    permissionRole: user.permissionRole,
  });
}

async function generateScheduleForWeek(weekStartDate, user) {
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const algorithmResult = generateScheduleAlgorithm(scheduleInputs);
  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.allEmployees || scheduleInputs.employees,
    algorithmResult.allAssignments
  );
  const persistenceResult = await scheduleRepository.saveScheduleAssignments(
    scheduleInputs.weekStartDate,
    persistedAssignments
  );

  return {
    message: "Schedule generated successfully",
    ...buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
      scheduleId: persistenceResult.scheduleId,
      publishedAt: persistenceResult.publishedAt,
      permissionRole: user.permissionRole,
    }),
    persistenceResult,
  };
}

function validateAssignmentPayload(assignments) {
  if (!Array.isArray(assignments) || !assignments.length) {
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
    const key = `${assignment.shiftId}:${assignment.employeeId}`;
    assignmentCountByShiftAndEmployee.set(
      key,
      (assignmentCountByShiftAndEmployee.get(key) || 0) + 1
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

async function saveScheduleAssignments(
  scheduleId,
  weekStartDate,
  assignmentsBody,
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
    persistenceResult,
  };
}

async function validateSchedule(scheduleId, weekStartDate, user) {
  const persistedScheduleForWeek = await resolveScheduleWeek(
    scheduleId,
    weekStartDate
  );
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    persistedScheduleForWeek.weekStartDate
  );
  const persistedSchedule = await scheduleRepository.getPersistedScheduleByWeek(
    scheduleInputs.weekStartDate
  );

  if (!persistedSchedule) {
    throw createHttpError(404, "No saved schedule exists for this week");
  }

  const algorithmResult = buildAlgorithmResultFromAssignments(
    scheduleInputs,
    persistedSchedule.assignments
  );
  const board = buildScheduleBoardResponse(scheduleInputs, algorithmResult, {
    scheduleId: persistedSchedule.scheduleId,
    publishedAt: persistedSchedule.publishedAt,
    permissionRole: user.permissionRole,
  });
  const warnings = algorithmResult.shiftValidationSummaries
    .filter((summary) => summary.uncoveredSlots > 0 || !summary.meetsStrengthTarget)
    .map((summary) => ({
      shiftId: summary.shiftId,
      jobRole: summary.jobRole,
      uncoveredSlots: summary.uncoveredSlots,
      meetsStrengthTarget: summary.meetsStrengthTarget,
    }))
    .concat(
      buildManualAssignmentWarnings(
        scheduleInputs,
        persistedSchedule.assignments
      )
    );

  return {
    message: "Schedule validation completed",
    warnings,
    summary: board.summary,
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
  const numericScheduleId = parseScheduleId(scheduleId);
  const publishResult = await scheduleRepository.publishSchedule(numericScheduleId);
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
  const numericScheduleId = parseScheduleId(scheduleId);
  const unpublishResult = await scheduleRepository.unpublishSchedule(
    numericScheduleId
  );
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

  if (!Number.isFinite(numericStrength) || numericStrength < 0) {
    throw createHttpError(400, "requiredStrengthScore must be a non-negative number");
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
  buildPersistedAssignments,
};
