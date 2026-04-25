// מחשבת כמה משמרות העובד אמור לקבל באופן הוגן לפי הבקשות והחוזק שלו.
function calculateTargetShifts(requestedShifts, normalizedStrength) {
  return requestedShifts * (0.55 + 0.45 * normalizedStrength);
}

// מחשבת כמה העובד עדיין רחוק מהיעד ההוגן שלו.
function calculateFairnessGap(targetShifts, assignedShifts) {
  return Math.max(0, targetShifts - assignedShifts);
}

// ממירה את פער ההוגנות לציון שאפשר להשתמש בו בדירוג מועמדים.
function calculateFairnessGapScore(fairnessGap, targetShifts) {
  return fairnessGap / Math.max(1, targetShifts);
}

module.exports = {
  calculateTargetShifts,
  calculateFairnessGap,
  calculateFairnessGapScore,
};
