const scheduleRepository = require("../repositories/scheduleRepository");
const {
  buildRoleValidationSummaries,
  calculateStrengthScore,
  generateScheduleAlgorithm,
} = require("../algorithms/generateScheduleAlgorithm");
const {
  buildScheduleBoardResponse,
} = require("../formatters/scheduleBoardFormatter");
const { SCHEDULE_JOB_ROLES } = require("../constants/roles");
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

  return persistedSchedule.weekStartDate;
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
      canManage: user.permissionRole === "manager",
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
  const resolvedWeekStartDate = await resolveScheduleWeek(
    scheduleId,
    weekStartDate
  );
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    resolvedWeekStartDate
  );
  const assignments = validateAssignmentPayload(assignmentsBody);
  ensureAssignmentsMatchWeekAndRoles(scheduleInputs, assignments);

  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.allEmployees || scheduleInputs.employees,
    assignments
  );
  const persistenceResult = await scheduleRepository.saveScheduleAssignments(
    scheduleInputs.weekStartDate,
    persistedAssignments
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
  const resolvedWeekStartDate = await resolveScheduleWeek(
    scheduleId,
    weekStartDate
  );
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    resolvedWeekStartDate
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

module.exports = {
  getScheduleForWeek,
  generateScheduleForWeek,
  saveScheduleAssignments,
  validateSchedule,
  clearScheduleAssignments,
  publishSchedule,
  buildPersistedAssignments,
};
