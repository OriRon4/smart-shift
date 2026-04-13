const express = require("express");
const {
  fetchSchedulingData,
  generateSchedule,
} = require("../controllers/scheduleController");

const router = express.Router();

router.get("/data-for-scheduling", fetchSchedulingData);
router.post("/generate-schedule", generateSchedule);

module.exports = router;
