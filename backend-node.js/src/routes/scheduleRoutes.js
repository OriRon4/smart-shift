const express = require("express");
const scheduleController = require("../controllers/scheduleController");
const {
  requireAuth,
  requireManager,
  requireManagerOrShiftLeader,
} = require("../middleware/authMiddleware");

// Router מרכז את כל כתובות ה-API של schedules.
const router = express.Router();

// כל route בקובץ הזה דורש משתמש מחובר.
router.use(requireAuth);

// צפייה בסידור: מחזירה board קיים לשבוע לפי weekStartDate.
router.get("/", scheduleController.getSchedule);
// Generate דורש גם הרשאת manager, ואז עובר ל-controller.
router.post("/generate", requireManager, scheduleController.generateSchedule);
// שאר ה-routes הם פעולות נוספות על סידור קיים.
router.patch("/shifts/:shiftId/required-strength", requireManager, scheduleController.updateShiftRequiredStrength);
router.patch("/shifts/:shiftId/requirements", requireManager, scheduleController.updateShiftRequirements);
router.post("/shifts/:shiftId/finish", requireManagerOrShiftLeader, scheduleController.finishShift);
router.patch("/:scheduleId/assignments", requireManagerOrShiftLeader, scheduleController.saveAssignments);
router.delete("/:scheduleId/assignments", requireManager, scheduleController.clearScheduleAssignments);
// פרסום וביטול פרסום דורשים manager ומעדכנים published_at.
router.post("/:scheduleId/publish", requireManager, scheduleController.publishSchedule);
router.delete("/:scheduleId/publish", requireManager, scheduleController.unpublishSchedule);
// בדיקת סידור דורשת manager ומחזירה דוח בעיות/אזהרות.
router.post("/:scheduleId/validate", requireManager, scheduleController.validateSchedule);

module.exports = router;
