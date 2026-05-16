const mlService = require("../services/mlService");

async function predictWeek(req, res, next) {
  try {
    const { weekStartDate } = req.body || {};
    const result = await mlService.predictWeek(weekStartDate);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function getPredictions(req, res, next) {
  try {
    const { weekStartDate } = req.query || {};
    const result = await mlService.getPredictions(weekStartDate);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function applyPrediction(req, res, next) {
  try {
    const result = await mlService.applyPrediction(req.params.shiftId, req.user);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function applyWeek(req, res, next) {
  try {
    const { weekStartDate } = req.body || {};
    const result = await mlService.applyWeek(weekStartDate, req.user);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  predictWeek,
  getPredictions,
  applyPrediction,
  applyWeek,
};
