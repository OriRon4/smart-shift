const { spawn } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const trainingScriptPath = path.join(
  projectRoot,
  "ml",
  "train_shift_requirements_model.py"
);
const pythonCommand = process.env.PYTHON_BIN || "python";

let isTrainingRunning = false;
let retrainPending = false;

function runTrainingProcess() {
  isTrainingRunning = true;

  const child = spawn(pythonCommand, [trainingScriptPath], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    isTrainingRunning = false;
    console.error("ML background training failed to start:", error.message);
  });

  child.on("close", (code) => {
    isTrainingRunning = false;

    if (code === 0) {
      console.info("ML background training completed successfully.");
      if (stdout.trim()) {
        console.info(stdout.trim());
      }
    } else {
      console.error(`ML background training failed with exit code ${code}.`);
      if (stderr.trim()) {
        console.error(stderr.trim());
      }
    }

    if (retrainPending) {
      retrainPending = false;
      runTrainingProcess();
    }
  });
}

function triggerBackgroundTraining() {
  if (isTrainingRunning) {
    retrainPending = true;
    console.info("ML training is already running. Marked retrain as pending.");

    return {
      started: false,
      pending: true,
    };
  }

  runTrainingProcess();

  return {
    started: true,
    pending: false,
  };
}

function getTrainingState() {
  return {
    isTrainingRunning,
    retrainPending,
  };
}

module.exports = {
  triggerBackgroundTraining,
  getTrainingState,
};
