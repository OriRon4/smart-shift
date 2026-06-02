const { SCHEDULE_JOB_ROLES } = require("../constants/roles");

// Score weights for local search. Lower totalScore is better; coverage is intentionally not scored here.
const SCORE_WEIGHTS = {
  strengthWeight: 10,
  fairnessWeight: 1,
};
const DEFAULT_MAX_IMPROVEMENT_ITERATIONS = 20;

// Rounds diagnostic values so improvement summaries stay readable and stable.
function roundScore(value) {
  return Number(Number(value || 0).toFixed(2));
}

// Converts missing or invalid DB values into safe numeric values for scoring.
function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

// Checks active status across DB/API employee shapes before using an employee in candidates.
function isEmployeeActive(employee) {
  return Boolean(employee?.is_active ?? employee?.isActive);
}

// Reads the employee role across DB/API shapes so role validation is consistent.
function getEmployeeRole(employee) {
  return employee?.role || employee?.jobRole;
}

// Calculates employee strength used for shift strength scoring and calculated fairness targets.
function calculateStrengthScore(employee = {}) {
  const seniorityMonths = employee.seniority_months ?? employee.seniorityMonths;
  const pressureHandling = employee.pressure_handling ?? employee.pressureHandling;
  const seniorityScore = Math.min(10, (toNumber(seniorityMonths) / 24) * 10);

  return (
    0.35 * toNumber(employee.professionalism) +
    0.3 * toNumber(employee.responsibility) +
    0.2 * toNumber(pressureHandling) +
    0.1 * seniorityScore +
    0.05 * toNumber(employee.potential)
  );
}

// Builds the key used for shift-role lookup tables.
function shiftRoleKey(shiftId, jobRole) {
  return `${shiftId}:${jobRole}`;
}

// Builds the key used to detect whether an employee is already assigned to a shift.
function shiftEmployeeKey(shiftId, employeeId) {
  return `${shiftId}:${employeeId}`;
}

// Builds the key used to check whether an employee requested/available for a shift.
function availabilityKey(employeeId, shiftId) {
  return `${employeeId}:${shiftId}`;
}

// Builds the exact assignment key, also used for forced-assignment protection.
function getAssignmentKey(assignment) {
  return `${assignment.shiftId}:${assignment.employeeId}:${assignment.jobRole}`;
}

// Reads the required employee count for the current role group.
function getRequiredCount(shift, roleConfig) {
  return toNumber(shift[roleConfig.requirementField]);
}

// Splits the shift strength target proportionally for the current role group.
function getRoleStrengthTarget(shift, roleConfig, requiredCount) {
  if (requiredCount <= 0) {
    return 0;
  }

  return (
    (toNumber(shift.required_strength_score) * requiredCount) /
    Math.max(1, toNumber(shift.required_waiters))
  );
}

// Converts a strength target into target/minimum thresholds used for scoring and safety checks.
function buildStrengthRange(requiredStrengthScore) {
  const target = toNumber(requiredStrengthScore);

  if (target <= 0) {
    return { hasStrengthTarget: false, target: 0, margin: 0, minimum: 0 };
  }

  const margin = Math.max(2, target * 0.1);
  return {
    hasStrengthTarget: true,
    target,
    margin,
    minimum: Math.max(0, target - margin),
  };
}

// Penalizes shifts below strength target; below minimum is treated more seriously.
function calculateStrengthPenalty(actualStrength, strengthRange) {
  if (!strengthRange.hasStrengthTarget) {
    return 0;
  }

  if (actualStrength < strengthRange.minimum) {
    return strengthRange.minimum - actualStrength;
  }

  return actualStrength < strengthRange.target
    ? (strengthRange.target - actualStrength) * 0.25
    : 0;
}

