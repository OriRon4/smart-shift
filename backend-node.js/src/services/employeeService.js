const employeeRepository = require("../repositories/employeeRepository");
const { PERMISSION_ROLES, JOB_ROLES } = require("../constants/roles");
const { createHttpError } = require("../utils/errors");

const ALLOWED_JOB_ROLES = new Set(Object.values(JOB_ROLES));

function toNamesOnly(employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
  };
}

function canViewDetails(user) {
  return (
    user.permissionRole === PERMISSION_ROLES.MANAGER ||
    user.permissionRole === PERMISSION_ROLES.SHIFT_LEADER
  );
}

async function getEmployeesForUser(user) {
  const employees = await employeeRepository.getEmployees();

  if (!canViewDetails(user)) {
    return employees.filter((employee) => employee.isActive).map(toNamesOnly);
  }

  return employees;
}

async function getEmployeeByIdForUser(employeeId, user) {
  if (!canViewDetails(user)) {
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

  if (!fullName) {
    throw createHttpError(400, "fullName is required");
  }

  if (!ALLOWED_JOB_ROLES.has(body.jobRole)) {
    throw createHttpError(400, "jobRole is invalid");
  }

  return {
    fullName,
    jobRole: body.jobRole,
    isActive: Boolean(body.isActive),
    professionalism: readNumber(body.professionalism, "professionalism", 0, 10),
    responsibility: readNumber(body.responsibility, "responsibility", 0, 10),
    pressureHandling: readNumber(body.pressureHandling, "pressureHandling", 0, 10),
    seniorityMonths: readNumber(body.seniorityMonths, "seniorityMonths", 0, 1200),
    potential: readNumber(body.potential, "potential", 0, 10),
  };
}

async function updateEmployee(employeeId, body) {
  const existingEmployee = await employeeRepository.getEmployeeById(employeeId);

  if (!existingEmployee) {
    throw createHttpError(404, "Employee not found");
  }

  const employeeUpdate = normalizeEmployeeUpdate(body || {});
  return employeeRepository.updateEmployee(employeeId, employeeUpdate);
}

module.exports = {
  getEmployeesForUser,
  getEmployeeByIdForUser,
  updateEmployee,
};
