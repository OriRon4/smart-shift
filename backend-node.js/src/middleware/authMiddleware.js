const authService = require("../services/authService");
const { PERMISSION_ROLES } = require("../constants/roles");
const { createHttpError } = require("../utils/errors");

// מזהה את המשתמש לפי ה-token שנשלח בכותרת Authorization.
async function requireAuth(req, res, next) {
  try {
    // מצפים לפורמט: Authorization: Bearer <token>
    const authorization = req.get("authorization") || "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      // 401 = אין התחברות תקינה.
      throw createHttpError(401, "Authentication is required");
    }

    // מפענחים את ה-token ומביאים את המשתמש מה-DB.
    req.user = await authService.getUserByToken(token);
    // שומרים את המשתמש על req כדי שה-middlewares הבאים וה-controller יוכלו להשתמש בו.
    next();
  } catch (error) {
    // שגיאות אימות עוברות ל-error middleware.
    next(error);
  }
}

// בודק שלמשתמש המאומת יש הרשאת manager.
function requireManager(req, res, next) {
  if (req.user?.permissionRole !== PERMISSION_ROLES.MANAGER) {
    // 403 = מחובר, אבל אין הרשאה מתאימה.
    next(createHttpError(403, "Manager permission is required"));
    return;
  }

  next();
}

// משמש לפעולות שמותרות למנהל או לאחראי משמרת.
function requireManagerOrShiftLeader(req, res, next) {
  const permissionRole = req.user?.permissionRole;

  if (
    permissionRole !== PERMISSION_ROLES.MANAGER &&
    permissionRole !== PERMISSION_ROLES.SHIFT_LEADER
  ) {
    next(createHttpError(403, "Manager or shift manager permission is required"));
    return;
  }

  next();
}

module.exports = {
  requireAuth,
  requireManager,
  requireManagerOrShiftLeader,
};
