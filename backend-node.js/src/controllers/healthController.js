const { getEmployeesForTest } = require("../services/scheduleService");

// Confirm that the HTTP server is up without touching the database.
async function getStatus(req, res) {
  res.send("Smart-Shift Server is running");
}

// Verify database access by returning a simple employee query result.
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
