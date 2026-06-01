const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

const SCORE_WEIGHTS = {
  coverageWeight: 1000,
  strengthWeight: 10,
};

const DEFAULT_MAX_IMPROVEMENT_ITERATIONS = 20;

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (toNumber(seniorityMonths) / 24) * 10);
}

function calculateStrengthScore(employee) {
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
  return toNumber(shift[roleConfig.requirementField]);
}

function getRoleStrengthTarget(shift, roleConfig, requiredCount) {
  if (requiredCount <= 0) {
    return 0;
  }

  return (
    (toNumber(shift.required_strength_score) * requiredCount) /
    Math.max(1, toNumber(shift.required_waiters))
  );
}

function buildStrengthRange(requiredStrengthScore) {
  const target = toNumber(requiredStrengthScore);

  if (target <= 0) {
    return {
      hasStrengthTarget: false,
      target: 0,
      margin: 0,
      minimum: 0,
    };
  }

  const margin = Math.max(2, target * 0.1);

  return {
    hasStrengthTarget: true,
    target,
    margin,
    minimum: Math.max(0, target - margin),
  };
}

function buildStrengthScoreByEmployeeId(employees) {
  return new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
}

function buildEmployeeById(employees) {
  return new Map(employees.map((employee) => [employee.id, employee]));
}

function buildAvailabilitySet(shiftRequests) {
  return new Set(
    shiftRequests.map(
      (shiftRequest) => `${shiftRequest.employee_id}:${shiftRequest.shift_id}`
    )
  );
}

function getAssignmentKey(assignment) {
  return `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`;
}

function buildAssignmentSummaryByShiftRole(assignments, strengthScoreByEmployeeId) {
  const summaryByShiftRole = new Map();

  for (const assignment of assignments) {
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
  if (!strengthRange.hasStrengthTarget) {
    return 0;
  }

  if (actualStrength < strengthRange.minimum) {
    return strengthRange.minimum - actualStrength;
  }

  if (actualStrength < strengthRange.target) {
    return (strengthRange.target - actualStrength) * 0.25;
  }

  return 0;
}

function buildShiftRoleDiagnostics(scheduleInputs, assignments) {
  const employees = scheduleInputs.allEmployees || scheduleInputs.employees || [];
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);
  const summaryByShiftRole = buildAssignmentSummaryByShiftRole(
    assignments,
    strengthScoreByEmployeeId
  );

  return (scheduleInputs.shifts || []).flatMap((shift) =>
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      const requiredCount = getRequiredCount(shift, roleConfig);
      const requiredStrengthScore = getRoleStrengthTarget(
        shift,
        roleConfig,
        requiredCount
      );
      const strengthRange = buildStrengthRange(requiredStrengthScore);
      const key = `${shift.id}:${roleConfig.jobRole}`;
      const summary = summaryByShiftRole.get(key) || {
        assignedCount: 0,
        actualStrength: 0,
      };
      const coverageDeficit = Math.max(0, requiredCount - summary.assignedCount);
      const strengthPenalty = calculateStrengthPenalty(
        summary.actualStrength,
        strengthRange
      );
      const isWeak =
        strengthRange.hasStrengthTarget &&
        summary.actualStrength < strengthRange.minimum;

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
  return roundScore(
    diagnosis.coveragePenalty * weights.coverageWeight +
      diagnosis.strengthPenalty * weights.strengthWeight
  );
}

function diagnoseSchedule(scheduleInputs, assignments) {
  const shiftRoleDiagnostics = buildShiftRoleDiagnostics(
    scheduleInputs,
    assignments
  );
  const coveragePenalty = roundScore(
    shiftRoleDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.coverageDeficit,
      0
    )
  );
  const strengthPenalty = roundScore(
    shiftRoleDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.strengthPenalty,
      0
    )
  );
  const diagnosis = {
    shiftRoleDiagnostics,
    coveragePenalty,
    strengthPenalty,
    weakShifts: shiftRoleDiagnostics.filter((diagnostic) => diagnostic.isWeak),
  };

  diagnosis.totalScore = calculateScheduleScore(diagnosis);

  return diagnosis;
}

