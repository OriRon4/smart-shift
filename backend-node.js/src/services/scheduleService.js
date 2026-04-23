const scheduleRepository = require("../repositories/scheduleRepository");

async function generateScheduleForWeek(weekStartDate) {
  if (!weekStartDate) {
    const error = new Error("weekStartDate is required");
    error.statusCode = 400;
    throw error;
  }

  return scheduleRepository.getScheduleInputsByWeek(weekStartDate);
}

module.exports = {
  generateScheduleForWeek,
};
