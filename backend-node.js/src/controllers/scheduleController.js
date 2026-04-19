const {
  generateInitialSchedule,
  getSchedulingData,
} = require("../services/scheduleService");

// Return the current database inputs that the scheduler will use.
async function fetchSchedulingData(req, res, next) {
  try {
    const data = await getSchedulingData();
    res.json(data);
  } catch (error) {
    next(error);
  }
}

// Generate and persist the current week's schedule from database data.
async function generateSchedule(req, res, next) {
  try {
    const result = await generateInitialSchedule();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  fetchSchedulingData,
  generateSchedule,
};
