async function getScheduleInputsByWeek(weekStartDate) {
  const error = new Error(
    "Schedule repository queries are not implemented yet. Step 9 will load employees, shifts, and shift requests."
  );

  error.statusCode = 501;
  error.details = { weekStartDate };

  throw error;
}

module.exports = {
  getScheduleInputsByWeek,
};
