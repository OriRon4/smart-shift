function buildDateOnly(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function isSameDateParts(date, year, month, day) {
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) {
    throw new Error("weekStartDate must use YYYY-MM-DD format");
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const date = buildDateOnly(year, month, day);

  if (!isSameDateParts(date, year, month, day)) {
    throw new Error("weekStartDate must be a real calendar date");
  }

  return date;
}

function addUtcDays(date, days) {
  const nextDate = new Date(date.getTime());
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function normalizeToWeekStart(dateString) {
  const date = parseDateOnly(dateString);
  const utcDay = date.getUTCDay();
  const daysFromMonday = utcDay === 0 ? 6 : utcDay - 1;

  return formatDateOnly(addUtcDays(date, -daysFromMonday));
}

function buildWeekWindow(weekStartDate) {
  const normalizedWeekStart = normalizeToWeekStart(weekStartDate);
  const startDate = parseDateOnly(normalizedWeekStart);
  const endExclusive = formatDateOnly(addUtcDays(startDate, 7));

  return {
    weekStartDate: normalizedWeekStart,
    weekEndExclusive: endExclusive,
  };
}

module.exports = {
  buildWeekWindow,
  formatDateOnly,
  normalizeToWeekStart,
  parseDateOnly,
};
