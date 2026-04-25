// מאתרת משמרות שבהן מספר העובדים שביקשו את המשמרת קטן או שווה למספר העובדים הנדרש.
function findForcedShifts(shifts, shiftRequests) {
  // key: shiftId -> value: employeeIds[] של העובדים שביקשו את המשמרת.
  const requestsByShiftId = new Map();

  // מקבצים את בקשות העובדים לפי מזהה משמרת כדי לדעת כמה עובדים זמינים לכל משמרת.
  for (const shiftRequest of shiftRequests) {
    const existingEmployeeIds =
      requestsByShiftId.get(shiftRequest.shift_id) || [];

    existingEmployeeIds.push(shiftRequest.employee_id);
    requestsByShiftId.set(shiftRequest.shift_id, existingEmployeeIds);
  }

  return shifts
    // לכל משמרת בונים תמונת מצב בסיסית של מספר הבקשות והעובדים הרלוונטיים.
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
    // משאירים רק משמרות שאין בהן בחירה אמיתית ולכן ההשמה בהן כפויה.
    .filter((shift) => shift.requestedCount <= shift.requiredWaiters);
}

// ממירה את רשימת המשמרות הכפויות לרשומות השמה בסיסיות של עובד-משמרת.
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
