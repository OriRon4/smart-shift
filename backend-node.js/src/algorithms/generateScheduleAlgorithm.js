// Worker strength calculations
function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (seniorityMonths / 24) * 10);
}

function calculateStrengthScore(employee) {
  const seniorityScore = calculateSeniorityScore(employee.seniority_months);

  return (
    0.35 * employee.professionalism +
    0.3 * employee.responsibility +
    0.2 * employee.pressure_handling +
    0.1 * seniorityScore +
    0.05 * employee.potential
  );
}

function calculateNormalizedStrength(strengthScore) {
  return strengthScore / 10;
}

// Fairness and target-shift calculations
function calculateTargetShifts(requestedShifts, normalizedStrength) {
  return requestedShifts * (0.55 + 0.45 * normalizedStrength);
}

function calculateFairnessGap(targetShifts, assignedShifts) {
  return Math.max(0, targetShifts - assignedShifts);
}

function calculateFairnessGapScore(fairnessGap, targetShifts) {
  return fairnessGap / Math.max(1, targetShifts);
}

// Forced-assignment logic
function findForcedShifts(shifts, shiftRequests) {
  const requestsByShiftId = new Map();

  for (const shiftRequest of shiftRequests) {
    const existingEmployeeIds =
      requestsByShiftId.get(shiftRequest.shift_id) || [];

    existingEmployeeIds.push(shiftRequest.employee_id);
    requestsByShiftId.set(shiftRequest.shift_id, existingEmployeeIds);
  }

  return shifts
    .map((shift) => {
      const employeeIds = requestsByShiftId.get(shift.id) || [];
      const requestedCount = employeeIds.length;

      return {
        shiftId: shift.id,
        requiredWaiters: shift.required_waiters,
        requestedCount,
        employeeIds,
      };
    })
    .filter((shift) => shift.requestedCount <= shift.requiredWaiters);
}

function buildForcedAssignments(forcedShifts) {
  return forcedShifts.flatMap((forcedShift) =>
    forcedShift.employeeIds.map((employeeId) => ({
      shiftId: forcedShift.shiftId,
      employeeId,
    }))
  );
}

// Step 13: shift ordering logic
function calculateCoveragePressure(requiredWaiters, availableWorkers) {
  return requiredWaiters / Math.max(1, availableWorkers);
}

function calculatePriorityOrderScore(
  requiredWaiters,
  requiredStrengthScore,
  availableWorkers
) {
  const coveragePressure = calculateCoveragePressure(
    requiredWaiters,
    availableWorkers
  );
  const strengthRequirementRatio =
    Number(requiredStrengthScore) / Math.max(1, requiredWaiters * 10);

  return 0.6 * coveragePressure + 0.4 * strengthRequirementRatio;
}

function orderShiftsByPriority(shifts, shiftRequests, excludedShiftIds = []) {
  const excludedShiftIdSet = new Set(excludedShiftIds);
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
    .filter((shift) => !excludedShiftIdSet.has(shift.id))
    .map((shift) => {
      const availableWorkers = availableWorkersByShiftId.get(shift.id) || 0;
      const coveragePressure = calculateCoveragePressure(
        shift.required_waiters,
        availableWorkers
      );
      const priorityOrderScore = calculatePriorityOrderScore(
        shift.required_waiters,
        shift.required_strength_score,
        availableWorkers
      );

      return {
        ...shift,
        availableWorkers,
        coveragePressure,
        priorityOrderScore,
      };
    })
    .sort((leftShift, rightShift) => {
      if (rightShift.priorityOrderScore !== leftShift.priorityOrderScore) {
        return rightShift.priorityOrderScore - leftShift.priorityOrderScore;
      }

      return leftShift.id - rightShift.id;
    });
}

// Step 14: candidate scoring logic
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

// Step 15: main assignment flow
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

function buildEmployeeStateById(employees, shiftRequests, forcedAssignments) {
  const requestedShiftCountsByEmployee =
    buildRequestedShiftCountsByEmployee(shiftRequests);
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(forcedAssignments);
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

function assignRemainingShifts(scheduleInputs, forcedAssignments = []) {
  const { employees, shifts, shiftRequests } = scheduleInputs;
  const forcedShiftIds = [
    ...new Set(forcedAssignments.map((assignment) => assignment.shiftId)),
  ];
  const orderedShifts = orderShiftsByPriority(
    shifts,
    shiftRequests,
    forcedShiftIds
  );
  const employeeStateById = buildEmployeeStateById(
    employees,
    shiftRequests,
    forcedAssignments
  );
  const requestedEmployeeIdsByShift = buildRequestedEmployeeIdsByShift(
    shiftRequests
  );
  const allAssignments = [...forcedAssignments];
  const remainingAssignments = [];

  for (const shift of orderedShifts) {
    let assignedCount = 0;
    let currentShiftStrength = 0;

    while (assignedCount < shift.required_waiters) {
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
      };

      remainingAssignments.push(assignment);
      allAssignments.push(assignment);
      assignedCount += 1;
      currentShiftStrength += selectedCandidate.strengthScore;

      const employeeState = employeeStateById.get(selectedCandidate.employeeId);
      employeeState.assignedShifts += 1;
    }
  }

  return {
    orderedShifts,
    remainingAssignments,
    allAssignments,
  };
}

function generateScheduleAlgorithm(scheduleInputs) {
  const forcedShifts = findForcedShifts(
    scheduleInputs.shifts,
    scheduleInputs.shiftRequests
  );

  const forcedAssignments = buildForcedAssignments(forcedShifts);
  const assignmentResult = assignRemainingShifts(
    scheduleInputs,
    forcedAssignments
  );

  return {
    forcedShifts,
    forcedAssignments,
    orderedShifts: assignmentResult.orderedShifts,
    remainingAssignments: assignmentResult.remainingAssignments,
    allAssignments: assignmentResult.allAssignments,
  };
}

module.exports = {
  generateScheduleAlgorithm,
};
