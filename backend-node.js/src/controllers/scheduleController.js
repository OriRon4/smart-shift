const scheduleService = require("../services/scheduleService");

async function generateSchedule(req, res, next) {
  try {
    const { weekStartDate } = req.body;
    const schedule = await scheduleService.generateScheduleForWeek(
      weekStartDate
    );

    res.status(200).json(schedule);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generateSchedule,
};
