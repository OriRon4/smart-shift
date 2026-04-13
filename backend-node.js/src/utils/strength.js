function calculateWorkerStrength(employee) {
  const professionalism = Number(employee.professionalism || 0);
  const responsibility = Number(employee.responsibility || 0);
  const pressureHandling = Number(employee.pressure_handling || 0);

  const strength =
    professionalism * 0.4 +
    responsibility * 0.4 +
    pressureHandling * 0.2;

  return Number(strength.toFixed(2));
}

module.exports = {
  calculateWorkerStrength,
};
