const { PERMISSION_ROLES, SCHEDULE_JOB_ROLES } = require("../constants/roles");
const { calculateStrengthScore } = require("../algorithms/generateScheduleAlgorithm");

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

function calculateTargetShiftCount(requestedShifts, strengthScore) {
  return roundScore(
    Number(requestedShifts || 0) * (0.55 + 0.45 * (Number(strengthScore || 0) / 10))
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

function getRequiredCount(shift, roleConfig) {
  return Number(shift[roleConfig.requirementField] || 0);
}

function buildAssignedWorkersForRole(
  shiftId,
  jobRole,
  assignmentsByShiftAndRole,
  employeeById,
  assignedShiftCountByEmployee,
  requestedShiftCountByEmployee,
  includeManagerMetrics
) {
  const assignments = assignmentsByShiftAndRole.get(`${shiftId}:${jobRole}`) || [];

  return assignments
    .map((assignment) => {
      const employee = employeeById.get(assignment.employeeId);

      if (!employee) {
        return null;
      }

      const worker = {
        employeeId: employee.id,
        fullName: employee.full_name,
        jobRole: employee.role,
      };

      if (includeManagerMetrics) {
        worker.strengthScore = roundScore(calculateStrengthScore(employee));
        worker.assignedShiftCount =
          assignedShiftCountByEmployee.get(employee.id) || 0;
        worker.requestedShiftCount =
          requestedShiftCountByEmployee.get(employee.id) || 0;
        worker.targetShiftCount = calculateTargetShiftCount(
          worker.requestedShiftCount,
          worker.strengthScore
        );
      }

      return worker;
    })
    .filter(Boolean)
    .sort((leftWorker, rightWorker) =>
      leftWorker.fullName.localeCompare(rightWorker.fullName)
    );
}

function buildScheduleBoardResponse(
  scheduleInputs,
  algorithmResult,
  options = {}
) {
  const includeManagerMetrics =
    options.permissionRole === PERMISSION_ROLES.MANAGER;
  const employeeById = new Map(
    (scheduleInputs.allEmployees || scheduleInputs.employees).map((employee) => [
      employee.id,
      employee,
    ])
  );
  const shiftsByDate = buildItemsByKey(scheduleInputs.shifts, (shift) =>
    formatDateKey(shift.shift_date)
  );
  const assignmentsByShiftAndRole = buildItemsByKey(
    algorithmResult.allAssignments,
    (assignment) => `${assignment.shiftId}:${assignment.jobRole}`
  );
  const validationSummaryByShiftAndRole = new Map(
    algorithmResult.shiftValidationSummaries.map((summary) => [
      `${summary.shiftId}:${summary.jobRole}`,
      summary,
    ])
  );
  const requestedCountByShiftAndRole = buildCountMap(
    scheduleInputs.shiftRequests.filter((shiftRequest) =>
      employeeById.has(shiftRequest.employee_id)
    ),
    (shiftRequest) => {
      const employee = employeeById.get(shiftRequest.employee_id);
      return `${shiftRequest.shift_id}:${employee.role}`;
    }
  );
  const requestedShiftCountByEmployee = buildCountMap(
    scheduleInputs.shiftRequests,
    (shiftRequest) => shiftRequest.employee_id
  );
  const assignedShiftCountByEmployee = buildCountMap(
    algorithmResult.allAssignments,
    (assignment) => assignment.employeeId
  );
  const performanceLogKeys = new Set(
    (scheduleInputs.performanceLogs || []).map(
      (log) => `${log.shiftDate}:${log.shiftType}`
    )
  );

  const days = buildWeekDateKeys(scheduleInputs.weekStartDate).map(
    (dateKey) => {
      const shifts = (shiftsByDate.get(dateKey) || [])
        .slice()
        .sort((leftShift, rightShift) => leftShift.id - rightShift.id)
        .map((shift) => {
          const roleGroups = SCHEDULE_JOB_ROLES.map((roleConfig) => {
            const summary =
              validationSummaryByShiftAndRole.get(
                `${shift.id}:${roleConfig.jobRole}`
              ) || {
                assignedCount: 0,
                assignedStrengthScore: 0,
                requiredStrengthScore: 0,
                meetsStrengthTarget: false,
                uncoveredSlots: getRequiredCount(shift, roleConfig),
              };
            const roleGroup = {
              jobRole: roleConfig.jobRole,
              label: roleConfig.label,
              requiredCount: getRequiredCount(shift, roleConfig),
              assignedCount: Number(summary.assignedCount),
              assignedWorkers: buildAssignedWorkersForRole(
                shift.id,
                roleConfig.jobRole,
                assignmentsByShiftAndRole,
                employeeById,
                assignedShiftCountByEmployee,
                requestedShiftCountByEmployee,
                includeManagerMetrics
              ),
            };

            if (includeManagerMetrics) {
              roleGroup.requestedCount =
                requestedCountByShiftAndRole.get(
                  `${shift.id}:${roleConfig.jobRole}`
                ) || 0;
              roleGroup.uncoveredSlots = Number(summary.uncoveredSlots);
              roleGroup.requiredStrengthScore = roundScore(
                summary.requiredStrengthScore
              );
              roleGroup.assignedStrengthScore = roundScore(
                summary.assignedStrengthScore
              );
              roleGroup.meetsStrengthTarget = Boolean(
                summary.meetsStrengthTarget
              );
            }

            return roleGroup;
          });

          return {
            shiftId: shift.id,
            shiftType: shift.shift_type,
            requiredStrengthScore: roundScore(shift.required_strength_score),
            hasPerformanceFeedback: performanceLogKeys.has(
              `${formatDateKey(shift.shift_date)}:${shift.shift_type}`
            ),
            roleGroups,
          };
        });

      return {
        date: dateKey,
        dayName: formatDayName(dateKey),
        shifts,
      };
    }
  );

  const allRoleGroups = days.flatMap((day) =>
    day.shifts.flatMap((shift) => shift.roleGroups)
  );
  const response = {
    scheduleId: options.scheduleId || null,
    weekStartDate: scheduleInputs.weekStartDate,
    weekEndDate: scheduleInputs.weekEndDate,
    publishedAt: options.publishedAt || null,
    generatedAt: new Date().toISOString(),
    canEdit:
      options.permissionRole === PERMISSION_ROLES.MANAGER ||
      options.permissionRole === PERMISSION_ROLES.SHIFT_LEADER,
    canManage: options.permissionRole === PERMISSION_ROLES.MANAGER,
    days,
  };

  if (algorithmResult.improvementSummary) {
    response.improvementSummary = algorithmResult.improvementSummary;
  }

  if (includeManagerMetrics) {
    response.summary = {
      totalShifts: days.flatMap((day) => day.shifts).length,
      totalRoleRequirements: allRoleGroups.reduce(
        (total, roleGroup) => total + roleGroup.requiredCount,
        0
      ),
      fullyCoveredRoleGroups: allRoleGroups.filter(
        (roleGroup) => roleGroup.uncoveredSlots === 0
      ).length,
      underCoveredRoleGroups: allRoleGroups.filter(
        (roleGroup) => roleGroup.uncoveredSlots > 0
      ).length,
      meetsStrengthTargetRoleGroups: allRoleGroups.filter(
        (roleGroup) => roleGroup.meetsStrengthTarget
      ).length,
      belowStrengthTargetRoleGroups: allRoleGroups.filter(
        (roleGroup) => !roleGroup.meetsStrengthTarget
      ).length,
    };
  }

  return response;
}

module.exports = {
  buildScheduleBoardResponse,
};
