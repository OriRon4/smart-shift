const express = require("express");
const authRoutes = require("./routes/authRoutes");
const availabilityRoutes = require("./routes/availabilityRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:4200");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/employees", employeeRoutes);
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
