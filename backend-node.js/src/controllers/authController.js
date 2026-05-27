const authService = require("../services/authService");

async function login(req, res, next) {
  try {
    // ה-controller קורא את פרטי ההתחברות מה-body שהגיע מה-Frontend.
    const { login: loginValue, password } = req.body || {};
    // את בדיקת המשתמש והסיסמה עושה authService.
    const result = await authService.login(loginValue, password);
    // מחזירים token ו-user ל-AuthService בצד הלקוח.
    res.status(200).json(result);
  } catch (error) {
    // שגיאות התחברות עוברות ל-error middleware.
    next(error);
  }
}

async function registerWorker(req, res, next) {
  try {
    const result = await authService.registerWorker(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

function getCurrentUser(req, res) {
  // req.user מגיע מ-requireAuth אחרי בדיקת ה-token.
  res.status(200).json({
    user: authService.sanitizeUser(req.user),
  });
}

module.exports = {
  login,
  registerWorker,
  getCurrentUser,
};
