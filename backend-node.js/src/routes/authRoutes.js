const express = require("express");
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

// התחברות פתוחה בלי token: מקבלים login/password ומחזירים token.
router.post("/login", authController.login);
// הרשמת עובד חדש גם מחזירה token, אבל המשתמש מתחיל כ-employee.
router.post("/register-worker", authController.registerWorker);
// /me דורש התחברות; requireAuth שם את המשתמש על req.user.
router.get("/me", requireAuth, authController.getCurrentUser);

module.exports = router;
