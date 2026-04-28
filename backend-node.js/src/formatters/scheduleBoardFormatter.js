function formatDateKey(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function formatDayName(dateKey) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function roundScore(value) {
  return Number(Number(value || 0).toFixed(1));
}

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

function buildCountMap(items, getKey) {
  const countByKey = new Map();

  for (const item of items) {
    const key = getKey(item);
    countByKey.set(key, (countByKey.get(key) || 0) + 1);
  }

  return countByKey;
}

function buildItemsByKey(items, getKey) {
  const itemsByKey = new Map();

  for (const item of items) {
    const key = getKey(item);
    const existingItems = itemsByKey.get(key) || [];
    existingItems.push(item);
    itemsByKey.set(key, existingItems);
  }

  return itemsByKey;
}

function buildWeekDateKeys(weekStartDate) {
  const firstDay = new Date(`${weekStartDate}T00:00:00`);

  return Array.from({ length: 7 }, (_, index) => {
    const currentDay = new Date(firstDay);
    currentDay.setDate(firstDay.getDate() + index);

    return formatDateKey(currentDay);
  });
}

function buildAssignedWorkersForShift(
  shiftId,
  assignmentsByShiftId,
  employeeById,
  assignedShiftCountByEmployee,
  requestedShiftCountByEmployee
) {
  const assignments = assignmentsByShiftId.get(shiftId) || [];

  return assignments
    .map((assignment) => {
      const employee = employeeById.get(assignment.employeeId);

      if (!employee) {
        return null;
      }

      return {
        employeeId: employee.id,
        fullName: employee.full_name,
        role: employee.role,
        strengthScore: roundScore(calculateStrengthScore(employee)),
        assignedShiftCount:
          assignedShiftCountByEmployee.get(employee.id) || 0,
        requestedShiftCount:
          requestedShiftCountByEmployee.get(employee.id) || 0,
      };
    })
    .filter(Boolean)
    .sort((leftWorker, rightWorker) =>
      leftWorker.fullName.localeCompare(rightWorker.fullName)
    );
}

function buildScheduleBoardResponse(scheduleInputs, algorithmResult) {
  const employeeById = new Map(
    scheduleInputs.employees.map((employee) => [employee.id, employee])
  );
  const shiftsByDate = buildItemsByKey(scheduleInputs.shifts, (shift) =>
    formatDateKey(shift.shift_date)
  );
  const assignmentsByShiftId = buildItemsByKey(
    algorithmResult.allAssignments,
    (assignment) => assignment.shiftId
  );
  const validationSummaryByShiftId = new Map(
    algorithmResult.shiftValidationSummaries.map((summary) => [
      summary.shiftId,
      summary,
    ])
  );
  const requestedCountByShiftId = buildCountMap(
    scheduleInputs.shiftRequests,
    (shiftRequest) => shiftRequest.shift_id
  );
  const requestedShiftCountByEmployee = buildCountMap(
    scheduleInputs.shiftRequests,
    (shiftRequest) => shiftRequest.employee_id
  );
  const assignedShiftCountByEmployee = buildCountMap(
    algorithmResult.allAssignments,
    (assignment) => assignment.employeeId
  );

  const days = buildWeekDateKeys(scheduleInputs.weekStartDate).map(
    (dateKey) => {
      const shifts = (shiftsByDate.get(dateKey) || [])
        .slice()
        .sort((leftShift, rightShift) => leftShift.id - rightShift.id)
        .map((shift) => {
          const validationSummary = validationSummaryByShiftId.get(shift.id) || {
            assignedCount: 0,
            assignedStrengthScore: 0,
            meetsStrengthTarget: false,
            uncoveredSlots: Number(shift.required_waiters),
          };

          return {
            shiftId: shift.id,
            shiftType: shift.shift_type,
            requiredWaiters: Number(shift.required_waiters),
            assignedCount: Number(validationSummary.assignedCount),
            requestedCount: requestedCountByShiftId.get(shift.id) || 0,
            uncoveredSlots: Number(validationSummary.uncoveredSlots),
            requiredStrengthScore: roundScore(shift.required_strength_score),
            assignedStrengthScore: roundScore(
              validationSummary.assignedStrengthScore
            ),
            meetsStrengthTarget: Boolean(
              validationSummary.meetsStrengthTarget
            ),
            assignedWorkers: buildAssignedWorkersForShift(
              shift.id,
              assignmentsByShiftId,
              employeeById,
              assignedShiftCountByEmployee,
              requestedShiftCountByEmployee
            ),
          };
        });

      return {
        date: dateKey,
        dayName: formatDayName(dateKey),
        shifts,
      };
    }
  );

  const allShifts = days.flatMap((day) => day.shifts);

  return {
    weekStartDate: scheduleInputs.weekStartDate,
    weekEndDate: scheduleInputs.weekEndDate,
    generatedAt: new Date().toISOString(),
    summary: {
      totalShifts: allShifts.length,
      fullyCoveredShifts: allShifts.filter(
        (shift) => shift.uncoveredSlots === 0
      ).length,
      underCoveredShifts: allShifts.filter(
        (shift) => shift.uncoveredSlots > 0
      ).length,
      meetsStrengthTargetShifts: allShifts.filter(
        (shift) => shift.meetsStrengthTarget
      ).length,
      belowStrengthTargetShifts: allShifts.filter(
        (shift) => !shift.meetsStrengthTarget
      ).length,
    },
    days,
  };
}

module.exports = {
  buildScheduleBoardResponse,
};
