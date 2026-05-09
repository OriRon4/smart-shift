const express = require("express");
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", authController.login);
router.post("/register-worker", authController.registerWorker);
router.get("/me", requireAuth, authController.getCurrentUser);

module.exports = router;
