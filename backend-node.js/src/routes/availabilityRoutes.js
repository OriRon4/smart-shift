const express = require("express");
const availabilityController = require("../controllers/availabilityController");
const {
  requireAuth,
  requireManager,
  requireManagerOrShiftLeader,
} = require("../middleware/authMiddleware");

const router = express.Router();

// כל פעולות הזמינות דורשות משתמש מחובר.
router.use(requireAuth);

// העובד המחובר טוען או שולח את הזמינות של עצמו.
router.get("/me", availabilityController.getMyAvailability);
router.post("/me", availabilityController.submitMyAvailability);
// פעולות על עובד ספציפי מיועדות למנהל או לעובד עצמו לפי בדיקת service.
router.get("/employees/:employeeId", availabilityController.getEmployeeAvailability);
router.put("/employees/:employeeId", availabilityController.updateEmployeeAvailability);
// צפייה בכל הזמינויות דורשת manager או shift leader.
router.get("/", requireManagerOrShiftLeader, availabilityController.getAllAvailability);

module.exports = router;