// Generic list map helper. Map: key -> value[].
function addToListMap(map, key, value) {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

// Counts items by a derived key. Returned Map: getKey(item) -> count.
function buildCountMap(items, getKey) {
  const countByKey = new Map();

  for (const item of items) {
    const key = getKey(item);
    countByKey.set(key, (countByKey.get(key) || 0) + 1);
  }

  return countByKey;
}

// Builds all lookup structures needed by one local-search iteration.
function buildContext(scheduleInputs, assignments, options = {}) {
  const activeEmployees = scheduleInputs.employees || [];
  const allEmployees = scheduleInputs.allEmployees || activeEmployees;
  const shiftRequests = scheduleInputs.shiftRequests || [];
  // employeeById: employeeId -> employee. Fast lookup for role/activity validation.
  const employeeById = new Map(allEmployees.map((employee) => [employee.id, employee]));
  // strengthByEmployeeId: employeeId -> calculated strength score.
  const strengthByEmployeeId = new Map(
    allEmployees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );
  // assignedCountByEmployeeId: employeeId -> assigned shift count.
  const assignedCountByEmployeeId = buildCountMap(assignments, (assignment) => assignment.employeeId);
  // requestedCountByEmployeeId: employeeId -> requested/available shift count.
  const requestedCountByEmployeeId = buildCountMap(shiftRequests, (request) => request.employee_id);
  // assignmentsByShiftRole: "shiftId:jobRole" -> assignment[].
  const assignmentsByShiftRole = new Map();
  // assignmentsByRole: jobRole -> assignment[].
  const assignmentsByRole = new Map();
  // assignmentByKey: "shiftId:employeeId:jobRole" -> assignment.
  const assignmentByKey = new Map();
  // shiftEmployeeSet: "shiftId:employeeId". Prevents duplicate assignment in the same shift.
  const shiftEmployeeSet = new Set();

  for (const assignment of assignments) {
    // Index current assignments for candidate generation and exact assignment validation.
    addToListMap(assignmentsByShiftRole, shiftRoleKey(assignment.shiftId, assignment.jobRole), assignment);
    addToListMap(assignmentsByRole, assignment.jobRole, assignment);
    assignmentByKey.set(getAssignmentKey(assignment), assignment);
    shiftEmployeeSet.add(shiftEmployeeKey(assignment.shiftId, assignment.employeeId));
  }

  // activeEmployeesByRole: jobRole -> active employee[].
  const activeEmployeesByRole = new Map();
  // fairnessByEmployeeId: employeeId -> fairness data.
  const fairnessByEmployeeId = new Map();

  for (const employee of activeEmployees) {
    if (!isEmployeeActive(employee)) {
      continue;
    }

    const strengthScore = strengthByEmployeeId.get(employee.id) || 0;
    const requestedShifts = requestedCountByEmployeeId.get(employee.id) || 0;
    const assignedShifts = assignedCountByEmployeeId.get(employee.id) || 0;
    // calculatedTargetShifts is derived from availability and strength; it is not a stored employee field.
    const calculatedTargetShifts = requestedShifts * (0.55 + 0.45 * (strengthScore / 10));

    // Store role candidates and fairness state for efficient replace generation.
    addToListMap(activeEmployeesByRole, getEmployeeRole(employee), employee);
    fairnessByEmployeeId.set(employee.id, {
      employeeId: employee.id,
      assignedShifts,
      requestedShifts,
      calculatedTargetShifts,
      isOverTarget: assignedShifts > calculatedTargetShifts,
      isUnderTarget: assignedShifts < calculatedTargetShifts,
    });
  }

  return {
    employeeById,
    strengthByEmployeeId,
    assignedCountByEmployeeId,
    assignmentsByShiftRole,
    assignmentsByRole,
    assignmentByKey,
    activeEmployeesByRole,
    // availabilitySet: "employeeId:shiftId". Confirms an employee can work a target shift.
    availabilitySet: new Set(shiftRequests.map((request) => availabilityKey(request.employee_id, request.shift_id))),
    // forcedAssignmentSet: "shiftId:employeeId:jobRole". Assignments protected from local search.
    forcedAssignmentSet: options.forcedAssignmentSet || new Set(),
    shiftEmployeeSet,
    fairnessByEmployeeId,
  };
}

// Diagnoses each shift-role group so weak shifts can drive swap candidates.
function buildShiftRoleDiagnostics(scheduleInputs, context) {
  return (scheduleInputs.shifts || []).flatMap((shift) =>
    SCHEDULE_JOB_ROLES.map((roleConfig) => {
      const requiredCount = getRequiredCount(shift, roleConfig);
      const strengthRange = buildStrengthRange(
        getRoleStrengthTarget(shift, roleConfig, requiredCount)
      );
      // assignmentsByShiftRole: "shiftId:jobRole" -> assignment[]. Gets workers in this role group.
      const assignedWorkers =
        context.assignmentsByShiftRole.get(shiftRoleKey(shift.id, roleConfig.jobRole)) || [];
      const actualStrength = assignedWorkers.reduce(
        (total, assignment) => total + (context.strengthByEmployeeId.get(assignment.employeeId) || 0),
        0
      );
      const strengthPenalty = calculateStrengthPenalty(actualStrength, strengthRange);

      return {
        shiftId: shift.id,
        jobRole: roleConfig.jobRole,
        requiredCount,
        assignedCount: assignedWorkers.length,
        actualStrength: roundScore(actualStrength),
        strengthRange: {
          hasStrengthTarget: strengthRange.hasStrengthTarget,
          target: roundScore(strengthRange.target),
          minimum: roundScore(strengthRange.minimum),
        },
        strengthPenalty: roundScore(strengthPenalty),
        isWeak: strengthRange.hasStrengthTarget && actualStrength < strengthRange.minimum,
      };
    })
  );
}

// Sums squared gaps from calculatedTargetShifts so large fairness gaps matter more.
function calculateFairnessPenalty(context) {
  let fairnessPenalty = 0;

  for (const fairness of context.fairnessByEmployeeId.values()) {
    const gap = fairness.assignedShifts - fairness.calculatedTargetShifts;
    fairnessPenalty += gap * gap;
  }

  return roundScore(fairnessPenalty);
}

// Combines strength and fairness into the objective minimized by hill climbing.
function calculateScheduleScore(diagnosis, weights = SCORE_WEIGHTS) {
  return roundScore(
    diagnosis.strengthPenalty * weights.strengthWeight +
      diagnosis.fairnessPenalty * weights.fairnessWeight
  );
}

// Scores a concrete schedule state and identifies weak shift-role groups.
function diagnoseSchedule(scheduleInputs, assignments, options = {}) {
  const context = options.employeeById ? options : buildContext(scheduleInputs, assignments, options);
  const shiftRoleDiagnostics = buildShiftRoleDiagnostics(scheduleInputs, context);
  const strengthPenalty = roundScore(
    shiftRoleDiagnostics.reduce((total, diagnostic) => total + diagnostic.strengthPenalty, 0)
  );
  const fairnessPenalty = calculateFairnessPenalty(context);
  const diagnosis = {
    shiftRoleDiagnostics,
    strengthPenalty,
    fairnessPenalty,
    weakShifts: shiftRoleDiagnostics.filter((diagnostic) => diagnostic.isWeak),
  };

  diagnosis.totalScore = calculateScheduleScore(diagnosis);
  return diagnosis;
}

// Finds one diagnostic entry for post-simulation minimum-strength checks.
function findShiftRoleDiagnostic(diagnosis, shiftId, jobRole) {
  return diagnosis.shiftRoleDiagnostics.find(
    (diagnostic) => diagnostic.shiftId === shiftId && diagnostic.jobRole === jobRole
  );
}

// Uses forcedAssignmentSet: "shiftId:employeeId:jobRole" to block protected assignments.
function isForcedAssignment(assignment, context) {
  return assignment && context.forcedAssignmentSet.has(getAssignmentKey(assignment));
}

// Checks whether a simulated candidate leaves a shift-role below minimum strength.
function isBelowMinimum(diagnosis, shiftId, jobRole) {
  const diagnostic = findShiftRoleDiagnostic(diagnosis, shiftId, jobRole);
  return (
    diagnostic &&
    diagnostic.strengthRange.hasStrengthTarget &&
    diagnostic.actualStrength < diagnostic.strengthRange.minimum
  );
}

// Generates swap candidates around weak shift-role groups only.
function generateSwapCandidates(scheduleInputs, assignments, diagnosis, context) {
  const candidates = [];

  for (const weakShift of diagnosis.weakShifts) {
    // assignmentsByShiftRole: "shiftId:jobRole" -> assignment[]. Workers currently in the weak group.
    const weakAssignments =
      context.assignmentsByShiftRole.get(shiftRoleKey(weakShift.shiftId, weakShift.jobRole)) || [];
    // assignmentsByRole: jobRole -> assignment[]. Donors must have the same role.
    const donorAssignments = context.assignmentsByRole.get(weakShift.jobRole) || [];

    for (const weakAssignment of weakAssignments) {
      if (isForcedAssignment(weakAssignment, context)) {
        continue;
      }

      for (const donorAssignment of donorAssignments) {
        const weakStrength = context.strengthByEmployeeId.get(weakAssignment.employeeId) || 0;
        const donorStrength = context.strengthByEmployeeId.get(donorAssignment.employeeId) || 0;

        // Keep candidate generation focused; detailed legality is checked in validateCandidate.
        if (
          donorAssignment.shiftId === weakShift.shiftId ||
          donorAssignment.employeeId === weakAssignment.employeeId ||
          isForcedAssignment(donorAssignment, context) ||
          donorStrength <= weakStrength
        ) {
          continue;
        }

        candidates.push({
          type: "swap",
          jobRole: weakShift.jobRole,
          weakShiftId: weakShift.shiftId,
          donorShiftId: donorAssignment.shiftId,
          weakShiftEmployeeId: weakAssignment.employeeId,
          donorShiftEmployeeId: donorAssignment.employeeId,
        });
      }
    }
  }

  return candidates;
}

// Generates replace candidates from over-target assigned employees to under-target available employees.
function generateReplaceCandidates(scheduleInputs, assignments, diagnosis, context) {
  const candidates = [];

  for (const assignment of assignments) {
    const removedFairness = context.fairnessByEmployeeId.get(assignment.employeeId);

    if (isForcedAssignment(assignment, context) || !removedFairness?.isOverTarget) {
      continue;
    }

    // activeEmployeesByRole: jobRole -> active employee[]. Replacements must keep the same role.
    for (const addedEmployee of context.activeEmployeesByRole.get(assignment.jobRole) || []) {
      const addedFairness = context.fairnessByEmployeeId.get(addedEmployee.id);

      // availabilitySet: "employeeId:shiftId"; shiftEmployeeSet: "shiftId:employeeId".
      if (
        addedEmployee.id === assignment.employeeId ||
        !addedFairness?.isUnderTarget ||
        !context.availabilitySet.has(availabilityKey(addedEmployee.id, assignment.shiftId)) ||
        context.shiftEmployeeSet.has(shiftEmployeeKey(assignment.shiftId, addedEmployee.id))
      ) {
        continue;
      }

      candidates.push({
        type: "replace",
        shiftId: assignment.shiftId,
        jobRole: assignment.jobRole,
        removedEmployeeId: assignment.employeeId,
        addedEmployeeId: addedEmployee.id,
      });
    }
  }

  return candidates;
}

// Simulates the candidate on a copied assignments array without changing the original schedule.
function applyCandidate(assignments, candidate) {
  return assignments.map((assignment) => {
    // Swap: donor employee moves into the weak shift.
    if (
      candidate.type === "swap" &&
      assignment.shiftId === candidate.weakShiftId &&
      assignment.employeeId === candidate.weakShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return { ...assignment, employeeId: candidate.donorShiftEmployeeId };
    }

    // Swap: weak-shift employee moves into the donor shift.
    if (
      candidate.type === "swap" &&
      assignment.shiftId === candidate.donorShiftId &&
      assignment.employeeId === candidate.donorShiftEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return { ...assignment, employeeId: candidate.weakShiftEmployeeId };
    }

    // Replace: only employeeId changes; shift and role remain fixed.
    if (
      candidate.type === "replace" &&
      assignment.shiftId === candidate.shiftId &&
      assignment.employeeId === candidate.removedEmployeeId &&
      assignment.jobRole === candidate.jobRole
    ) {
      return { ...assignment, employeeId: candidate.addedEmployeeId };
    }

    return { ...assignment };
  });
}

// Validates candidate legality before score comparison.
function validateCandidate(candidate, scheduleInputs, assignments, diagnosis, context) {
  const reasons = [];

  if (candidate.type === "swap") {
    // assignmentByKey: "shiftId:employeeId:jobRole" -> assignment. Confirms both swap sides exist.
    const weakAssignment = context.assignmentByKey.get(
      getAssignmentKey({ shiftId: candidate.weakShiftId, employeeId: candidate.weakShiftEmployeeId, jobRole: candidate.jobRole })
    );
    const donorAssignment = context.assignmentByKey.get(
      getAssignmentKey({ shiftId: candidate.donorShiftId, employeeId: candidate.donorShiftEmployeeId, jobRole: candidate.jobRole })
    );
    const weakEmployee = context.employeeById.get(candidate.weakShiftEmployeeId);
    const donorEmployee = context.employeeById.get(candidate.donorShiftEmployeeId);

    // Swap must preserve role, availability, forced assignments, and no duplicate employee per shift.
    if (!weakAssignment || !donorAssignment) reasons.push("Swap assignment does not exist.");
    if (isForcedAssignment(weakAssignment, context) || isForcedAssignment(donorAssignment, context)) reasons.push("Cannot swap a forced assignment.");
    if (!weakEmployee || !donorEmployee || !isEmployeeActive(weakEmployee) || !isEmployeeActive(donorEmployee)) reasons.push("Swap employee is missing or inactive.");
    if (getEmployeeRole(weakEmployee) !== candidate.jobRole || getEmployeeRole(donorEmployee) !== candidate.jobRole) reasons.push("Swap employee role does not match.");
    if (
      !context.availabilitySet.has(availabilityKey(candidate.weakShiftEmployeeId, candidate.donorShiftId)) ||
      !context.availabilitySet.has(availabilityKey(candidate.donorShiftEmployeeId, candidate.weakShiftId))
    ) reasons.push("Swap employee is not available for the target shift.");
    if (
      context.shiftEmployeeSet.has(shiftEmployeeKey(candidate.weakShiftId, candidate.donorShiftEmployeeId)) ||
      context.shiftEmployeeSet.has(shiftEmployeeKey(candidate.donorShiftId, candidate.weakShiftEmployeeId))
    ) reasons.push("Swap would create a duplicate assignment.");
  } else if (candidate.type === "replace") {
    // assignmentByKey: "shiftId:employeeId:jobRole" -> assignment. Confirms removed assignment exists.
    const removedAssignment = context.assignmentByKey.get(
      getAssignmentKey({ shiftId: candidate.shiftId, employeeId: candidate.removedEmployeeId, jobRole: candidate.jobRole })
    );
    const removedEmployee = context.employeeById.get(candidate.removedEmployeeId);
    const addedEmployee = context.employeeById.get(candidate.addedEmployeeId);
    const removedFairness = context.fairnessByEmployeeId.get(candidate.removedEmployeeId);
    const addedFairness = context.fairnessByEmployeeId.get(candidate.addedEmployeeId);

    // Replace must move load from over-target to under-target while preserving legality.
    if (!removedAssignment) reasons.push("Replace assignment does not exist.");
    if (isForcedAssignment(removedAssignment, context)) reasons.push("Cannot replace a forced assignment.");
    if (!removedFairness?.isOverTarget) reasons.push("Removed employee is not over calculated target shifts.");
    if (!addedFairness?.isUnderTarget) reasons.push("Added employee is not under calculated target shifts.");
    if (!removedEmployee || !addedEmployee || !isEmployeeActive(addedEmployee)) reasons.push("Replace employee is missing or inactive.");
    if (getEmployeeRole(removedEmployee) !== candidate.jobRole || getEmployeeRole(addedEmployee) !== candidate.jobRole) reasons.push("Replace employee role does not match.");
    if (!context.availabilitySet.has(availabilityKey(candidate.addedEmployeeId, candidate.shiftId))) reasons.push("Added employee is not available for the shift.");
    if (context.shiftEmployeeSet.has(shiftEmployeeKey(candidate.shiftId, candidate.addedEmployeeId))) reasons.push("Replace would create a duplicate assignment.");
  } else {
    reasons.push("Unknown candidate type.");
  }

  if (reasons.length) {
    return { valid: false, reasons, assignmentsAfter: null, diagnosisAfter: null };
  }

  // Simulate first, then verify the affected shift-role groups stay above minimum strength.
  const assignmentsAfter = applyCandidate(assignments, candidate);
  const contextAfter = buildContext(scheduleInputs, assignmentsAfter, {
    forcedAssignmentSet: context.forcedAssignmentSet,
  });
  const diagnosisAfter = diagnoseSchedule(scheduleInputs, assignmentsAfter, contextAfter);

  if (
    candidate.type === "swap" &&
    (isBelowMinimum(diagnosisAfter, candidate.weakShiftId, candidate.jobRole) ||
      isBelowMinimum(diagnosisAfter, candidate.donorShiftId, candidate.jobRole))
  ) {
    reasons.push("Swap would leave an affected shift below minimum strength.");
  }

  if (
    candidate.type === "replace" &&
    isBelowMinimum(diagnosisAfter, candidate.shiftId, candidate.jobRole)
  ) {
    reasons.push("Replace would leave the shift below minimum strength.");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    assignmentsAfter: reasons.length ? null : assignmentsAfter,
    diagnosisAfter: reasons.length ? null : diagnosisAfter,
  };
}

// Evaluates a legal candidate by simulating it and comparing score before/after.
function evaluateCandidate(candidate, scheduleInputs, assignments, diagnosis, context) {
  const validation = validateCandidate(candidate, scheduleInputs, assignments, diagnosis, context);

  if (!validation.valid) {
    return { candidate, validation, scoreBefore: diagnosis.totalScore, scoreAfter: null, improvement: 0 };
  }

  const diagnosisAfter = validation.diagnosisAfter;
  const improvesTotalScore = diagnosisAfter.totalScore < diagnosis.totalScore;
  const improvesFairness = candidate.type !== "replace" || diagnosisAfter.fairnessPenalty < diagnosis.fairnessPenalty;
  const valid = improvesTotalScore && improvesFairness;

  return {
    candidate,
    validation: {
      ...validation,
      valid,
      reasons: valid ? [] : ["Candidate does not improve the score."],
    },
    scoreBefore: diagnosis.totalScore,
    scoreAfter: diagnosisAfter.totalScore,
    improvement: roundScore(diagnosis.totalScore - diagnosisAfter.totalScore),
    assignmentsAfter: validation.assignmentsAfter,
    diagnosisAfter,
  };
}

// Selects the valid candidate with the largest score improvement for this hill-climbing step.
function selectBestEvaluation(evaluations) {
  return (
    evaluations
      .filter((evaluation) => evaluation.validation.valid && evaluation.improvement > 0)
      .sort((left, right) => {
        if (right.improvement !== left.improvement) {
          return right.improvement - left.improvement;
        }

        return left.candidate.type.localeCompare(right.candidate.type);
      })[0] || null
  );
}

// Builds an explainable record of the accepted local-search move.
function buildAcceptedChange(evaluation, diagnosisBefore) {
  const candidate = evaluation.candidate;
  const diagnosisAfter = evaluation.diagnosisAfter;
  const affectedShiftIds =
    candidate.type === "swap" ? [candidate.weakShiftId, candidate.donorShiftId] : [candidate.shiftId];
  const affectedEmployeeIds =
    candidate.type === "swap"
      ? [candidate.weakShiftEmployeeId, candidate.donorShiftEmployeeId]
      : [candidate.removedEmployeeId, candidate.addedEmployeeId];

  return {
    ...candidate,
    affectedShiftIds,
    affectedEmployeeIds,
    scoreBefore: diagnosisBefore.totalScore,
    scoreAfter: diagnosisAfter.totalScore,
    strengthPenaltyBefore: diagnosisBefore.strengthPenalty,
    strengthPenaltyAfter: diagnosisAfter.strengthPenalty,
    fairnessPenaltyBefore: diagnosisBefore.fairnessPenalty,
    fairnessPenaltyAfter: diagnosisAfter.fairnessPenalty,
  };
}

// Builds the summary returned to the schedule generation flow and frontend.
function buildImprovementSummary(initialDiagnosis, finalDiagnosis, enabled, acceptedChanges, loopSummary) {
  return {
    enabled,
    phase: "local-search-swap-replace",
    maxIterations: loopSummary.maxIterations,
    iterationsRun: loopSummary.iterationsRun,
    stopReason: loopSummary.stopReason,
    acceptedChangesCount: acceptedChanges.length,
    acceptedChanges,
    initialScore: initialDiagnosis.totalScore,
    finalScore: finalDiagnosis.totalScore,
    scoreImprovement: roundScore(initialDiagnosis.totalScore - finalDiagnosis.totalScore),
    initialStrengthPenalty: initialDiagnosis.strengthPenalty,
    finalStrengthPenalty: finalDiagnosis.strengthPenalty,
    initialFairnessPenalty: initialDiagnosis.fairnessPenalty,
    finalFairnessPenalty: finalDiagnosis.fairnessPenalty,
    candidatesChecked: loopSummary.candidatesChecked,
    validCandidatesCount: loopSummary.validCandidatesCount,
  };
}

// Main improvement API: starts from a legal schedule and repeatedly applies the best local improvement.
function runScheduleImprovement(scheduleInputs, initialAssignments, options = {}) {
  const maxIterations = Number.isInteger(options.maxIterations)
    ? Math.max(0, options.maxIterations)
    : DEFAULT_MAX_IMPROVEMENT_ITERATIONS;
  const acceptedChanges = [];
  let currentAssignments = initialAssignments.map((assignment) => ({ ...assignment }));
  let currentContext = buildContext(scheduleInputs, currentAssignments, options);
  const initialDiagnosis = diagnoseSchedule(scheduleInputs, currentAssignments, currentContext);
  let currentDiagnosis = initialDiagnosis;
  let candidatesChecked = 0;
  let validCandidatesCount = 0;
  let iterationsRun = 0;
  let stopReason = maxIterations === 0 ? "max_iterations" : "no_improving_candidate";

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    // Generate both candidate types from the current schedule state.
    const candidates = [
      ...generateSwapCandidates(scheduleInputs, currentAssignments, currentDiagnosis, currentContext),
      ...generateReplaceCandidates(scheduleInputs, currentAssignments, currentDiagnosis, currentContext),
    ];
    // Validate, simulate, and score each candidate before selecting one.
    const evaluations = candidates.map((candidate) =>
      evaluateCandidate(candidate, scheduleInputs, currentAssignments, currentDiagnosis, currentContext)
    );
    const bestEvaluation = selectBestEvaluation(evaluations);

    candidatesChecked += candidates.length;
    validCandidatesCount += evaluations.filter((evaluation) => evaluation.validation.valid).length;

    if (!bestEvaluation) {
      stopReason = "no_improving_candidate";
      break;
    }

    // Apply the best move, rebuild context, and continue from the improved schedule.
    acceptedChanges.push(buildAcceptedChange(bestEvaluation, currentDiagnosis));
    currentAssignments = bestEvaluation.assignmentsAfter;
    currentContext = buildContext(scheduleInputs, currentAssignments, options);
    currentDiagnosis = bestEvaluation.diagnosisAfter;
    iterationsRun = iteration;

    if (iteration === maxIterations) {
      stopReason = "max_iterations";
    }
  }

  return {
    assignments: currentAssignments,
    diagnosis: currentDiagnosis,
    improvementSummary: buildImprovementSummary(
      initialDiagnosis,
      currentDiagnosis,
      options.enabled !== false,
      acceptedChanges,
      { maxIterations, iterationsRun, stopReason, candidatesChecked, validCandidatesCount }
    ),
  };
}

// Public exports used by the generator and by focused algorithm checks.
module.exports = {
  SCORE_WEIGHTS,
  buildStrengthRange,
  calculateStrengthScore,
  diagnoseSchedule,
  calculateScheduleScore,
  generateSwapCandidates,
  generateReplaceCandidates,
  validateCandidate,
  applyCandidate,
  evaluateCandidate,
  runScheduleImprovement,
};
