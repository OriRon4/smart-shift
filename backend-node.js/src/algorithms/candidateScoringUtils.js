// מחשבת עד כמה המשמרת עדיין רחוקה מיעד החוזק שלה ברגע הנוכחי.
function calculateStrengthGapScore(requiredStrengthScore, currentShiftStrength) {
  return (
    Math.max(0, Number(requiredStrengthScore) - currentShiftStrength) /
    Math.max(1, Number(requiredStrengthScore))
  );
}

// מחשבת את ציון הבחירה של מועמד לפי חוזק, הוגנות וצורך של המשמרת בחוזק.
function calculateSelectionScore(
  normalizedStrength,
  fairnessGapScore,
  strengthGapScore
) {
  return (
    0.45 * normalizedStrength +
    0.35 * fairnessGapScore +
    0.2 * (normalizedStrength * strengthGapScore)
  );
}

// מדרגת את כל המועמדים למשמרת אחת מהמתאים ביותר לפחות מתאים.
function scoreShiftCandidates(
  candidates,
  requiredStrengthScore,
  currentShiftStrength
) {
  const strengthGapScore = calculateStrengthGapScore(
    requiredStrengthScore,
    currentShiftStrength
  );

  return candidates
    // Add the scoring fields each candidate needs for this specific shift.
    // מוסיפים לכל מועמד את ציוני העזר הדרושים כדי לחשב את ציון הבחירה שלו.
    .map((candidate) => ({
      ...candidate,
      strengthGapScore,
      selectionScore: calculateSelectionScore(
        candidate.normalizedStrength,
        candidate.fairnessGapScore,
        strengthGapScore
      ),
    }))
    // Pick the best candidate first, with stable tie-breakers.
    // ממיינים את המועמדים כך שהמועמד הטוב ביותר יהיה ראשון ברשימה.
    .sort((leftCandidate, rightCandidate) => {
      if (rightCandidate.selectionScore !== leftCandidate.selectionScore) {
        return rightCandidate.selectionScore - leftCandidate.selectionScore;
      }

      if (rightCandidate.strengthScore !== leftCandidate.strengthScore) {
        return rightCandidate.strengthScore - leftCandidate.strengthScore;
      }

      return leftCandidate.employeeId - rightCandidate.employeeId;
    });
}

module.exports = {
  calculateStrengthGapScore,
  calculateSelectionScore,
  scoreShiftCandidates,
};
