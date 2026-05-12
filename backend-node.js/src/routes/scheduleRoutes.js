const express = require("express");
const scheduleController = require("../controllers/scheduleController");
const {
  requireAuth,
  requireManager,
  requireManagerOrShiftLeader,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.get("/", scheduleController.getSchedule);
router.post("/generate", requireManager, scheduleController.generateSchedule);
router.patch("/:scheduleId/assignments", requireManagerOrShiftLeader, scheduleController.saveAssignments);
router.delete("/:scheduleId/assignments", requireManager, scheduleController.clearScheduleAssignments);
router.post("/:scheduleId/publish", requireManager, scheduleController.publishSchedule);
router.post("/:scheduleId/validate", requireManager, scheduleController.validateSchedule);

module.exports = router;
