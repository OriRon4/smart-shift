const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/healthRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", healthRoutes);
app.use("/", scheduleRoutes);

// Return a JSON 404 response when no API route matches the request.
function handleNotFound(req, res) {
  res.status(404).json({ error: "Route not found" });
}

// Return a JSON 500 response for unexpected backend errors.
function handleServerError(error, req, res, next) {
  console.error(error);
  res.status(500).json({ error: error.message || "Internal server error" });
}

app.use(handleNotFound);
app.use(handleServerError);

module.exports = app;
