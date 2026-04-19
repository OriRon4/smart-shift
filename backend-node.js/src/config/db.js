const mysql = require("mysql2/promise");
const env = require("./env");

// Create a promise-based MySQL connection using the current environment settings.
async function createDbConnection() {
  return mysql.createConnection(env.db);
}

module.exports = {
  createDbConnection,
};
