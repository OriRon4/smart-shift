const dotenv = require("dotenv");

dotenv.config();

const port = Number(process.env.PORT || 3000);

const db = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "smart_shift",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
};

module.exports = {
  port,
  db,
};
