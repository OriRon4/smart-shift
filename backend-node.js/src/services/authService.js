const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authRepository = require("../repositories/authRepository");
const env = require("../config/env");
const { createHttpError } = require("../utils/errors");

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRES_IN = "8h";

function buildToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      employeeId: user.employeeId,
      role: user.permissionRole,
    },
    env.jwtSecret,
    {
      expiresIn: JWT_EXPIRES_IN,
    }
  );
}

function sanitizeUser(user) {
  return {
    id: user.id,
    employeeId: user.employeeId,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    permissionRole: user.permissionRole,
    jobRole: user.jobRole,
  };
}

async function login(loginValue, password) {
  if (!loginValue || !password) {
    throw createHttpError(400, "login and password are required");
  }

  const user = await authRepository.findUserByLogin(loginValue);

  if (!user || !user.isActive) {
    throw createHttpError(401, "Invalid login credentials");
  }

  const passwordMatches = await verifyPassword(user, password);

  if (!passwordMatches) {
    throw createHttpError(401, "Invalid login credentials");
  }

  return {
    token: buildToken(user),
    user: sanitizeUser(user),
  };
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(value || "");
}

async function verifyPassword(user, password) {
  if (isBcryptHash(user.passwordHash)) {
    return bcrypt.compare(password, user.passwordHash);
  }

  // Backward-compatible migration path for existing local demo databases.
  if (user.passwordHash === password) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await authRepository.updateUserPasswordHash(user.id, passwordHash);
    return true;
  }

  return false;
}

function normalizeWorkerRegistration(body) {
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const username = String(body.username || email.split("@")[0] || "").trim();
  const password = String(body.password || "").trim();

  if (!fullName) {
    throw createHttpError(400, "fullName is required");
  }

  if (!email || !email.includes("@")) {
    throw createHttpError(400, "A valid email is required");
  }

  if (!username) {
    throw createHttpError(400, "username is required");
  }

  if (password.length < 4) {
    throw createHttpError(400, "password must be at least 4 characters");
  }

  return {
    fullName,
    email,
    username,
    password,
  };
}

async function registerWorker(body) {
  const worker = normalizeWorkerRegistration(body || {});
  const existingUser = await authRepository.findUserByLogin(worker.email);

  if (existingUser) {
    throw createHttpError(409, "A user with this email already exists");
  }

  const existingUsername = await authRepository.findUserByLogin(worker.username);

  if (existingUsername) {
    throw createHttpError(409, "A user with this username already exists");
  }

  const passwordHash = await bcrypt.hash(worker.password, BCRYPT_ROUNDS);
  const user = await authRepository.createWorkerUser({
    ...worker,
    passwordHash,
  });

  return {
    token: buildToken(user),
    user: sanitizeUser(user),
  };
}

async function getUserByToken(token) {
  let payload;

  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw createHttpError(401, "Invalid authentication token");
  }

  const userId = Number(payload.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw createHttpError(401, "Invalid authentication token");
  }

  const user = await authRepository.findUserById(userId);

  if (!user || !user.isActive) {
    throw createHttpError(401, "Invalid authentication token");
  }

  return user;
}

module.exports = {
  login,
  registerWorker,
  getUserByToken,
  sanitizeUser,
};
