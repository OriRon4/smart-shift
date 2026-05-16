const express = require("express");
const mlController = require("../controllers/mlController");
const {
  requireAuth,
  requireManager,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);
router.use(requireManager);

router.post("/shift-requirements/predict-week", mlController.predictWeek);
router.get("/predictions", mlController.getPredictions);
router.post("/predictions/apply-week", mlController.applyWeek);
router.post("/predictions/:shiftId/apply", mlController.applyPrediction);

module.exports = router;
