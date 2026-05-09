const express = require("express");
const scheduleController = require("../controllers/scheduleController");
const {
  requireAuth,
  requireManager,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.get("/", scheduleController.getSchedule);
router.post("/generate", requireManager, scheduleController.generateSchedule);
router.patch("/:scheduleId/assignments", requireManager, scheduleController.saveAssignments);
router.post("/:scheduleId/validate", requireManager, scheduleController.validateSchedule);

module.exports = router;
