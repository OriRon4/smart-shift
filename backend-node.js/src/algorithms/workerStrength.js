// מחשבת ציון ותק בסקאלה של 0 עד 10 לפי מספר חודשי הוותק של העובד.
function calculateSeniorityScore(seniorityMonths) {
  return Math.min(10, (seniorityMonths / 24) * 10);
}

// מחשבת את ציון החוזק הכולל של העובד לפי נוסחת V1 המאושרת.
function calculateStrengthScore(employee) {
  // קודם מחשבים את ציון הוותק כדי לשלב אותו בתוך נוסחת החוזק.
  const seniorityScore = calculateSeniorityScore(employee.seniority_months);

  return (
    0.35 * employee.professionalism +
    0.3 * employee.responsibility +
    0.2 * employee.pressure_handling +
    0.1 * seniorityScore +
    0.05 * employee.potential
  );
}

// ממירה את ציון החוזק לסקאלה נוחה של 0 עד 1 לצורך נוסחאות נוספות.
function calculateNormalizedStrength(strengthScore) {
  return strengthScore / 10;
}

module.exports = {
  calculateSeniorityScore,
  calculateStrengthScore,
  calculateNormalizedStrength,
};
