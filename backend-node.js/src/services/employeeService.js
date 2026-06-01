const employeeRepository = require("../repositories/employeeRepository");
const { PERMISSION_ROLES, JOB_ROLES } = require("../constants/roles");
const { createHttpError } = require("../utils/errors");

const ALLOWED_JOB_ROLES = new Set(Object.values(JOB_ROLES));
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^05\d{8}$/;
const PHONE_ERROR_MESSAGE = "Phone number must be 10 digits and start with 05.";
const FULL_NAME_ERROR_MESSAGE = "Please enter both first and last name.";
const SETUP_ERROR_MESSAGE =
  "Complete all required employee setup fields before activating this employee.";

function toNamesOnly(employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    phoneNumber: employee.phoneNumber,
    phone_number: employee.phoneNumber,
    jobRole: employee.jobRole,
    role: employee.jobRole,
  };
}

function canViewDetails(user) {
  return (
    user.permissionRole === PERMISSION_ROLES.MANAGER ||
    user.permissionRole === PERMISSION_ROLES.SHIFT_LEADER
  );
}

function canViewEmployeeById(user, employeeId) {
  return canViewDetails(user) || Number(user.employeeId) === Number(employeeId);
}

async function getEmployeesForUser(user) {
  const employees = await employeeRepository.getEmployees();

  if (!canViewDetails(user)) {
    return employees
      .filter((employee) => employee.isActive)
      .map(toNamesOnly);
  }

  return employees;
}

async function getEmployeeByIdForUser(employeeId, user) {
  if (!canViewEmployeeById(user, employeeId)) {
    throw createHttpError(403, "Employee details are not available for this role");
  }

  const employee = await employeeRepository.getEmployeeById(employeeId);

  if (!employee) {
    throw createHttpError(404, "Employee not found");
  }

  return employee;
}

function readNumber(value, fieldName, min, max) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw createHttpError(400, `${fieldName} must be an integer between ${min} and ${max}`);
  }

  return numberValue;
}

function normalizeEmployeeUpdate(body) {
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phoneNumber = normalizePhoneNumber(body.phoneNumber || body.phone_number);

  if (!hasFirstAndLastName(fullName)) {
    throw createHttpError(400, FULL_NAME_ERROR_MESSAGE);
  }

  if (!PHONE_PATTERN.test(phoneNumber)) {
    throw createHttpError(400, PHONE_ERROR_MESSAGE);
  }

  if (!ALLOWED_JOB_ROLES.has(body.jobRole)) {
    throw createHttpError(400, "jobRole is invalid");
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    throw createHttpError(400, "A valid email is required");
  }

  const professionalism = readNumber(body.professionalism, "professionalism", 0, 10);
  const responsibility = readNumber(body.responsibility, "responsibility", 0, 10);
  const pressureHandling = readNumber(body.pressureHandling, "pressureHandling", 0, 10);
  const seniorityMonths = readNumber(body.seniorityMonths, "seniorityMonths", 0, 1200);
  const potential = readNumber(body.potential, "potential", 0, 10);
  const isActive = Boolean(body.isActive);

  const hasManagerSetup =
    professionalism > 0 &&
    responsibility > 0 &&
    pressureHandling > 0 &&
    potential > 0;

  if (isActive && !hasManagerSetup) {
    throw createHttpError(400, SETUP_ERROR_MESSAGE);
  }

  return {
    fullName,
    email,
    phoneNumber,
    jobRole: body.jobRole,
    isActive,
    setupStatus: hasManagerSetup ? "complete" : "pending",
    professionalism,
    responsibility,
    pressureHandling,
    seniorityMonths,
    potential,
  };
}

function normalizePhoneNumber(value) {
  return String(value || "").replace(/[\s-]/g, "").trim();
}

function hasFirstAndLastName(fullName) {
  return fullName.split(/\s+/).filter(Boolean).length >= 2;
}

async function updateEmployee(employeeId, body) {
  const existingEmployee = await employeeRepository.getEmployeeById(employeeId);

  if (!existingEmployee) {
    throw createHttpError(404, "Employee not found");
  }

  const employeeUpdate = normalizeEmployeeUpdate(body || {});

  if (existingEmployee.username && !employeeUpdate.email) {
    throw createHttpError(400, "A valid email is required");
  }

  if (
    !existingEmployee.isActive &&
    employeeUpdate.isActive &&
    !hasAccountSetup(existingEmployee)
  ) {
    throw createHttpError(400, SETUP_ERROR_MESSAGE);
  }

  let updatedEmployee;

  try {
    if (employeeUpdate.email) {
      await employeeRepository.updateLinkedUserEmail(
        employeeId,
        employeeUpdate.email
      );
    }

    updatedEmployee = await employeeRepository.updateEmployee(
      employeeId,
      employeeUpdate
    );
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      throw createHttpError(409, "Username or email already exists");
    }

    throw error;
  }

  await employeeRepository.updateLinkedUserActiveState(
    employeeId,
    updatedEmployee.isActive
  );

  return updatedEmployee;
}

async function deleteEmployee(employeeId) {
  const existingEmployee = await employeeRepository.getEmployeeById(employeeId);

  if (!existingEmployee) {
    throw createHttpError(404, "Employee not found");
  }

  await employeeRepository.deleteEmployee(employeeId);
}

function hasAccountSetup(employee) {
  const email = String(employee.email || "").trim();
  const username = String(employee.username || "").trim();

  return EMAIL_PATTERN.test(email) && Boolean(username);
}

module.exports = {
  getEmployeesForUser,
  getEmployeeByIdForUser,
  updateEmployee,
  deleteEmployee,
};
