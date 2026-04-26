const scheduleService = require("../services/scheduleService");

async function generateSchedule(req, res, next) {
  try {
    const { weekStartDate } = req.body || {};
    const generatedSchedule = await scheduleService.generateScheduleForWeek(
      weekStartDate
    );

    res.status(201).json({
      message: "Schedule generated successfully",
      ...generatedSchedule,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generateSchedule,
};
