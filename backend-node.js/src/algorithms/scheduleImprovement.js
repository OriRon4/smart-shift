const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

const SCORE_WEIGHTS = {
  coverageWeight: 1000,
  strengthWeight: 10,
  fairnessWeight: 4,
};

const FAIRNESS_GAP_THRESHOLD = 0.5;
const DEFAULT_MAX_IMPROVEMENT_ITERATIONS = 20;
const MIN_SCORE_IMPROVEMENT = 0.01;

function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function valueOrNull(value) {
  return value === undefined || value === null ? null : value;
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

function calculateTargetShifts(requestedShifts, strengthScore) {
  return toNumber(requestedShifts) * (0.55 + 0.45 * (strengthScore / 10));
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
      comfort: 0,
    };
  }

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
  return new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
}

function buildRequestedShiftCountsByEmployee(shiftRequests) {
  const requestedShiftCountsByEmployee = new Map();

  for (const shiftRequest of shiftRequests) {
    const employeeId = shiftRequest.employee_id;
    const requestedShifts = requestedShiftCountsByEmployee.get(employeeId) || 0;

    requestedShiftCountsByEmployee.set(employeeId, requestedShifts + 1);
  }

  return requestedShiftCountsByEmployee;
}

function buildAssignedShiftCountsByEmployee(assignments) {
  const assignedShiftCountsByEmployee = new Map();

  for (const assignment of assignments) {
    const assignedShifts =
      assignedShiftCountsByEmployee.get(assignment.employeeId) || 0;

    assignedShiftCountsByEmployee.set(assignment.employeeId, assignedShifts + 1);
  }

  return assignedShiftCountsByEmployee;
}

function buildEmployeeById(employees) {
  return new Map(employees.map((employee) => [employee.id, employee]));
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
      const strengthDeficit = strengthRange.hasStrengthTarget
        ? Math.max(0, strengthRange.minimum - summary.actualStrength)
        : 0;
      const targetGap = strengthRange.hasStrengthTarget
        ? Math.max(0, strengthRange.target - summary.actualStrength)
        : 0;
      const strengthSurplus =
        strengthRange.hasStrengthTarget &&
        summary.actualStrength > strengthRange.comfort
          ? summary.actualStrength - strengthRange.comfort
          : 0;
      const isWeak =
        strengthRange.hasStrengthTarget &&
        summary.actualStrength < strengthRange.minimum;
      const hasSurplus = strengthSurplus > 0;

      return {
        shiftId: shift.id,
        jobRole: roleConfig.jobRole,
        requiredCount,
        assignedCount: summary.assignedCount,
        coverageDeficit,
        actualStrength: roundScore(summary.actualStrength),
        requiredStrengthScore: roundScore(requiredStrengthScore),
        strengthRange: {
          hasStrengthTarget: strengthRange.hasStrengthTarget,
          target: roundScore(strengthRange.target),
          margin: roundScore(strengthRange.margin),
          minimum: roundScore(strengthRange.minimum),
          comfort: roundScore(strengthRange.comfort),
        },
        strengthDeficit: roundScore(strengthDeficit),
        targetGap: roundScore(targetGap),
        strengthSurplus: roundScore(strengthSurplus),
        strengthPenalty: roundScore(strengthPenalty),
        isWeak,
        hasSurplus,
      };
    })
  );
}

