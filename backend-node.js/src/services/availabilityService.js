const availabilityRepository = require("../repositories/availabilityRepository");
const employeeRepository = require("../repositories/employeeRepository");
const { PERMISSION_ROLES, SCHEDULE_JOB_ROLES } = require("../constants/roles");
const { createHttpError } = require("../utils/errors");

function formatDateKey(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function formatDayName(dateKey) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function buildAvailabilityGrid(shifts, selectedShiftIds = []) {
  const selectedShiftIdSet = new Set(selectedShiftIds);
  const shiftsByDate = new Map();

  for (const shift of shifts) {
    const dateKey = formatDateKey(shift.shift_date);
    const existingShifts = shiftsByDate.get(dateKey) || [];
    existingShifts.push({
      shiftId: shift.id,
      shiftType: shift.shift_type,
      selected: selectedShiftIdSet.has(shift.id),
    });
    shiftsByDate.set(dateKey, existingShifts);
  }

  return [...shiftsByDate.entries()].map(([date, dayShifts]) => ({
    date,
    dayName: formatDayName(date),
    shifts: dayShifts.sort((leftShift, rightShift) => {
      const order = { morning: 0, evening: 1 };
      return order[leftShift.shiftType] - order[rightShift.shiftType];
    }),
  }));
}

async function getMyAvailability(user, weekStartDate) {
  if (!user.employeeId) {
    throw createHttpError(400, "Current user is not linked to an employee");
  }

  const shifts = await availabilityRepository.getShiftsForAvailability(weekStartDate);
  const selectedShiftIds =
    await availabilityRepository.getAvailabilityForEmployee(
      user.employeeId,
      weekStartDate
    );

  return {
    employeeId: user.employeeId,
    weekStartDate,
    selectedShiftIds,
    days: buildAvailabilityGrid(shifts, selectedShiftIds),
  };
}

async function submitMyAvailability(user, weekStartDate, shiftIds) {
  if (!user.employeeId) {
    throw createHttpError(400, "Current user is not linked to an employee");
  }

  if (!Array.isArray(shiftIds)) {
    throw createHttpError(400, "shiftIds must be an array");
  }

  const selectedShiftIds =
    await availabilityRepository.replaceAvailabilityForEmployee(
      user.employeeId,
      weekStartDate,
      shiftIds
    );
  const shifts = await availabilityRepository.getShiftsForAvailability(weekStartDate);

  return {
    message: "Availability submitted successfully",
    employeeId: user.employeeId,
    weekStartDate,
    selectedShiftIds,
    days: buildAvailabilityGrid(shifts, selectedShiftIds),
  };
}

function canManageEmployeeAvailability(user, employeeId) {
  return (
    user.permissionRole === PERMISSION_ROLES.MANAGER ||
    Number(user.employeeId) === Number(employeeId)
  );
}

function parseEmployeeId(employeeId) {
  const numericEmployeeId = Number(employeeId);

  if (!Number.isInteger(numericEmployeeId) || numericEmployeeId <= 0) {
    throw createHttpError(400, "employeeId must be a positive integer");
  }

  return numericEmployeeId;
}

async function ensureEmployeeExists(employeeId) {
  const employee = await employeeRepository.getEmployeeById(employeeId);

  if (!employee) {
    throw createHttpError(404, "Employee not found");
  }

  return employee;
}

async function getEmployeeAvailability(employeeId, weekStartDate, user) {
  const numericEmployeeId = parseEmployeeId(employeeId);

  if (!canManageEmployeeAvailability(user, numericEmployeeId)) {
    throw createHttpError(403, "Cannot access availability for another employee");
  }

  await ensureEmployeeExists(numericEmployeeId);

  const shifts = await availabilityRepository.getShiftsForAvailability(weekStartDate);
  const selectedShiftIds =
    await availabilityRepository.getAvailabilityForEmployee(
      numericEmployeeId,
      weekStartDate
    );

  return {
    employeeId: numericEmployeeId,
    weekStartDate,
    selectedShiftIds,
    days: buildAvailabilityGrid(shifts, selectedShiftIds),
  };
}

async function updateEmployeeAvailability(employeeId, weekStartDate, shiftIds, user) {
  const numericEmployeeId = parseEmployeeId(employeeId);

  if (!canManageEmployeeAvailability(user, numericEmployeeId)) {
    throw createHttpError(403, "Cannot update availability for another employee");
  }

  if (!Array.isArray(shiftIds)) {
    throw createHttpError(400, "shiftIds must be an array");
  }

  await ensureEmployeeExists(numericEmployeeId);

  const selectedShiftIds =
    await availabilityRepository.replaceAvailabilityForEmployee(
      numericEmployeeId,
      weekStartDate,
      shiftIds
    );
  const shifts = await availabilityRepository.getShiftsForAvailability(weekStartDate);

  return {
    message: "Employee availability saved successfully",
    employeeId: numericEmployeeId,
    weekStartDate,
    selectedShiftIds,
    days: buildAvailabilityGrid(shifts, selectedShiftIds),
  };
}

async function getAllAvailability(weekStartDate) {
  const rows = await availabilityRepository.getAllAvailability(weekStartDate);
  const submissionsByEmployeeId = new Map();

  for (const row of rows) {
    if (!submissionsByEmployeeId.has(row.employee_id)) {
      submissionsByEmployeeId.set(row.employee_id, {
        employeeId: row.employee_id,
        fullName: row.full_name,
        jobRole: row.role,
        shiftIds: [],
      });
    }

    if (
      row.shift_id &&
      SCHEDULE_JOB_ROLES.some((roleConfig) => roleConfig.jobRole === row.role)
    ) {
      submissionsByEmployeeId.get(row.employee_id).shiftIds.push(row.shift_id);
    }
  }

  return {
    weekStartDate,
    submissions: [...submissionsByEmployeeId.values()],
  };
}

module.exports = {
  getMyAvailability,
  submitMyAvailability,
  getEmployeeAvailability,
  updateEmployeeAvailability,
  getAllAvailability,
};
