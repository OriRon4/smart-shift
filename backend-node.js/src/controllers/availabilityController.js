const availabilityService = require("../services/availabilityService");

async function getMyAvailability(req, res, next) {
  try {
    const { weekStartDate } = req.query || {};
    const availability = await availabilityService.getMyAvailability(
      req.user,
      weekStartDate
    );
    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

async function submitMyAvailability(req, res, next) {
  try {
    const { weekStartDate, shiftIds } = req.body || {};
    const availability = await availabilityService.submitMyAvailability(
      req.user,
      weekStartDate,
      shiftIds
    );
    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

async function getAllAvailability(req, res, next) {
  try {
    const { weekStartDate } = req.query || {};
    const availability = await availabilityService.getAllAvailability(
      weekStartDate
    );
    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMyAvailability,
  submitMyAvailability,
  getAllAvailability,
};
