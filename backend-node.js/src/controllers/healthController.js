const { getEmployeesForTest } = require("../services/scheduleService");

async function getStatus(req, res) {
  res.send("Smart-Shift Server is running");
}

async function testDatabaseConnection(req, res, next) {
  try {
    const rows = await getEmployeesForTest();
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStatus,
  testDatabaseConnection,
};
