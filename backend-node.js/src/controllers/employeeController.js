const employeeService = require("../services/employeeService");

async function getEmployees(req, res, next) {
  try {
    const employees = await employeeService.getEmployeesForUser(req.user);
    res.status(200).json({ employees });
  } catch (error) {
    next(error);
  }
}

async function getEmployeeById(req, res, next) {
  try {
    const employee = await employeeService.getEmployeeByIdForUser(
      Number(req.params.id),
      req.user
    );
    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
}

async function updateEmployee(req, res, next) {
  try {
    const employee = await employeeService.updateEmployee(
      Number(req.params.id),
      req.body
    );
    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
}

async function deactivateEmployee(req, res, next) {
  try {
    const employee = await employeeService.deactivateEmployee(
      Number(req.params.id)
    );
    res.status(200).json({
      message: "Employee deactivated successfully",
      employee,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
};
