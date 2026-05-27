const availabilityService = require("../services/availabilityService");

async function getMyAvailability(req, res, next) {
  try {
    // weekStartDate מגיע מה-query; המשתמש מגיע מ-requireAuth.
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
    // body מכיל את השבוע ואת רשימת shiftIds שהעובד סימן.
    const { weekStartDate, shiftIds } = req.body || {};
    // ה-service מחליף את הזמינות הקודמת בזמינות החדשה.
    const availability = await availabilityService.submitMyAvailability(
      req.user,
      weekStartDate,
      shiftIds
    );
    // מחזירים לגריד בצד הלקוח את הזמינות המעודכנת.
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

async function getEmployeeAvailability(req, res, next) {
  try {
    const { weekStartDate } = req.query || {};
    const availability = await availabilityService.getEmployeeAvailability(
      req.params.employeeId,
      weekStartDate,
      req.user
    );

    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

async function updateEmployeeAvailability(req, res, next) {
  try {
    const { weekStartDate, shiftIds } = req.body || {};
    const availability = await availabilityService.updateEmployeeAvailability(
      req.params.employeeId,
      weekStartDate,
      shiftIds,
      req.user
    );

    res.status(200).json(availability);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMyAvailability,
  submitMyAvailability,
  getEmployeeAvailability,
  updateEmployeeAvailability,
  getAllAvailability,
};
