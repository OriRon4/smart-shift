const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/healthRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", healthRoutes);
app.use("/", scheduleRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res
    .status(error.statusCode || 500)
    .json({ error: error.message || "Internal server error" });
});

module.exports = app;
