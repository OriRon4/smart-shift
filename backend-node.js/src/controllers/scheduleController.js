const scheduleService = require("../services/scheduleService");

async function getSchedule(req, res, next) {
  try {
    // צפייה בסידור מקבלת weekStartDate מה-query.
    const { weekStartDate } = req.query || {};
    // ה-service מביא סידור שמור ומעצב אותו ל-board.
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
    // ה-controller מקבל את השבוע מהבקשה שהגיעה מה-Frontend.
    const { weekStartDate } = req.body || {};

    // מעביר את העבודה העסקית ל-service: יצירת סידור, שמירה ובניית תשובה.
    const generatedSchedule = await scheduleService.generateScheduleForWeek(
      weekStartDate,
      req.user
    );

    // מחזיר ל-Frontend את ה-board החדש שנוצר.
    res.status(201).json(generatedSchedule);
  } catch (error) {
    // כל שגיאה עוברת ל-error middleware המרכזי ב-app.js.
    next(error);
  }
}

async function saveAssignments(req, res, next) {
  try {
    const { weekStartDate, assignments, overrideWarnings } = req.body || {};
    const savedSchedule = await scheduleService.saveScheduleAssignments(
      req.params.scheduleId,
      weekStartDate,
      assignments,
      Boolean(overrideWarnings),
      req.user
    );

    res.status(200).json(savedSchedule);
  } catch (error) {
    next(error);
  }
}

async function validateSchedule(req, res, next) {
  try {
    // בדיקה מקבלת scheduleId מה-URL ואת השיבוצים הנוכחיים מה-body.
    const { weekStartDate, assignments, hasUnsavedChanges } = req.body || {};
    const validationResult = await scheduleService.validateSchedule(
      req.params.scheduleId,
      weekStartDate,
      assignments,
      Boolean(hasUnsavedChanges),
      req.user
    );

    // מחזירים ל-Frontend דוח בדיקה לפתיחת dialog.
    res.status(200).json(validationResult);
  } catch (error) {
    next(error);
  }
}

async function clearScheduleAssignments(req, res, next) {
  try {
    const clearedSchedule = await scheduleService.clearScheduleAssignments(
      req.params.scheduleId,
      req.user
    );

    res.status(200).json(clearedSchedule);
  } catch (error) {
    next(error);
  }
}

async function publishSchedule(req, res, next) {
  try {
    // פרסום עובד לפי scheduleId ומחזיר board מעודכן.
    const publishedSchedule = await scheduleService.publishSchedule(
      req.params.scheduleId,
      req.user
    );

    res.status(200).json(publishedSchedule);
  } catch (error) {
    next(error);
  }
}

async function unpublishSchedule(req, res, next) {
  try {
    // ביטול פרסום מאפס publishedAt ומחזיר board מעודכן.
    const unpublishedSchedule = await scheduleService.unpublishSchedule(
      req.params.scheduleId,
      req.user
    );

    res.status(200).json(unpublishedSchedule);
  } catch (error) {
    next(error);
  }
}

async function updateShiftRequiredStrength(req, res, next) {
  try {
    const { requiredStrengthScore } = req.body || {};
    const updatedSchedule = await scheduleService.updateShiftRequiredStrength(
      req.params.shiftId,
      requiredStrengthScore,
      req.user
    );

    res.status(200).json(updatedSchedule);
  } catch (error) {
    next(error);
  }
}

async function updateShiftRequirements(req, res, next) {
  try {
    const updatedSchedule = await scheduleService.updateShiftRequirements(
      req.params.shiftId,
      req.body || {},
      req.user
    );

    res.status(200).json(updatedSchedule);
  } catch (error) {
    next(error);
  }
}

async function finishShift(req, res, next) {
  try {
    const result = await scheduleService.finishShift(
      req.params.shiftId,
      req.body || {},
      req.user
    );

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function postMissingShiftSlot(req, res, next) {
  try {
    const result = await scheduleService.postMissingShiftSlot(
      req.params.scheduleId,
      req.body || {},
      req.user
    );

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function unpostMissingShiftSlot(req, res, next) {
  try {
    const result = await scheduleService.unpostMissingShiftSlot(
      req.params.scheduleId,
      req.body || {},
      req.user
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getAvailableMissingShiftSlots(req, res, next) {
  try {
    const { weekStartDate } = req.query || {};
    const result = await scheduleService.getAvailableMissingShiftSlots(
      weekStartDate,
      req.user
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function fillMissingShiftSlot(req, res, next) {
  try {
    const result = await scheduleService.fillMissingShiftSlot(
      req.params.slotId,
      req.user
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSchedule,
  generateSchedule,
  saveAssignments,
  validateSchedule,
  clearScheduleAssignments,
  publishSchedule,
  unpublishSchedule,
  updateShiftRequiredStrength,
  updateShiftRequirements,
  finishShift,
  postMissingShiftSlot,
  unpostMissingShiftSlot,
  getAvailableMissingShiftSlots,
  fillMissingShiftSlot,
};
