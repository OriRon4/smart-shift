const express = require("express");
const employeeController = require("../controllers/employeeController");
const {
  requireAuth,
  requireManager,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.get("/", employeeController.getEmployees);
router.get("/:id", employeeController.getEmployeeById);
router.patch("/:id", requireManager, employeeController.updateEmployee);
router.patch("/:id/deactivate", requireManager, employeeController.deactivateEmployee);

module.exports = router;
