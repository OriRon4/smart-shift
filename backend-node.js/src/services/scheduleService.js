const scheduleRepository = require("../repositories/scheduleRepository");

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

  return scheduleRepository.getScheduleInputsByWeek(weekStartDate);
}

function buildPersistedAssignments(employees, assignments) {
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
