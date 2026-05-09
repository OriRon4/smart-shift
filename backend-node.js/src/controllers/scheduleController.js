const scheduleService = require("../services/scheduleService");

async function getSchedule(req, res, next) {
  try {
    const { weekStartDate } = req.query || {};
    const schedule = await scheduleService.getScheduleForWeek(
      weekStartDate,
      req.user
    );

    res.status(200).json(schedule);
  } catch (error) {
    next(error);
  }
}

async function generateSchedule(req, res, next) {
  try {
    const { weekStartDate } = req.body || {};
    const generatedSchedule = await scheduleService.generateScheduleForWeek(
      weekStartDate,
      req.user
    );

    res.status(201).json(generatedSchedule);
  } catch (error) {
    next(error);
  }
}

async function saveAssignments(req, res, next) {
  try {
    const { weekStartDate, assignments } = req.body || {};
    const savedSchedule = await scheduleService.saveScheduleAssignments(
      weekStartDate,
      assignments,
      req.user
    );

    res.status(200).json(savedSchedule);
  } catch (error) {
    next(error);
  }
}

async function validateSchedule(req, res, next) {
  try {
    const { weekStartDate } = req.body || {};
    const validationResult = await scheduleService.validateSchedule(
      weekStartDate,
      req.user
    );

    res.status(200).json(validationResult);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSchedule,
  generateSchedule,
  saveAssignments,
  validateSchedule,
};
