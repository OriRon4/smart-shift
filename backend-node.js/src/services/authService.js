const authRepository = require("../repositories/authRepository");
const { createHttpError } = require("../utils/errors");

function buildMockToken(userId) {
  return `mock-token-${userId}`;
}

function parseMockToken(token) {
  const match = /^mock-token-(\d+)$/.exec(token || "");
  return match ? Number(match[1]) : null;
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

  if (!user || !user.isActive || user.passwordHash !== password) {
    throw createHttpError(401, "Invalid login credentials");
  }

  return {
    token: buildMockToken(user.id),
    user: sanitizeUser(user),
  };
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

  const user = await authRepository.createWorkerUser(worker);

  return {
    token: buildMockToken(user.id),
    user: sanitizeUser(user),
  };
}

async function getUserByToken(token) {
  const userId = parseMockToken(token);

  if (!userId) {
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
