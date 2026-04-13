const mysql = require("mysql2/promise");
const env = require("./env");

async function createDbConnection() {
  return mysql.createConnection(env.db);
}

module.exports = {
  createDbConnection,
};
