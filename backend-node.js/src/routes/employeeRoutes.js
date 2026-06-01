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
router.delete("/:id", requireManager, employeeController.deleteEmployee);

module.exports = router;
