const { calculateWorkerStrength } = require("../utils/strength");

const SHIFT_TYPE_PRIORITY = {
  evening: 2,
  morning: 1,
};

function roundToTwoDecimals(value) {
  return Number(value.toFixed(2));
}

function applyCriticalAttributePenalty(employee, baseStrength) {
  let adjustedStrength = baseStrength;
  const penalties = [];

  // In the current schema, responsibility is the closest proxy to reliability.
  if (Number(employee.responsibility || 0) <= 3) {
    adjustedStrength -= 1.5;
    penalties.push("low_responsibility");
  }

  return {
    adjustedStrength: roundToTwoDecimals(Math.max(0, adjustedStrength)),
    penalties,
  };
}

function buildRequestLookup(requests) {
  const requestLookup = new Map();
  const requestedShiftCounts = new Map();

  for (const request of requests) {
    if (!requestLookup.has(request.shift_id)) {
      requestLookup.set(request.shift_id, new Set());
    }

    requestLookup.get(request.shift_id).add(request.employee_id);
    requestedShiftCounts.set(
      request.employee_id,
      (requestedShiftCounts.get(request.employee_id) || 0) + 1
    );
  }

  return {
    requestLookup,
    requestedShiftCounts,
  };
}

function enrichEmployees(employees, requestedShiftCounts) {
  return employees.map((employee) => {
    const baseStrength = calculateWorkerStrength(employee);
    const { adjustedStrength, penalties } = applyCriticalAttributePenalty(
      employee,
      baseStrength
    );

    return {
      ...employee,
      baseStrength,
      adjustedStrength,
      penalties,
      assignedCount: 0,
      requestedCount: requestedShiftCounts.get(employee.id) || 0,
    };
  });
}

function sortShiftsByPriority(shifts, requestLookup) {
  return [...shifts].sort((leftShift, rightShift) => {
    const leftAvailableCount = requestLookup.get(leftShift.id)?.size || 0;
    const rightAvailableCount = requestLookup.get(rightShift.id)?.size || 0;
    const leftShortageRisk = Math.max(
      0,
      leftShift.required_waiters - leftAvailableCount
    );
    const rightShortageRisk = Math.max(
      0,
      rightShift.required_waiters - rightAvailableCount
    );

    if (rightShortageRisk !== leftShortageRisk) {
      return rightShortageRisk - leftShortageRisk;
    }

    if (rightShift.required_waiters !== leftShift.required_waiters) {
      return rightShift.required_waiters - leftShift.required_waiters;
    }

    const rightShiftTypePriority =
      SHIFT_TYPE_PRIORITY[rightShift.shift_type] || 0;
    const leftShiftTypePriority = SHIFT_TYPE_PRIORITY[leftShift.shift_type] || 0;

    if (rightShiftTypePriority !== leftShiftTypePriority) {
      return rightShiftTypePriority - leftShiftTypePriority;
    }

    const leftDate = new Date(leftShift.shift_date).getTime();
    const rightDate = new Date(rightShift.shift_date).getTime();

    return leftDate - rightDate;
  });
}

function sortEmployeesForShift(leftEmployee, rightEmployee) {
  if (rightEmployee.adjustedStrength !== leftEmployee.adjustedStrength) {
    return rightEmployee.adjustedStrength - leftEmployee.adjustedStrength;
  }

  if (leftEmployee.assignedCount !== rightEmployee.assignedCount) {
    return leftEmployee.assignedCount - rightEmployee.assignedCount;
  }

  if (rightEmployee.requestedCount !== leftEmployee.requestedCount) {
    return rightEmployee.requestedCount - leftEmployee.requestedCount;
  }

  return leftEmployee.id - rightEmployee.id;
}

function buildInitialAssignments(shifts, employees, requestLookup) {
  const assignmentsByShift = new Map();
  const employeesById = new Map(
    employees.map((employee) => [employee.id, employee])
  );

  for (const shift of shifts) {
    const availableIds = requestLookup.get(shift.id) || new Set();
    const availableEmployees = employees
      .filter((employee) => availableIds.has(employee.id))
      .sort(sortEmployeesForShift);

    const selectedEmployees = availableEmployees.slice(0, shift.required_waiters);
    const shiftAssignments = [];

    for (const employee of selectedEmployees) {
      employee.assignedCount += 1;
      shiftAssignments.push(employee.id);
    }

    assignmentsByShift.set(shift.id, shiftAssignments);
  }

  return {
    assignmentsByShift,
    employeesById,
  };
}

