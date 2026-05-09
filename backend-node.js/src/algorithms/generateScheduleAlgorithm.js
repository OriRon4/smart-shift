const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (seniorityMonths / 24) * 10);
}

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

function calculateNormalizedStrength(strengthScore) {
  return strengthScore / 10;
}

function getRequiredCount(shift, roleConfig) {
  return Number(shift[roleConfig.requirementField] || 0);
}

function calculateTargetShifts(requestedShifts, normalizedStrength) {
  return requestedShifts * (0.55 + 0.45 * normalizedStrength);
}

function calculateFairnessGap(targetShifts, assignedShifts) {
  return Math.max(0, targetShifts - assignedShifts);
}

function calculateFairnessGapScore(fairnessGap, targetShifts) {
  return fairnessGap / Math.max(1, targetShifts);
}

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

function buildEmployeeStateById(employees, shiftRequests, assignments) {
  const requestedShiftCountsByEmployee =
    buildRequestedShiftCountsByEmployee(shiftRequests);
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(assignments);
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
  const strengthRequirementRatio =
    Number(requiredStrengthScore) / Math.max(1, requiredCount * 10);

  return 0.6 * coveragePressure + 0.4 * strengthRequirementRatio;
}

function orderShiftsByPriority(shifts, shiftRequests, roleConfig) {
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
    .filter((shift) => shift.requiredCount > 0)
    .sort((leftShift, rightShift) => {
      if (rightShift.priorityOrderScore !== leftShift.priorityOrderScore) {
        return rightShift.priorityOrderScore - leftShift.priorityOrderScore;
      }

      return leftShift.id - rightShift.id;
    });
}

function findForcedAssignments(shifts, shiftRequests, roleConfig) {
  const requestedEmployeeIdsByShift = buildRequestedEmployeeIdsByShift(
    shiftRequests
  );

  return shifts.flatMap((shift) => {
    const requiredCount = getRequiredCount(shift, roleConfig);
    const employeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

    if (requiredCount <= 0 || employeeIds.length > requiredCount) {
      return [];
    }

    return employeeIds.map((employeeId) => ({
      shiftId: shift.id,
      employeeId,
      jobRole: roleConfig.jobRole,
    }));
  });
}

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
  const strengthGapScore = calculateStrengthGapScore(
    requiredStrengthScore,
    currentShiftStrength
  );

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

function buildCandidatesForShift(
  shift,
  requestedEmployeeIdsByShift,
  employeeStateById,
  allAssignments
) {
  const requestedEmployeeIds = requestedEmployeeIdsByShift.get(shift.id) || [];

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

function assignRole(scheduleInputs, roleConfig) {
  const employees = scheduleInputs.employees.filter(
    (employee) => employee.role === roleConfig.jobRole
  );
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const shiftRequests = scheduleInputs.shiftRequests.filter((shiftRequest) =>
    employeeIds.has(shiftRequest.employee_id)
  );
  const forcedAssignments = findForcedAssignments(
    scheduleInputs.shifts,
    shiftRequests,
    roleConfig
  );
  const forcedShiftIds = new Set(
    forcedAssignments.map((assignment) => assignment.shiftId)
  );
  const orderedShifts = orderShiftsByPriority(
    scheduleInputs.shifts,
    shiftRequests,
    roleConfig
  ).filter((shift) => !forcedShiftIds.has(shift.id));
  const employeeStateById = buildEmployeeStateById(
    employees,
    shiftRequests,
    forcedAssignments
  );
  const requestedEmployeeIdsByShift = buildRequestedEmployeeIdsByShift(
    shiftRequests
  );
  const allAssignments = [...forcedAssignments];

  for (const shift of orderedShifts) {
    let assignedCount = 0;
    let currentShiftStrength = 0;

    while (assignedCount < shift.requiredCount) {
      const candidates = buildCandidatesForShift(
        shift,
        requestedEmployeeIdsByShift,
        employeeStateById,
        allAssignments
      );

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
        jobRole: roleConfig.jobRole,
      };

      allAssignments.push(assignment);
      assignedCount += 1;
      currentShiftStrength += selectedCandidate.strengthScore;

      const employeeState = employeeStateById.get(selectedCandidate.employeeId);
      employeeState.assignedShifts += 1;
    }
  }

  return {
    jobRole: roleConfig.jobRole,
    orderedShifts,
    forcedAssignments,
    assignments: allAssignments,
  };
}

function buildRoleValidationSummaries(shifts, assignments, employees) {
  const strengthScoreByEmployeeId = new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
  const assignmentsByShiftAndRole = new Map();

  for (const assignment of assignments) {
    const key = `${assignment.shiftId}:${assignment.jobRole}`;
    const existingSummary = assignmentsByShiftAndRole.get(key) || {
      assignedCount: 0,
      assignedStrengthScore: 0,
    };

    existingSummary.assignedCount += 1;
    existingSummary.assignedStrengthScore +=
      strengthScoreByEmployeeId.get(assignment.employeeId) || 0;

    assignmentsByShiftAndRole.set(key, existingSummary);
  }

  return shifts.flatMap((shift) =>
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      const requiredCount = getRequiredCount(shift, roleConfig);
      const key = `${shift.id}:${roleConfig.jobRole}`;
      const summary = assignmentsByShiftAndRole.get(key) || {
        assignedCount: 0,
        assignedStrengthScore: 0,
      };
      const roleStrengthTarget =
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

function generateScheduleAlgorithm(scheduleInputs) {
  const roleResults = SCHEDULE_JOB_ROLES.map((roleConfig) =>
    assignRole(scheduleInputs, roleConfig)
  );
  const allAssignments = roleResults.flatMap(
    (roleResult) => roleResult.assignments
  );
  const shiftValidationSummaries = buildRoleValidationSummaries(
    scheduleInputs.shifts,
    allAssignments,
    scheduleInputs.employees
  );

  return {
    roleResults,
    allAssignments,
    shiftValidationSummaries,
  };
}

module.exports = {
  calculateStrengthScore,
  buildRoleValidationSummaries,
  generateScheduleAlgorithm,
};
