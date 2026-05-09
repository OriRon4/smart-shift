const authService = require("../services/authService");
const { PERMISSION_ROLES } = require("../constants/roles");
const { createHttpError } = require("../utils/errors");

async function requireAuth(req, res, next) {
  try {
    const authorization = req.get("authorization") || "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw createHttpError(401, "Authentication is required");
    }

    req.user = await authService.getUserByToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

function requireManager(req, res, next) {
  if (req.user?.permissionRole !== PERMISSION_ROLES.MANAGER) {
    next(createHttpError(403, "Manager permission is required"));
    return;
  }

  next();
}

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
