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

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
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

function buildShiftById(shifts) {
  return new Map(shifts.map((shift) => [shift.id, shift]));
}

function buildAvailabilitySet(shiftRequests) {
  return new Set(
    shiftRequests.map(
      (shiftRequest) => `${shiftRequest.employee_id}:${shiftRequest.shift_id}`
    )
  );
}

function buildEmployeeById(employees) {
  return new Map(employees.map((employee) => [employee.id, employee]));
}

function findSameDayDoubleShiftIssues(assignments, shifts) {
  const shiftById = buildShiftById(shifts);
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
      if (dayAssignments.length <= 1) {
        return [];
      }

      const [employeeId, date] = key.split(":");

      return [
        {
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
  const employeeStateById = buildEmployeeStateById(
    scheduleInputs.employees,
    scheduleInputs.shiftRequests,
    assignments
  );

  return [...employeeStateById.values()]
    .map((employeeState) => {
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
    .filter((issue) => issue.requestedShifts > 0 && issue.gap > 0.5);
}

function findScheduleIssues(scheduleInputs, assignments) {
  const validationSummaries = buildRoleValidationSummaries(
    scheduleInputs.shifts,
    assignments,
    scheduleInputs.employees
  );
  const uncoveredRoleGroups = validationSummaries
    .filter((summary) => summary.uncoveredSlots > 0)
    .map((summary) => ({
      type: "uncovered_role_group",
      shiftId: summary.shiftId,
      jobRole: summary.jobRole,
      uncoveredSlots: summary.uncoveredSlots,
    }));
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
  const sameDayDoubleShifts = findSameDayDoubleShiftIssues(
    assignments,
    scheduleInputs.shifts
  );
  const employeesUnderTarget = findFairnessIssues(scheduleInputs, assignments);

  return {
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
  const issues = findScheduleIssues(scheduleInputs, assignments);
  const uncoveredSlots = issues.uncoveredRoleGroups.reduce(
    (total, issue) => total + issue.uncoveredSlots,
    0
  );
  const strengthDeficit = issues.belowStrengthRoleGroups.reduce(
    (total, issue) => total + issue.strengthDeficit,
    0
  );
  const sameDayPenaltyCount = issues.sameDayDoubleShifts.reduce(
    (total, issue) => total + issue.extraAssignments,
    0
  );
  const fairnessGap = issues.employeesUnderTarget.reduce(
    (total, issue) => total + issue.gap,
    0
  );
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
  const targetShiftId = swap.get(assignmentIndex) || assignment.shiftId;

  return assignments.some((otherAssignment, otherIndex) => {
    if (otherIndex === assignmentIndex) {
      return false;
    }

    const otherTargetShiftId =
      swap.get(otherIndex) || otherAssignment.shiftId;

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

  if (
    leftAssignment.jobRole !== rightAssignment.jobRole ||
    leftAssignment.shiftId === rightAssignment.shiftId
  ) {
    return false;
  }

  const leftEmployee = employeeById.get(leftAssignment.employeeId);
  const rightEmployee = employeeById.get(rightAssignment.employeeId);

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

  const swap = new Map([
    [leftIndex, rightAssignment.shiftId],
    [rightIndex, leftAssignment.shiftId],
  ]);

  return (
    !createsDuplicateShiftAssignment(assignments, leftIndex, swap) &&
    !createsDuplicateShiftAssignment(assignments, rightIndex, swap)
  );
}

function swapAssignmentShiftIds(assignments, leftIndex, rightIndex) {
  const improvedAssignments = assignments.map((assignment) => ({
    ...assignment,
  }));
  const leftShiftId = improvedAssignments[leftIndex].shiftId;

  improvedAssignments[leftIndex].shiftId =
    improvedAssignments[rightIndex].shiftId;
  improvedAssignments[rightIndex].shiftId = leftShiftId;

  return improvedAssignments;
}

function tryImproveBySameRoleSwaps(scheduleInputs, assignments, currentScore) {
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests);
  const employeeById = buildEmployeeById(scheduleInputs.employees);
  let bestImprovement = null;
  let rejectedSwaps = 0;

  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assignments.length;
      rightIndex += 1
    ) {
      if (
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

      const candidateAssignments = swapAssignmentShiftIds(
        assignments,
        leftIndex,
        rightIndex
      );
      const candidateScore = scoreSchedule(
        scheduleInputs,
        candidateAssignments
      );

      if (candidateScore.totalScore >= currentScore.totalScore) {
        rejectedSwaps += 1;
        continue;
      }

      if (
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
  let assignments = initialAssignments.map((assignment) => ({ ...assignment }));
  const issuesBefore = findScheduleIssues(scheduleInputs, assignments);
  const scoreBefore = scoreSchedule(scheduleInputs, assignments);
  let currentScore = scoreBefore;
  let rejectedSwaps = 0;
  const acceptedSwaps = [];
  const correctionLog = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const improvement = tryImproveBySameRoleSwaps(
      scheduleInputs,
      assignments,
      currentScore
    );

    rejectedSwaps += improvement.rejectedSwaps;

    if (!improvement.bestImprovement) {
      break;
    }

    assignments = improvement.bestImprovement.assignments;
    currentScore = improvement.bestImprovement.score;
    acceptedSwaps.push(improvement.bestImprovement.swap);
    correctionLog.push({
      iteration,
      scoreAfterSwap: currentScore.totalScore,
      swap: improvement.bestImprovement.swap,
    });
  }

  const issuesAfter = findScheduleIssues(scheduleInputs, assignments);
  const scoreAfter = scoreSchedule(scheduleInputs, assignments);

  return {
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
    },
  };
}

function rebuildRoleResultsWithAssignments(roleResults, assignments) {
  return roleResults.map((roleResult) => ({
    ...roleResult,
    assignments: assignments.filter(
      (assignment) => assignment.jobRole === roleResult.jobRole
    ),
  }));
}

function generateScheduleAlgorithm(scheduleInputs) {
  const roleResults = SCHEDULE_JOB_ROLES.map((roleConfig) =>
    assignRole(scheduleInputs, roleConfig)
  );
  const initialAssignments = roleResults.flatMap(
    (roleResult) => roleResult.assignments
  );
  const improvementResult = improveScheduleWithIterations(
    scheduleInputs,
    initialAssignments
  );
  const allAssignments = improvementResult.assignments;
  const shiftValidationSummaries = buildRoleValidationSummaries(
    scheduleInputs.shifts,
    allAssignments,
    scheduleInputs.employees
  );

  return {
    roleResults: rebuildRoleResultsWithAssignments(roleResults, allAssignments),
    allAssignments,
    shiftValidationSummaries,
    improvementSummary: improvementResult.improvementSummary,
  };
}

module.exports = {
  calculateStrengthScore,
  buildRoleValidationSummaries,
  scoreSchedule,
  findScheduleIssues,
  tryImproveBySameRoleSwaps,
  improveScheduleWithIterations,
  generateScheduleAlgorithm,
};