function calculateFairnessScore(employees) {
  const requestedEmployees = employees.filter(
    (employee) => employee.requestedCount > 0
  );

  if (requestedEmployees.length === 0) {
    return 100;
  }

  const totalRequested = requestedEmployees.reduce(
    (sum, employee) => sum + employee.requestedCount,
    0
  );
  const totalAssigned = requestedEmployees.reduce(
    (sum, employee) => sum + employee.assignedCount,
    0
  );
  const targetFulfillmentRatio =
    totalRequested === 0 ? 0 : totalAssigned / totalRequested;

  const employeeScores = requestedEmployees.map((employee) => {
    const targetAssignments = employee.requestedCount * targetFulfillmentRatio;
    const fairnessGap = Math.abs(employee.assignedCount - targetAssignments);
    const normalizedGap = fairnessGap / Math.max(1, employee.requestedCount);

    return Math.max(0, 100 - normalizedGap * 100);
  });

  const averageScore =
    employeeScores.reduce((sum, score) => sum + score, 0) /
    employeeScores.length;

  return roundToTwoDecimals(averageScore);
}

function buildShiftSummaries(shifts, assignmentsByShift, employeesById) {
  return shifts.map((shift) => {
    const assignmentIds = assignmentsByShift.get(shift.id) || [];
    const assignedEmployees = assignmentIds
      .map((employeeId) => employeesById.get(employeeId))
      .filter(Boolean);
    const assignedCount = assignedEmployees.length;
    const totalShiftStrength = assignedEmployees.reduce(
      (sum, employee) => sum + employee.adjustedStrength,
      0
    );
    const averageStrength =
      assignedCount === 0 ? 0 : totalShiftStrength / assignedCount;
    const uncoveredSlots = Math.max(0, shift.required_waiters - assignedCount);
    const uniqueEmployeeCount = new Set(assignmentIds).size;
    const isFullyCovered = assignedCount === shift.required_waiters;
    const isValid = isFullyCovered && uniqueEmployeeCount === assignedCount;

    return {
      shiftId: shift.id,
      shiftDate: shift.shift_date,
      shiftType: shift.shift_type,
      requiredWaiters: shift.required_waiters,
      assignedCount,
      uncoveredSlots,
      isFullyCovered,
      isValid,
      averageStrength: roundToTwoDecimals(averageStrength),
      assignedEmployees: assignedEmployees.map((employee) => ({
        employeeId: employee.id,
        fullName: employee.full_name,
        baseStrength: employee.baseStrength,
        adjustedStrength: employee.adjustedStrength,
      })),
    };
  });
}

function evaluateSchedule(shifts, employees, assignmentsByShift) {
  const employeesById = new Map(
    employees.map((employee) => [employee.id, employee])
  );
  const shiftSummaries = buildShiftSummaries(
    shifts,
    assignmentsByShift,
    employeesById
  );
  const totalRequiredAssignments = shifts.reduce(
    (sum, shift) => sum + shift.required_waiters,
    0
  );
  const totalAssignments = shiftSummaries.reduce(
    (sum, shiftSummary) => sum + shiftSummary.assignedCount,
    0
  );
  const coveredShifts = shiftSummaries.filter(
    (shiftSummary) => shiftSummary.isFullyCovered
  ).length;
  const validShifts = shiftSummaries.filter(
    (shiftSummary) => shiftSummary.isValid
  ).length;
  const shiftStrengthScore =
    shifts.length === 0
      ? 0
      : shiftSummaries.reduce((sum, shiftSummary) => {
          const maxShiftStrength = shiftSummary.requiredWaiters * 10;
          const shiftStrength = shiftSummary.assignedEmployees.reduce(
            (strengthSum, employee) => strengthSum + employee.adjustedStrength,
            0
          );

          return sum + (shiftStrength / Math.max(1, maxShiftStrength)) * 100;
        }, 0) / shifts.length;
  const fairnessScore = calculateFairnessScore(employees);
  const coverageScore =
    totalRequiredAssignments === 0
      ? 0
      : (totalAssignments / totalRequiredAssignments) * 100;
  const validityScore =
    shifts.length === 0 ? 0 : (validShifts / shifts.length) * 100;
  const totalScore =
    coverageScore * 0.45 +
    validityScore * 0.25 +
    shiftStrengthScore * 0.2 +
    fairnessScore * 0.1;

  return {
    totalScore: roundToTwoDecimals(totalScore),
    scoreBreakdown: {
      coverageScore: roundToTwoDecimals(coverageScore),
      validityScore: roundToTwoDecimals(validityScore),
      shiftStrengthScore: roundToTwoDecimals(shiftStrengthScore),
      fairnessScore,
    },
    summary: {
      totalShifts: shifts.length,
      coveredShifts,
      uncoveredShifts: shifts.length - coveredShifts,
      validShifts,
      totalRequiredAssignments,
      totalAssignments,
    },
    shiftSummaries,
  };
}