function findShiftRoleDiagnostic(diagnosis, shiftId, jobRole) {
  return diagnosis.shiftRoleDiagnostics.find(
    (diagnostic) =>
      diagnostic.shiftId === shiftId && diagnostic.jobRole === jobRole
  );
}

function findSwapAssignments(assignments, candidate) {
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
  return assignments.some((assignment) => {
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

    return (
      (assignment.shiftId === candidate.weakShiftId &&
        assignment.employeeId === candidate.donorShiftEmployeeId) ||
      (assignment.shiftId === candidate.donorShiftId &&
        assignment.employeeId === candidate.weakShiftEmployeeId)
    );
  });
}

function buildAssignmentStateSignature(assignments) {
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
  const employeeById = buildEmployeeById(employees);
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const candidates = [];

  for (const weakShift of diagnosis.weakShifts) {
    const weakAssignments = assignments.filter(
      (assignment) =>
        assignment.shiftId === weakShift.shiftId &&
        assignment.jobRole === weakShift.jobRole &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );
    const donorAssignments = assignments.filter(
      (assignment) =>
        assignment.shiftId !== weakShift.shiftId &&
        assignment.jobRole === weakShift.jobRole &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );

    for (const weakAssignment of weakAssignments) {
      for (const donorAssignment of donorAssignments) {
        const weakEmployee = employeeById.get(weakAssignment.employeeId);
        const donorEmployee = employeeById.get(donorAssignment.employeeId);
        const weakEmployeeStrength =
          strengthScoreByEmployeeId.get(weakAssignment.employeeId) || 0;
        const donorEmployeeStrength =
          strengthScoreByEmployeeId.get(donorAssignment.employeeId) || 0;

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

        const candidate = {
          type: "swap",
          weakShiftId: weakShift.shiftId,
          donorShiftId: donorAssignment.shiftId,
          jobRole: weakShift.jobRole,
          weakShiftEmployeeId: weakAssignment.employeeId,
          donorShiftEmployeeId: donorAssignment.employeeId,
          reason: "Swap stronger same-role employee into weak shift.",
        };

        if (!createsDuplicateAfterSwap(assignments, candidate)) {
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
}

function applySwapCandidate(assignments, candidate) {
  return assignments.map((assignment) => {
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
  const employeeById = buildEmployeeById(employees);
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const { weakAssignment, donorAssignment } = findSwapAssignments(
    assignments,
    candidate
  );

  if (!weakAssignment) {
    reasons.push("Weak shift assignment does not exist.");
  }

  if (!donorAssignment) {
    reasons.push("Donor shift assignment does not exist.");
  }

  if (weakAssignment && donorAssignment) {
    if (weakAssignment.jobRole !== donorAssignment.jobRole) {
      reasons.push("Swap assignments are not in the same jobRole.");
    }

    if (
      forcedAssignmentSet.has(getAssignmentKey(weakAssignment)) ||
      forcedAssignmentSet.has(getAssignmentKey(donorAssignment))
    ) {
      reasons.push("Cannot swap a forced assignment.");
    }
  }

  const weakEmployee = employeeById.get(candidate.weakShiftEmployeeId);
  const donorEmployee = employeeById.get(candidate.donorShiftEmployeeId);

  if (!weakEmployee || !donorEmployee) {
    reasons.push("Swap employee does not exist.");
  } else {
    if (!weakEmployee.is_active || !donorEmployee.is_active) {
      reasons.push("Swap employee is not active.");
    }

    if (
      weakEmployee.role !== candidate.jobRole ||
      donorEmployee.role !== candidate.jobRole
    ) {
      reasons.push("Swap employee does not match candidate jobRole.");
    }
  }

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

  if (createsDuplicateAfterSwap(assignments, candidate)) {
    reasons.push("Swap would create a duplicate employee assignment.");
  }

  if (!reasons.length) {
    const candidateAssignments = applySwapCandidate(assignments, candidate);
    const candidateDiagnosis = diagnoseSchedule(
      scheduleInputs,
      candidateAssignments
    );
    const donorDiagnosticAfter = findShiftRoleDiagnostic(
      candidateDiagnosis,
      candidate.donorShiftId,
      candidate.jobRole
    );

    if (candidateDiagnosis.coveragePenalty > diagnosis.coveragePenalty) {
      reasons.push("Swap would worsen coverage.");
    }

    if (
      donorDiagnosticAfter &&
      donorDiagnosticAfter.strengthRange.hasStrengthTarget &&
      donorDiagnosticAfter.actualStrength <
        donorDiagnosticAfter.strengthRange.minimum
    ) {
      reasons.push("Swap would move the donor shift below the minimum strength range.");
    }

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
  const validation = validateSwapCandidate(
    candidate,
    scheduleInputs,
    assignments,
    diagnosis,
    context
  );

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

  const assignmentsAfter = applySwapCandidate(assignments, candidate);
  const diagnosisAfter = diagnoseSchedule(scheduleInputs, assignmentsAfter);

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

        const candidateSignature = buildAssignmentStateSignature(
          evaluation.assignmentsAfter
        );

        if (visitedAssignmentStates.has(candidateSignature)) {
          repeatedStateCandidatesCount += 1;
          return false;
        }

        return true;
      })
      .sort((leftEvaluation, rightEvaluation) => {
        const leftImprovement =
          currentDiagnosis.totalScore - leftEvaluation.scoreAfter;
        const rightImprovement =
          currentDiagnosis.totalScore - rightEvaluation.scoreAfter;

        if (rightImprovement !== leftImprovement) {
          return rightImprovement - leftImprovement;
        }

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
  const initialDiagnosis = diagnoseSchedule(scheduleInputs, initialAssignments);
  const context = {
    forcedAssignmentSet: options.forcedAssignmentSet || new Set(),
  };
  const maxIterations = Number.isInteger(options.maxIterations)
    ? Math.max(0, options.maxIterations)
    : DEFAULT_MAX_IMPROVEMENT_ITERATIONS;
  const acceptedChanges = [];
  const visitedAssignmentStates = new Set([
    buildAssignmentStateSignature(initialAssignments),
  ]);
  let currentAssignments = initialAssignments;
  let currentDiagnosis = initialDiagnosis;
  let stopReason = maxIterations === 0 ? "max_iterations" : "no_improving_swap";
  let candidatesChecked = 0;
  let validCandidatesCount = 0;
  let rejectedRepeatedStateCandidatesCount = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const candidates = generateSwapCandidates(
      scheduleInputs,
      currentAssignments,
      currentDiagnosis,
      context
    );
    const evaluations = candidates.map((candidate) =>
      evaluateSwapCandidate(
        candidate,
        scheduleInputs,
        currentAssignments,
        currentDiagnosis,
        context
      )
    );
    const selectionResult = selectBestSwapEvaluation(
      evaluations,
      currentDiagnosis,
      visitedAssignmentStates
    );
    const bestEvaluation = selectionResult.bestEvaluation;

    candidatesChecked += candidates.length;
    validCandidatesCount += evaluations.filter(
      (evaluation) => evaluation.validation.valid
    ).length;
    rejectedRepeatedStateCandidatesCount +=
      selectionResult.repeatedStateCandidatesCount;

    if (!bestEvaluation) {
      stopReason = "no_improving_swap";
      break;
    }

    const nextAssignments = bestEvaluation.assignmentsAfter;
    const nextDiagnosis = bestEvaluation.diagnosisAfter;

    acceptedChanges.push(
      buildAcceptedChange(bestEvaluation, currentDiagnosis, nextDiagnosis)
    );
    visitedAssignmentStates.add(buildAssignmentStateSignature(nextAssignments));
    currentAssignments = nextAssignments;
    currentDiagnosis = nextDiagnosis;

    if (iteration === maxIterations) {
      stopReason = "max_iterations";
    }
  }

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

  return {
    assignments: currentAssignments,
    diagnosis: currentDiagnosis,
    improvementSummary,
  };
}

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
