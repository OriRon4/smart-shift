const scheduleRepository = require("../repositories/scheduleRepository");
const {
  generateScheduleAlgorithm,
} = require("../algorithms/generateScheduleAlgorithm");
const {
  buildScheduleBoardResponse,
} = require("../formatters/scheduleBoardFormatter");

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

async function generateScheduleForWeek(weekStartDate) {
  if (!weekStartDate) {
    const error = new Error("weekStartDate is required");
    error.statusCode = 400;
    throw error;
  }

  const scheduleInputs = await scheduleRepository.getScheduleInputsByWeek(
    weekStartDate
  );
  // שומרים את תוצאת האלגוריתם פנימית וחושפים רק את מבנה הלוח.
  const algorithmResult = generateScheduleAlgorithm(scheduleInputs);
  await persistGeneratedSchedule(
    scheduleInputs,
    algorithmResult
  );

  return buildScheduleBoardResponse(scheduleInputs, algorithmResult);
}

function buildPersistedAssignments(employees, assignments) {
  // השמירה כוללת את ציון החוזק של כל עובד לצורכי ביקורת.
  // מזהה עובד -> ציון חוזק עובד
  const strengthScoreByEmployeeId = new Map(
    employees.map((employee) => [employee.id, calculateStrengthScore(employee)])
  );

  return assignments.map((assignment) => ({
    shiftId: assignment.shiftId,
    employeeId: assignment.employeeId,
    assignedStrengthScore:
      strengthScoreByEmployeeId.get(assignment.employeeId) || 0,
  }));
}

async function persistGeneratedSchedule(scheduleInputs, algorithmResult) {
  const persistedAssignments = buildPersistedAssignments(
    scheduleInputs.employees,
    algorithmResult.allAssignments
  );

  return scheduleRepository.saveGeneratedSchedule(
    scheduleInputs.weekStartDate,
    persistedAssignments
  );
}

module.exports = {
  generateScheduleForWeek,
  buildPersistedAssignments,
  persistGeneratedSchedule,
};
