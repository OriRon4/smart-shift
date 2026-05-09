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
      scheduleInputs.employees
    ),
  };
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
    permissionRole: user.permissionRole,
  });
}

async function generateScheduleForWeek(weekStartDate, user) {
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const algorithmResult = generateScheduleAlgorithm(scheduleInputs);
  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.employees,
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

  return assignments.map((assignment) => {
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

    return {
      shiftId,
      employeeId,
      jobRole: assignment.jobRole,
    };
  });
}

function ensureAssignmentsMatchWeekAndRoles(scheduleInputs, assignments) {
  const shiftIds = new Set(scheduleInputs.shifts.map((shift) => shift.id));
  const employeeById = new Map(
    scheduleInputs.employees.map((employee) => [employee.id, employee])
  );

  for (const assignment of assignments) {
    if (!shiftIds.has(assignment.shiftId)) {
      throw createHttpError(400, "assignment.shiftId is not in the selected week");
    }

    const employee = employeeById.get(assignment.employeeId);

    if (!employee) {
      throw createHttpError(400, "assignment.employeeId is not an active schedule employee");
    }

    if (employee.role !== assignment.jobRole) {
      throw createHttpError(400, "assignment.jobRole does not match the employee job role");
    }
  }
}

async function saveScheduleAssignments(weekStartDate, assignmentsBody, user) {
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  const assignments = validateAssignmentPayload(assignmentsBody);
  ensureAssignmentsMatchWeekAndRoles(scheduleInputs, assignments);

  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.employees,
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
      permissionRole: user.permissionRole,
    }),
    persistenceResult,
  };
}

async function validateSchedule(weekStartDate, user) {
  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
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
    permissionRole: user.permissionRole,
  });
  const warnings = algorithmResult.shiftValidationSummaries
    .filter((summary) => summary.uncoveredSlots > 0 || !summary.meetsStrengthTarget)
    .map((summary) => ({
      shiftId: summary.shiftId,
      jobRole: summary.jobRole,
      uncoveredSlots: summary.uncoveredSlots,
      meetsStrengthTarget: summary.meetsStrengthTarget,
    }));

  return {
    message: "Schedule validation completed",
    warnings,
    summary: board.summary,
  };
}

module.exports = {
  getScheduleForWeek,
  generateScheduleForWeek,
  saveScheduleAssignments,
  validateSchedule,
  buildPersistedAssignments,
};