function updateEmployeeAssignmentCounts(
  employeesById,
  removedEmployeeId,
  addedEmployeeId
) {
  const removedEmployee = employeesById.get(removedEmployeeId);
  const addedEmployee = employeesById.get(addedEmployeeId);

  removedEmployee.assignedCount -= 1;
  addedEmployee.assignedCount += 1;
}

function improveSchedule(shifts, employeesById, assignmentsByShift, requestLookup) {
  let bestEvaluation = evaluateSchedule(
    shifts,
    Array.from(employeesById.values()),
    assignmentsByShift
  );
  let improved = true;
  let improvementPasses = 0;

  while (improved && improvementPasses < 3) {
    improved = false;
    improvementPasses += 1;

    for (const shift of shifts) {
      const currentAssignments = assignmentsByShift.get(shift.id) || [];
      const availableIds = requestLookup.get(shift.id) || new Set();

      for (const currentEmployeeId of [...currentAssignments]) {
        const candidateIds = [...availableIds].filter(
          (candidateId) => !currentAssignments.includes(candidateId)
        );

        for (const candidateId of candidateIds) {
          const assignmentIndex = currentAssignments.indexOf(currentEmployeeId);

          currentAssignments[assignmentIndex] = candidateId;
          updateEmployeeAssignmentCounts(
            employeesById,
            currentEmployeeId,
            candidateId
          );

          const candidateEvaluation = evaluateSchedule(
            shifts,
            Array.from(employeesById.values()),
            assignmentsByShift
          );

          if (candidateEvaluation.totalScore > bestEvaluation.totalScore) {
            bestEvaluation = candidateEvaluation;
            improved = true;
            break;
          }

          currentAssignments[assignmentIndex] = currentEmployeeId;
          updateEmployeeAssignmentCounts(
            employeesById,
            candidateId,
            currentEmployeeId
          );
        }

        if (improved) {
          break;
        }
      }

      if (improved) {
        break;
      }
    }
  }

  return {
    evaluation: bestEvaluation,
    improvementPasses,
  };
}

function getWeekStartDate(shifts) {
  if (shifts.length === 0) {
    return null;
  }

  return [...shifts]
    .map((shift) => shift.shift_date)
    .sort((leftDate, rightDate) => new Date(leftDate) - new Date(rightDate))[0];
}

function buildPersistedAssignments(assignmentsByShift, employeesById, scheduleId) {
  const rows = [];

  for (const [shiftId, employeeIds] of assignmentsByShift.entries()) {
    for (const employeeId of employeeIds) {
      const employee = employeesById.get(employeeId);

      rows.push([
        scheduleId,
        shiftId,
        employeeId,
        employee.adjustedStrength,
      ]);
    }
  }

  return rows;
}

function buildEmployeeStats(employees) {
  return employees
    .map((employee) => ({
      employeeId: employee.id,
      fullName: employee.full_name,
      baseStrength: employee.baseStrength,
      adjustedStrength: employee.adjustedStrength,
      requestedCount: employee.requestedCount,
      assignedCount: employee.assignedCount,
      penalties: employee.penalties,
    }))
    .sort((leftEmployee, rightEmployee) => {
      if (rightEmployee.assignedCount !== leftEmployee.assignedCount) {
        return rightEmployee.assignedCount - leftEmployee.assignedCount;
      }

      return rightEmployee.adjustedStrength - leftEmployee.adjustedStrength;
    });
}

function generateScheduleDraft(employees, shifts, requests) {
  const { requestLookup, requestedShiftCounts } = buildRequestLookup(requests);
  const enrichedEmployees = enrichEmployees(employees, requestedShiftCounts);
  const prioritizedShifts = sortShiftsByPriority(shifts, requestLookup);
  const { assignmentsByShift, employeesById } = buildInitialAssignments(
    prioritizedShifts,
    enrichedEmployees,
    requestLookup
  );
  const { improvementPasses } = improveSchedule(
    prioritizedShifts,
    employeesById,
    assignmentsByShift,
    requestLookup
  );
  const orderedEvaluation = evaluateSchedule(
    shifts,
    Array.from(employeesById.values()),
    assignmentsByShift
  );

  return {
    weekStartDate: getWeekStartDate(shifts),
    assignmentsByShift,
    employeesById,
    evaluation: orderedEvaluation,
    improvementPasses,
    employeeStats: buildEmployeeStats(Array.from(employeesById.values())),
  };
}

module.exports = {
  buildPersistedAssignments,
  generateScheduleDraft,
};