function buildEmployeeDiagnostics(scheduleInputs, assignments) {
  const employees = scheduleInputs.employees || [];
  const requestedShiftCountsByEmployee = buildRequestedShiftCountsByEmployee(
    scheduleInputs.shiftRequests || []
  );
  const assignedShiftCountsByEmployee =
    buildAssignedShiftCountsByEmployee(assignments);

  return employees.map((employee) => {
    const strengthScore = calculateStrengthScore(employee);
    const requestedShifts = requestedShiftCountsByEmployee.get(employee.id) || 0;
    const assignedShifts = assignedShiftCountsByEmployee.get(employee.id) || 0;
    const targetShifts = calculateTargetShifts(requestedShifts, strengthScore);
    const underTargetGap = Math.max(0, targetShifts - assignedShifts);
    const overTargetGap = Math.max(0, assignedShifts - targetShifts);

    return {
      employeeId: employee.id,
      jobRole: employee.role,
      requestedShifts,
      assignedShifts,
      targetShifts: roundScore(targetShifts),
      underTargetGap: roundScore(underTargetGap),
      overTargetGap: roundScore(overTargetGap),
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
  return roundScore(
    diagnosis.coveragePenalty * weights.coverageWeight +
      diagnosis.strengthPenalty * weights.strengthWeight +
      diagnosis.fairnessPenalty * weights.fairnessWeight
  );
}

function calculateAverage(total, count) {
  return count > 0 ? roundScore(total / count) : 0;
}

function calculateDiagnosisMetrics(shiftRoleDiagnostics, employeeDiagnostics) {
  const strengthDiagnosticsWithTarget = shiftRoleDiagnostics.filter(
    (diagnostic) => diagnostic.strengthRange.hasStrengthTarget
  );
  const strengthGapFromTargetTotal = strengthDiagnosticsWithTarget.reduce(
    (total, diagnostic) =>
      total +
      Math.abs(diagnostic.actualStrength - diagnostic.strengthRange.target),
    0
  );
  const strengthDeficitFromMinimumTotal = strengthDiagnosticsWithTarget.reduce(
    (total, diagnostic) =>
      total +
      Math.max(0, diagnostic.strengthRange.minimum - diagnostic.actualStrength),
    0
  );
  const fairnessGapTotal = employeeDiagnostics.reduce(
    (total, diagnostic) =>
      total +
      Math.abs(diagnostic.assignedShifts - diagnostic.targetShifts),
    0
  );
  const underTargetGapTotal = employeeDiagnostics.reduce(
    (total, diagnostic) => total + diagnostic.underTargetGap,
    0
  );
  const overTargetGapTotal = employeeDiagnostics.reduce(
    (total, diagnostic) => total + diagnostic.overTargetGap,
    0
  );

  return {
    strengthTargetGroupsCount: strengthDiagnosticsWithTarget.length,
    fairnessEmployeesCount: employeeDiagnostics.length,
    averageStrengthGapFromTarget: calculateAverage(
      strengthGapFromTargetTotal,
      strengthDiagnosticsWithTarget.length
    ),
    averageStrengthDeficitFromMinimum: calculateAverage(
      strengthDeficitFromMinimumTotal,
      strengthDiagnosticsWithTarget.length
    ),
    averageFairnessGap: calculateAverage(
      fairnessGapTotal,
      employeeDiagnostics.length
    ),
    averageUnderTargetGap: calculateAverage(
      underTargetGapTotal,
      employeeDiagnostics.length
    ),
    averageOverTargetGap: calculateAverage(
      overTargetGapTotal,
      employeeDiagnostics.length
    ),
  };
}

function diagnoseSchedule(scheduleInputs, assignments) {
  const shiftRoleDiagnostics = buildShiftRoleDiagnostics(
    scheduleInputs,
    assignments
  );
  const employeeDiagnostics = buildEmployeeDiagnostics(
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
  const fairnessPenalty = roundScore(
    employeeDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.fairnessPenalty,
      0
    )
  );

  const diagnosis = {
    shiftRoleDiagnostics,
    employeeDiagnostics,
    coveragePenalty,
    strengthPenalty,
    fairnessPenalty,
    weakShifts: shiftRoleDiagnostics.filter((diagnostic) => diagnostic.isWeak),
    surplusShifts: shiftRoleDiagnostics.filter(
      (diagnostic) => diagnostic.hasSurplus
    ),
    employeesUnderTarget: employeeDiagnostics.filter(
      (diagnostic) => diagnostic.isUnderTarget
    ),
    employeesOverTarget: employeeDiagnostics.filter(
      (diagnostic) => diagnostic.isOverTarget
    ),
    metrics: calculateDiagnosisMetrics(
      shiftRoleDiagnostics,
      employeeDiagnostics
    ),
  };

  diagnosis.totalScore = calculateScheduleScore(diagnosis);

  return diagnosis;
}

function isEmployeeAssignedToShift(assignments, employeeId, shiftId) {
  return assignments.some(
    (assignment) =>
      assignment.employeeId === employeeId && assignment.shiftId === shiftId
  );
}

function findAssignmentForCandidate(assignments, candidate) {
  return assignments.find(
    (assignment) =>
      assignment.shiftId === candidate.shiftId &&
      assignment.employeeId === candidate.removedEmployeeId &&
      assignment.jobRole === candidate.jobRole
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
    surplusAssignment: assignments.find(
      (assignment) =>
        assignment.shiftId === candidate.surplusShiftId &&
        assignment.employeeId === candidate.surplusShiftEmployeeId &&
        assignment.jobRole === candidate.jobRole
    ),
  };
}

function findShiftRoleDiagnostic(diagnosis, shiftId, jobRole) {
  return diagnosis.shiftRoleDiagnostics.find(
    (diagnostic) =>
      diagnostic.shiftId === shiftId && diagnostic.jobRole === jobRole
  );
}

function createsDuplicateAfterSwap(assignments, candidate) {
  return assignments.some((assignment) => {
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
  const removedEmployee = employeeById.get(candidate.removedEmployeeId);
  const addedEmployee = employeeById.get(candidate.addedEmployeeId);

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
  const employeeById = buildEmployeeById(employees);
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const candidates = [];

  for (const overTargetEmployee of diagnosis.employeesOverTarget) {
    const removableAssignments = assignments.filter(
      (assignment) =>
        assignment.employeeId === overTargetEmployee.employeeId &&
        !forcedAssignmentSet.has(getAssignmentKey(assignment))
    );

    for (const assignment of removableAssignments) {
      const underTargetEmployees = diagnosis.employeesUnderTarget.filter(
        (employeeDiagnostic) =>
          employeeDiagnostic.jobRole === assignment.jobRole &&
          employeeDiagnostic.employeeId !== assignment.employeeId
      );

      for (const underTargetEmployee of underTargetEmployees) {
        const addedEmployee = employeeById.get(underTargetEmployee.employeeId);

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
    const surplusShifts = diagnosis.surplusShifts.filter(
      (surplusShift) => surplusShift.jobRole === weakShift.jobRole
    );

    for (const surplusShift of surplusShifts) {
      const surplusAssignments = assignments.filter(
        (assignment) =>
          assignment.shiftId === surplusShift.shiftId &&
          assignment.jobRole === surplusShift.jobRole &&
          !forcedAssignmentSet.has(getAssignmentKey(assignment))
      );

      for (const weakAssignment of weakAssignments) {
        for (const surplusAssignment of surplusAssignments) {
          const weakEmployee = employeeById.get(weakAssignment.employeeId);
          const surplusEmployee = employeeById.get(surplusAssignment.employeeId);
          const weakEmployeeStrength =
            strengthScoreByEmployeeId.get(weakAssignment.employeeId) || 0;
          const surplusEmployeeStrength =
            strengthScoreByEmployeeId.get(surplusAssignment.employeeId) || 0;

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

          const candidate = {
            type: "swap",
            weakShiftId: weakShift.shiftId,
            surplusShiftId: surplusShift.shiftId,
            jobRole: weakShift.jobRole,
            weakShiftEmployeeId: weakAssignment.employeeId,
            surplusShiftEmployeeId: surplusAssignment.employeeId,
            reason: "Swap stronger same-role employee from surplus shift into weak shift.",
          };

          if (createsDuplicateAfterSwap(assignments, candidate)) {
            continue;
          }

          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
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
  const strengthScoreByEmployeeId = buildStrengthScoreByEmployeeId(employees);
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();
  const { weakAssignment, surplusAssignment } = findSwapAssignments(
    assignments,
    candidate
  );

  if (!weakAssignment) {
    reasons.push("Weak shift assignment does not exist.");
  }

  if (!surplusAssignment) {
    reasons.push("Surplus shift assignment does not exist.");
  }

  if (weakAssignment && surplusAssignment) {
    if (weakAssignment.jobRole !== surplusAssignment.jobRole) {
      reasons.push("Swap assignments are not in the same jobRole.");
    }

    if (weakAssignment.shiftId === surplusAssignment.shiftId) {
      reasons.push("Swap assignments must belong to different shifts.");
    }

    if (
      forcedAssignmentSet.has(getAssignmentKey(weakAssignment)) ||
      forcedAssignmentSet.has(getAssignmentKey(surplusAssignment))
    ) {
      reasons.push("Cannot swap a forced assignment.");
    }
  }

  const weakEmployee = employeeById.get(candidate.weakShiftEmployeeId);
  const surplusEmployee = employeeById.get(candidate.surplusShiftEmployeeId);

  if (!weakEmployee || !surplusEmployee) {
    reasons.push("Swap employee does not exist.");
  } else {
    if (!weakEmployee.is_active || !surplusEmployee.is_active) {
      reasons.push("Swap employee is not active.");
    }

    if (
      weakEmployee.role !== candidate.jobRole ||
      surplusEmployee.role !== candidate.jobRole
    ) {
      reasons.push("Swap employee does not match candidate jobRole.");
    }

    const weakEmployeeStrength =
      strengthScoreByEmployeeId.get(candidate.weakShiftEmployeeId) || 0;
    const surplusEmployeeStrength =
      strengthScoreByEmployeeId.get(candidate.surplusShiftEmployeeId) || 0;

    if (surplusEmployeeStrength <= weakEmployeeStrength) {
      reasons.push("Surplus shift employee is not stronger than weak shift employee.");
    }
  }

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

  if (createsDuplicateAfterSwap(assignments, candidate)) {
    reasons.push("Swap would create a duplicate employee assignment.");
  }

  if (!reasons.length) {
    const candidateAssignments = applyCandidate(assignments, candidate);
    const candidateDiagnosis = diagnoseSchedule(
      scheduleInputs,
      candidateAssignments
    );
    const surplusDiagnosticAfter = findShiftRoleDiagnostic(
      candidateDiagnosis,
      candidate.surplusShiftId,
      candidate.jobRole
    );

    if (candidateDiagnosis.coveragePenalty !== diagnosis.coveragePenalty) {
      reasons.push("Swap would change coverage.");
    }

    if (candidateDiagnosis.strengthPenalty > diagnosis.strengthPenalty) {
      reasons.push("Swap would increase strength penalty.");
    }

    if (candidateDiagnosis.fairnessPenalty > diagnosis.fairnessPenalty + 0.5) {
      reasons.push("Swap would significantly worsen fairness.");
    }

    if (candidateDiagnosis.totalScore >= diagnosis.totalScore) {
      reasons.push("Swap would not improve total score.");
    }

    if (
      surplusDiagnosticAfter &&
      surplusDiagnosticAfter.strengthRange.hasStrengthTarget &&
      surplusDiagnosticAfter.actualStrength <
        surplusDiagnosticAfter.strengthRange.minimum
    ) {
      reasons.push("Swap would move the surplus shift below the minimum strength range.");
    }
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
  const employeeById = buildEmployeeById(employees);
  const shiftById = buildShiftById(scheduleInputs.shifts || []);
  const availabilitySet = buildAvailabilitySet(scheduleInputs.shiftRequests || []);
  const forcedAssignmentSet = context.forcedAssignmentSet || new Set();

  if (!candidate || !["replace", "swap"].includes(candidate.type)) {
    reasons.push("Unsupported candidate type.");
    return {
      valid: false,
      reasons,
    };
  }

  if (candidate.type === "swap") {
    return validateSwapCandidate(
      candidate,
      scheduleInputs,
      assignments,
      diagnosis,
      context
    );
  }

  const removedAssignment = findAssignmentForCandidate(assignments, candidate);
  const addedEmployee = employeeById.get(candidate.addedEmployeeId);
  const shift = shiftById.get(candidate.shiftId);

  if (!removedAssignment) {
    reasons.push("Removed assignment does not exist.");
  } else if (forcedAssignmentSet.has(getAssignmentKey(removedAssignment))) {
    reasons.push("Cannot replace a forced assignment.");
  }

  if (!shift) {
    reasons.push("Shift does not exist.");
  }

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

  if (!availabilitySet.has(`${candidate.addedEmployeeId}:${candidate.shiftId}`)) {
    reasons.push("Added employee is not available for the shift.");
  }

  if (
    isEmployeeAssignedToShift(
      assignments,
      candidate.addedEmployeeId,
      candidate.shiftId
    )
  ) {
    reasons.push("Added employee is already assigned to this shift.");
  }

  const diagnostic = findShiftRoleDiagnostic(
    diagnosis,
    candidate.shiftId,
    candidate.jobRole
  );

  if (!diagnostic) {
    reasons.push("Shift role diagnostic does not exist.");
  } else {
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

function applyCandidate(assignments, candidate) {
  if (!candidate || !["replace", "swap"].includes(candidate.type)) {
    return assignments.map((assignment) => ({ ...assignment }));
  }

  if (candidate.type === "swap") {
    return assignments.map((assignment) => {
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
  const validation = validateCandidate(
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

  const candidateAssignments = applyCandidate(assignments, candidate);
  const candidateDiagnosis = diagnoseSchedule(
    scheduleInputs,
    candidateAssignments
  );

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

function buildBestReplaceCandidatePreview(evaluations) {
  const improvingEvaluations = evaluations.filter(
    (evaluation) =>
      evaluation.validation.valid &&
      evaluation.improvesScore &&
      evaluation.improvesFairness
  );

  if (!improvingEvaluations.length) {
    return null;
  }

  return improvingEvaluations
    .slice()
    .sort((leftEvaluation, rightEvaluation) => {
      if (leftEvaluation.scoreAfter !== rightEvaluation.scoreAfter) {
        return leftEvaluation.scoreAfter - rightEvaluation.scoreAfter;
      }

      return (
        leftEvaluation.candidate.shiftId - rightEvaluation.candidate.shiftId
      );
    })[0];
}

function buildBestSwapCandidatePreview(evaluations) {
  const improvingEvaluations = evaluations.filter(
    (evaluation) =>
      evaluation.validation.valid &&
      evaluation.improvesScore &&
      evaluation.improvesStrength
  );

  if (!improvingEvaluations.length) {
    return null;
  }

  return improvingEvaluations
    .slice()
    .sort((leftEvaluation, rightEvaluation) => {
      if (
        leftEvaluation.strengthPenaltyAfter !==
        rightEvaluation.strengthPenaltyAfter
      ) {
        return (
          leftEvaluation.strengthPenaltyAfter -
          rightEvaluation.strengthPenaltyAfter
        );
      }

      if (leftEvaluation.scoreAfter !== rightEvaluation.scoreAfter) {
        return leftEvaluation.scoreAfter - rightEvaluation.scoreAfter;
      }

      return (
        leftEvaluation.candidate.weakShiftId -
        rightEvaluation.candidate.weakShiftId
      );
    })[0];
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

function isAcceptableImprovement(evaluation, currentDiagnosis) {
  if (
    !evaluation.validation.valid ||
    evaluation.scoreAfter === null ||
    currentDiagnosis.totalScore - evaluation.scoreAfter < MIN_SCORE_IMPROVEMENT ||
    evaluation.coveragePenaltyAfter > evaluation.coveragePenaltyBefore
  ) {
    return false;
  }

  if (
    evaluation.candidate.type === "replace" &&
    evaluation.fairnessPenaltyAfter >= evaluation.fairnessPenaltyBefore
  ) {
    return false;
  }

  if (
    evaluation.candidate.type === "swap" &&
    (evaluation.strengthPenaltyAfter >= evaluation.strengthPenaltyBefore ||
      evaluation.fairnessPenaltyAfter > evaluation.fairnessPenaltyBefore + 0.5)
  ) {
    return false;
  }

  return evaluation.scoreAfter < currentDiagnosis.totalScore;
}

function selectBestCandidateEvaluation(
  evaluations,
  currentDiagnosis,
  visitedAssignmentStates
) {
  let repeatedStateCandidatesCount = 0;
  const bestEvaluation =
    evaluations
      .filter((evaluation) => {
        if (!isAcceptableImprovement(evaluation, currentDiagnosis)) {
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

        return leftEvaluation.candidate.type.localeCompare(
          rightEvaluation.candidate.type
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
    averageStrengthGapFromTargetBefore:
      currentDiagnosis.metrics.averageStrengthGapFromTarget,
    averageStrengthGapFromTargetAfter:
      candidateDiagnosis.metrics.averageStrengthGapFromTarget,
    averageStrengthDeficitFromMinimumBefore:
      currentDiagnosis.metrics.averageStrengthDeficitFromMinimum,
    averageStrengthDeficitFromMinimumAfter:
      candidateDiagnosis.metrics.averageStrengthDeficitFromMinimum,
    averageFairnessGapBefore: currentDiagnosis.metrics.averageFairnessGap,
    averageFairnessGapAfter: candidateDiagnosis.metrics.averageFairnessGap,
    averageUnderTargetGapBefore:
      currentDiagnosis.metrics.averageUnderTargetGap,
    averageUnderTargetGapAfter:
      candidateDiagnosis.metrics.averageUnderTargetGap,
    averageOverTargetGapBefore:
      currentDiagnosis.metrics.averageOverTargetGap,
    averageOverTargetGapAfter:
      candidateDiagnosis.metrics.averageOverTargetGap,
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
  replacePreview = {},
  swapPreview = {},
  acceptedChanges = [],
  loopSummary = {}
) {
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
    initialCoveragePenalty: initialDiagnosis.coveragePenalty,
    finalCoveragePenalty: finalDiagnosis.coveragePenalty,
    initialStrengthPenalty: initialDiagnosis.strengthPenalty,
    finalStrengthPenalty: finalDiagnosis.strengthPenalty,
    initialFairnessPenalty: initialDiagnosis.fairnessPenalty,
    finalFairnessPenalty: finalDiagnosis.fairnessPenalty,
    strengthTargetGroupsCount: initialDiagnosis.metrics.strengthTargetGroupsCount,
    fairnessEmployeesCount: initialDiagnosis.metrics.fairnessEmployeesCount,
    initialAverageStrengthGapFromTarget:
      initialDiagnosis.metrics.averageStrengthGapFromTarget,
    finalAverageStrengthGapFromTarget:
      finalDiagnosis.metrics.averageStrengthGapFromTarget,
    initialAverageStrengthDeficitFromMinimum:
      initialDiagnosis.metrics.averageStrengthDeficitFromMinimum,
    finalAverageStrengthDeficitFromMinimum:
      finalDiagnosis.metrics.averageStrengthDeficitFromMinimum,
    initialAverageFairnessGap: initialDiagnosis.metrics.averageFairnessGap,
    finalAverageFairnessGap: finalDiagnosis.metrics.averageFairnessGap,
    initialAverageUnderTargetGap:
      initialDiagnosis.metrics.averageUnderTargetGap,
    finalAverageUnderTargetGap: finalDiagnosis.metrics.averageUnderTargetGap,
    initialAverageOverTargetGap: initialDiagnosis.metrics.averageOverTargetGap,
    finalAverageOverTargetGap: finalDiagnosis.metrics.averageOverTargetGap,
    weakShiftsCount: initialDiagnosis.weakShifts.length,
    surplusShiftsCount: initialDiagnosis.surplusShifts.length,
    employeesUnderTargetCount: initialDiagnosis.employeesUnderTarget.length,
    employeesOverTargetCount: initialDiagnosis.employeesOverTarget.length,
    replaceCandidatesCount: replacePreview.replaceCandidatesCount || 0,
    validReplaceCandidatesCount:
      replacePreview.validReplaceCandidatesCount || 0,
    bestReplaceCandidatePreview:
      replacePreview.bestReplaceCandidatePreview || null,
    bestReplaceCandidateScoreBefore: valueOrNull(
      replacePreview.bestReplaceCandidateScoreBefore
    ),
    bestReplaceCandidateScoreAfter: valueOrNull(
      replacePreview.bestReplaceCandidateScoreAfter
    ),
    swapCandidatesCount: swapPreview.swapCandidatesCount || 0,
    validSwapCandidatesCount: swapPreview.validSwapCandidatesCount || 0,
    bestSwapCandidatePreview: swapPreview.bestSwapCandidatePreview || null,
    bestSwapCandidateScoreBefore: valueOrNull(
      swapPreview.bestSwapCandidateScoreBefore
    ),
    bestSwapCandidateScoreAfter: valueOrNull(
      swapPreview.bestSwapCandidateScoreAfter
    ),
    bestSwapCandidateStrengthPenaltyBefore: valueOrNull(
      swapPreview.bestSwapCandidateStrengthPenaltyBefore
    ),
    bestSwapCandidateStrengthPenaltyAfter: valueOrNull(
      swapPreview.bestSwapCandidateStrengthPenaltyAfter
    ),
    bestSwapCandidateFairnessPenaltyBefore: valueOrNull(
      swapPreview.bestSwapCandidateFairnessPenaltyBefore
    ),
    bestSwapCandidateFairnessPenaltyAfter: valueOrNull(
      swapPreview.bestSwapCandidateFairnessPenaltyAfter
    ),
    bestSwapCandidateCoveragePenaltyBefore: valueOrNull(
      swapPreview.bestSwapCandidateCoveragePenaltyBefore
    ),
    bestSwapCandidateCoveragePenaltyAfter: valueOrNull(
      swapPreview.bestSwapCandidateCoveragePenaltyAfter
    ),
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
  const candidateStats = {
    replaceCandidatesCount: 0,
    validReplaceCandidatesCount: 0,
    bestReplaceCandidatePreview: null,
    bestReplaceCandidateScoreBefore: null,
    bestReplaceCandidateScoreAfter: null,
    swapCandidatesCount: 0,
    validSwapCandidatesCount: 0,
    bestSwapCandidatePreview: null,
    bestSwapCandidateScoreBefore: null,
    bestSwapCandidateScoreAfter: null,
    bestSwapCandidateStrengthPenaltyBefore: null,
    bestSwapCandidateStrengthPenaltyAfter: null,
    bestSwapCandidateFairnessPenaltyBefore: null,
    bestSwapCandidateFairnessPenaltyAfter: null,
    bestSwapCandidateCoveragePenaltyBefore: null,
    bestSwapCandidateCoveragePenaltyAfter: null,
  };
  const acceptedChanges = [];
  const iterationHistory = [];
  const visitedAssignmentStates = new Set([
    buildAssignmentStateSignature(initialAssignments),
  ]);
  let rejectedRepeatedStateCandidatesCount = 0;
  let currentAssignments = initialAssignments;
  let currentDiagnosis = initialDiagnosis;
  let stopReason = maxIterations === 0 ? "max_iterations" : "no_improving_candidate";

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const replaceCandidates = generateReplaceCandidates(
      scheduleInputs,
      currentAssignments,
      currentDiagnosis,
      context
    );
    const swapCandidates = generateSwapCandidates(
      scheduleInputs,
      currentAssignments,
      currentDiagnosis,
      context
    );
    const replaceCandidateEvaluations = replaceCandidates.map((candidate) =>
      evaluateCandidate(
        candidate,
        scheduleInputs,
        currentAssignments,
        currentDiagnosis,
        context
      )
    );
    const swapCandidateEvaluations = swapCandidates.map((candidate) =>
      evaluateCandidate(
        candidate,
        scheduleInputs,
        currentAssignments,
        currentDiagnosis,
        context
      )
    );
    const bestReplaceCandidateEvaluation = buildBestReplaceCandidatePreview(
      replaceCandidateEvaluations
    );
    const bestSwapCandidateEvaluation = buildBestSwapCandidatePreview(
      swapCandidateEvaluations
    );
    const allCandidateEvaluations = [
      ...replaceCandidateEvaluations,
      ...swapCandidateEvaluations,
    ];
    const selectionResult = selectBestCandidateEvaluation(
      allCandidateEvaluations,
      currentDiagnosis,
      visitedAssignmentStates
    );
    const bestCandidateEvaluation = selectionResult.bestEvaluation;
    rejectedRepeatedStateCandidatesCount +=
      selectionResult.repeatedStateCandidatesCount;
    const validReplaceCandidatesCount = replaceCandidateEvaluations.filter(
      (evaluation) => evaluation.validation.valid
    ).length;
    const validSwapCandidatesCount = swapCandidateEvaluations.filter(
      (evaluation) => evaluation.validation.valid
    ).length;
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

    candidateStats.replaceCandidatesCount += replaceCandidates.length;
    candidateStats.validReplaceCandidatesCount +=
      validReplaceCandidatesCount;
    candidateStats.swapCandidatesCount += swapCandidates.length;
    candidateStats.validSwapCandidatesCount += validSwapCandidatesCount;

    if (bestReplaceCandidateEvaluation) {
      candidateStats.bestReplaceCandidatePreview =
        bestReplaceCandidateEvaluation.candidate;
      candidateStats.bestReplaceCandidateScoreBefore =
        bestReplaceCandidateEvaluation.scoreBefore;
      candidateStats.bestReplaceCandidateScoreAfter =
        bestReplaceCandidateEvaluation.scoreAfter;
    }

    if (bestSwapCandidateEvaluation) {
      candidateStats.bestSwapCandidatePreview =
        bestSwapCandidateEvaluation.candidate;
      candidateStats.bestSwapCandidateScoreBefore =
        bestSwapCandidateEvaluation.scoreBefore;
      candidateStats.bestSwapCandidateScoreAfter =
        bestSwapCandidateEvaluation.scoreAfter;
      candidateStats.bestSwapCandidateStrengthPenaltyBefore =
        bestSwapCandidateEvaluation.strengthPenaltyBefore;
      candidateStats.bestSwapCandidateStrengthPenaltyAfter =
        bestSwapCandidateEvaluation.strengthPenaltyAfter;
      candidateStats.bestSwapCandidateFairnessPenaltyBefore =
        bestSwapCandidateEvaluation.fairnessPenaltyBefore;
      candidateStats.bestSwapCandidateFairnessPenaltyAfter =
        bestSwapCandidateEvaluation.fairnessPenaltyAfter;
      candidateStats.bestSwapCandidateCoveragePenaltyBefore =
        bestSwapCandidateEvaluation.coveragePenaltyBefore;
      candidateStats.bestSwapCandidateCoveragePenaltyAfter =
        bestSwapCandidateEvaluation.coveragePenaltyAfter;
    }

    if (!bestCandidateEvaluation) {
      stopReason = "no_improving_candidate";
      break;
    }

    const candidateAssignments =
      bestCandidateEvaluation.assignmentsAfter ||
      applyCandidate(currentAssignments, bestCandidateEvaluation.candidate);
    const candidateDiagnosis =
      bestCandidateEvaluation.diagnosisAfter ||
      diagnoseSchedule(scheduleInputs, candidateAssignments);
    const scoreImprovement =
      currentDiagnosis.totalScore - candidateDiagnosis.totalScore;

    if (scoreImprovement < MIN_SCORE_IMPROVEMENT) {
      stopReason = "min_improvement_threshold";
      break;
    }

    acceptedChanges.push(
      buildAcceptedChange(
        bestCandidateEvaluation,
        currentDiagnosis,
        candidateDiagnosis
      )
    );
    iterationHistory.push(
      buildIterationHistoryEntry(
        iteration,
        bestCandidateEvaluation,
        currentDiagnosis,
        candidateDiagnosis,
        iterationStats
      )
    );
    visitedAssignmentStates.add(
      buildAssignmentStateSignature(candidateAssignments)
    );
    currentAssignments = candidateAssignments;
    currentDiagnosis = candidateDiagnosis;

    if (iteration === maxIterations) {
      stopReason = "max_iterations";
    }
  }

  const improvementSummary = buildImprovementSummary(
    initialDiagnosis,
    currentDiagnosis,
    options.enabled !== false,
    candidateStats,
    candidateStats,
    acceptedChanges,
    {
      maxIterations,
      stopReason,
      rejectedRepeatedStateCandidatesCount,
      iterationHistory,
    }
  );

  return {
    assignments: currentAssignments,
    improvementSummary,
    diagnosis: currentDiagnosis,
  };
}

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
