function findForcedShifts(shifts, shiftRequests) {
  const requestsByShiftId = new Map();

  for (const shiftRequest of shiftRequests) {
    const existingEmployeeIds =
      requestsByShiftId.get(shiftRequest.shift_id) || [];

    existingEmployeeIds.push(shiftRequest.employee_id);
    requestsByShiftId.set(shiftRequest.shift_id, existingEmployeeIds);
  }

  return shifts
    .map((shift) => {
      const employeeIds = requestsByShiftId.get(shift.id) || [];
      const requestedCount = employeeIds.length;

      return {
        shiftId: shift.id,
        requiredWaiters: shift.required_waiters,
        requestedCount,
        employeeIds,
      };
    })
    .filter((shift) => shift.requestedCount <= shift.requiredWaiters);
}

function buildForcedAssignments(forcedShifts) {
  return forcedShifts.flatMap((forcedShift) =>
    forcedShift.employeeIds.map((employeeId) => ({
      shiftId: forcedShift.shiftId,
      employeeId,
    }))
  );
}

module.exports = {
  findForcedShifts,
  buildForcedAssignments,
};
