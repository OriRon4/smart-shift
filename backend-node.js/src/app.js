const express = require("express");
const authRoutes = require("./routes/authRoutes");
const availabilityRoutes = require("./routes/availabilityRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const mlRoutes = require("./routes/mlRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");

// app.js הוא שער הכניסה הראשי של שרת Express.
const app = express();

// CORS מאפשר ל-Angular שרץ ב-4200 לקרוא לשרת ב-3000.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:4200");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  // Authorization נדרש כדי שה-JWT יגיע מהלקוח לשרת.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    // דפדפן שולח OPTIONS לפני בקשות מסוימות; כאן מחזירים אישור קצר.
    res.sendStatus(204);
    return;
  }

  next();
});

// מאפשר לקרוא JSON שנשלח מהלקוח דרך req.body.
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/ml", mlRoutes);
// Generate Schedule מגיע לכאן תחת /api/schedules.
app.use("/api/schedules", scheduleRoutes);

// אם אף route לא תפס את הבקשה, מחזירים 404.
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

// שגיאות שנשלחות עם next(error) מגיעות לכאן.
app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    console.error(error);
  }

  const responseBody = {
    message: isServerError
      ? "Internal server error"
      : error.message || "Request failed",
  };

  if (!isServerError && error.details) {
    responseBody.details = error.details;
  }

  res.status(statusCode).json(responseBody);
});

module.exports = app;
