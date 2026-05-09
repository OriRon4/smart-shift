const authService = require("../services/authService");

async function login(req, res, next) {
  try {
    const { login: loginValue, password } = req.body || {};
    const result = await authService.login(loginValue, password);
    res.status(200).json(result);
  } catch (error) {
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
  res.status(200).json({
    user: authService.sanitizeUser(req.user),
  });
}

module.exports = {
  login,
  registerWorker,
  getCurrentUser,
};
