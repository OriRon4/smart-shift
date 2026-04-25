function calculateTargetShifts(requestedShifts, normalizedStrength) {
  return requestedShifts * (0.55 + 0.45 * normalizedStrength);
}

function calculateFairnessGap(targetShifts, assignedShifts) {
  return Math.max(0, targetShifts - assignedShifts);
}

function calculateFairnessGapScore(fairnessGap, targetShifts) {
  return fairnessGap / Math.max(1, targetShifts);
}

module.exports = {
  calculateTargetShifts,
  calculateFairnessGap,
  calculateFairnessGapScore,
};
