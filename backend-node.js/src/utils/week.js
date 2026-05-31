function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getWeekRange(weekStartDate) {
  if (!weekStartDate) {
    const error = new Error("weekStartDate is required");
    error.statusCode = 400;
    throw error;
  }

  const startDate = new Date(`${weekStartDate}T00:00:00`);

  if (Number.isNaN(startDate.getTime())) {
    const error = new Error("weekStartDate must be a valid date in YYYY-MM-DD format");
    error.statusCode = 400;
    throw error;
  }

  if (startDate.getDay() !== 0) {
    const error = new Error("weekStartDate must be a Sunday");
    error.statusCode = 400;
    throw error;
  }

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  return {
    weekStartDate: formatDateKey(startDate),
    weekEndDate: formatDateKey(endDate),
  };
}

function getCurrentWeekStartDate(referenceDate = new Date()) {
  const startDate = new Date(referenceDate);
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  return formatDateKey(startDate);
}

function getNextWeekStartDate(referenceDate = new Date()) {
  const currentWeekStartDate = new Date(
    `${getCurrentWeekStartDate(referenceDate)}T00:00:00`
  );
  currentWeekStartDate.setDate(currentWeekStartDate.getDate() + 7);

  return formatDateKey(currentWeekStartDate);
}

module.exports = {
  getWeekRange,
  getCurrentWeekStartDate,
  getNextWeekStartDate,
};
