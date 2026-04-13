const env = {
  port: Number(process.env.PORT || 3001),
  db: {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "smartshift_user",
    password: process.env.DB_PASSWORD || "smartshift_pass",
    database: process.env.DB_NAME || "smartshift",
    port: Number(process.env.DB_PORT || 3306),
  },
};

module.exports = env;
