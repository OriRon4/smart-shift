const {
  generateInitialSchedule,
  getSchedulingData,
} = require("../services/scheduleService");

async function fetchSchedulingData(req, res, next) {
  try {
    const data = await getSchedulingData();
    res.json(data);
  } catch (error) {
    next(error);
  }
}

async function generateSchedule(req, res, next) {
  try {
    const result = await generateInitialSchedule(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  fetchSchedulingData,
  generateSchedule,
};
