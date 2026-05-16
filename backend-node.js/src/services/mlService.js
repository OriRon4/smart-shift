const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const mlRepository = require("../repositories/mlRepository");
const scheduleRepository = require("../repositories/scheduleRepository");
const scheduleService = require("./scheduleService");
const { createHttpError } = require("../utils/errors");
const { getWeekRange } = require("../utils/week");

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const predictionScriptPath = path.join(
  projectRoot,
  "ml",
  "predict_shift_requirements.py"
);
const pythonCommand = process.env.PYTHON_BIN || "python";

function formatDateKey(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).slice(0, 10);
}

function getDayOfWeek(dateKey) {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

function isWeekend(dayOfWeek) {
  return dayOfWeek === 5 || dayOfWeek === 6;
}

function buildAverageLookup(averages) {
  const byPattern = new Map(
    averages.byPattern.map((row) => [
      `${row.day_of_week}:${row.shift_type}`,
      {
        expectedCustomerLoad: Number(row.expected_customer_load),
        managerRating: Number(row.manager_rating),
      },
    ])
  );
  const byShiftType = new Map(
    averages.byShiftType.map((row) => [
      row.shift_type,
      {
        expectedCustomerLoad: Number(row.expected_customer_load),
        managerRating: Number(row.manager_rating),
      },
    ])
  );
  const overall = averages.overall
    ? {
        expectedCustomerLoad: Number(averages.overall.expected_customer_load),
        managerRating: Number(averages.overall.manager_rating),
      }
    : null;

  return {
    get(dayOfWeek, shiftType) {
      return (
        byPattern.get(`${dayOfWeek}:${shiftType}`) ||
        byShiftType.get(shiftType) ||
        overall || {
          expectedCustomerLoad: shiftType === "morning" ? 100 : 160,
          managerRating: 8,
        }
      );
    },
  };
}

function buildPredictionInput(shifts, averages) {
  const lookup = buildAverageLookup(averages);

  return shifts.map((shift) => {
    const shiftDate = formatDateKey(shift.shift_date);
    const dayOfWeek = getDayOfWeek(shiftDate);
    const defaults = lookup.get(dayOfWeek, shift.shift_type);

    return {
      shift_id: shift.id,
      day_of_week: dayOfWeek,
      shift_type: shift.shift_type,
      is_weekend: isWeekend(dayOfWeek),
      expected_customer_load: Math.round(defaults.expectedCustomerLoad),
      manager_rating: Number(defaults.managerRating.toFixed(1)),
    };
  });
}

async function runPythonPrediction(shifts) {
  const inputFilePath = path.join(
    os.tmpdir(),
    `smart-shift-ml-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  try {
    await fs.writeFile(
      inputFilePath,
      JSON.stringify({ shifts }, null, 2),
      "utf8"
    );

    const { stdout, stderr } = await execFileAsync(
      pythonCommand,
      [predictionScriptPath, "--input-file", inputFilePath],
      {
        cwd: projectRoot,
        windowsHide: true,
        timeout: 30000,
      }
    );

    if (stderr.trim()) {
      console.warn(stderr.trim());
    }

    return JSON.parse(stdout);
  } catch (error) {
    throw createHttpError(
      500,
      "ML prediction failed. Train the models and try again.",
      error.message
    );
  } finally {
    await fs.rm(inputFilePath, { force: true }).catch(() => {});
  }
}

function normalizePrediction(rawPrediction) {
  const shiftId = Number(rawPrediction.shift_id);
  const recommendedWaiters = Number(rawPrediction.recommended_waiters);
  const recommendedStrengthScore = Number(
    rawPrediction.recommended_strength_score
  );

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw createHttpError(500, "ML prediction returned an invalid shift id");
  }

  if (!Number.isInteger(recommendedWaiters) || recommendedWaiters <= 0) {
    throw createHttpError(500, "ML prediction returned invalid waiter count");
  }

  if (
    !Number.isFinite(recommendedStrengthScore) ||
    recommendedStrengthScore < 0 ||
    recommendedStrengthScore > 100
  ) {
    throw createHttpError(500, "ML prediction returned invalid strength score");
  }

  return {
    shiftId,
    recommendedWaiters,
    recommendedStrengthScore,
    modelVersion: rawPrediction.model_version || "unknown",
  };
}

async function predictWeek(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);
  const shifts = await scheduleRepository.ensureWeeklyShifts(
    weekRange.weekStartDate
  );
  const averages = await mlRepository.getPerformanceAverages();
  const predictionInput = buildPredictionInput(shifts, averages);
  const predictionResult = await runPythonPrediction(predictionInput);
  const predictions = (predictionResult.predictions || []).map(
    normalizePrediction
  );

  await mlRepository.savePredictions(predictions);

  return {
    message: "ML recommendations generated successfully",
    weekStartDate: weekRange.weekStartDate,
    weekEndDate: weekRange.weekEndDate,
    predictions: await mlRepository.getPredictionsByWeek(
      weekRange.weekStartDate
    ),
  };
}

async function getPredictions(weekStartDate) {
  const weekRange = getWeekRange(weekStartDate);

  await scheduleRepository.ensureWeeklyShifts(weekRange.weekStartDate);

  return {
    weekStartDate: weekRange.weekStartDate,
    weekEndDate: weekRange.weekEndDate,
    predictions: await mlRepository.getPredictionsByWeek(
      weekRange.weekStartDate
    ),
  };
}

async function applyPrediction(shiftId, user) {
  const numericShiftId = Number(shiftId);

  if (!Number.isInteger(numericShiftId) || numericShiftId <= 0) {
    throw createHttpError(400, "shiftId must be a positive integer");
  }

  const [prediction, shift] = await Promise.all([
    mlRepository.getPredictionByShiftId(numericShiftId),
    scheduleRepository.getShiftById(numericShiftId),
  ]);

  if (!shift) {
    throw createHttpError(404, "Shift not found");
  }

  if (!prediction) {
    throw createHttpError(404, "ML prediction not found for this shift");
  }

  return scheduleService.updateShiftRequirements(
    numericShiftId,
    {
      requiredWaiters: prediction.recommendedWaiters,
      requiredBartenders: Number(shift.required_bartenders),
      requiredShiftLeaders: Number(shift.required_shift_leaders),
      requiredStrengthScore: prediction.recommendedStrengthScore,
    },
    user
  );
}

async function applyWeek(weekStartDate, user) {
  const weekRange = getWeekRange(weekStartDate);
  const shifts = await scheduleRepository.ensureWeeklyShifts(
    weekRange.weekStartDate
  );
  let lastBoard = null;

  for (const shift of shifts) {
    const prediction = await mlRepository.getPredictionByShiftId(shift.id);

    if (prediction) {
      lastBoard = await applyPrediction(shift.id, user);
    }
  }

  return (
    lastBoard || {
      message: "No ML predictions found for this week",
      weekStartDate: weekRange.weekStartDate,
      weekEndDate: weekRange.weekEndDate,
    }
  );
}

module.exports = {
  predictWeek,
  getPredictions,
  applyPrediction,
  applyWeek,
};
