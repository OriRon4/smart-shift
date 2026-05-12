const express = require("express");
const availabilityController = require("../controllers/availabilityController");
const {
  requireAuth,
  requireManager,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.get("/me", availabilityController.getMyAvailability);
router.post("/me", availabilityController.submitMyAvailability);
router.get("/employees/:employeeId", availabilityController.getEmployeeAvailability);
router.put("/employees/:employeeId", availabilityController.updateEmployeeAvailability);
router.get("/", requireManager, availabilityController.getAllAvailability);

module.exports = router;
