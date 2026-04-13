const express = require("express");
const {
  getStatus,
  testDatabaseConnection,
} = require("../controllers/healthController");

const router = express.Router();

router.get("/", getStatus);
router.get("/test-db", testDatabaseConnection);

module.exports = router;
