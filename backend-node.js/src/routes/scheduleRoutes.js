const express = require("express");
const scheduleController = require("../controllers/scheduleController");

const router = express.Router();

router.post("/generate", scheduleController.generateSchedule);

module.exports = router;
