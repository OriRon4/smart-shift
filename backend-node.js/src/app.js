const express = require("express");
const scheduleRoutes = require("./routes/scheduleRoutes");

const app = express();

app.use(express.json());

app.use("/api/schedules", scheduleRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    message: error.message || "Internal server error",
    details: error.details,
  });
});

module.exports = app;
