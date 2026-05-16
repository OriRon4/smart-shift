const DEFAULT_API_BASE_URL = "http://localhost:3000/api";
const DEFAULT_PASSWORD = "password";

function getCurrentSunday() {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());

  const year = sunday.getFullYear();
  const month = String(sunday.getMonth() + 1).padStart(2, "0");
  const day = String(sunday.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const apiBaseUrl = process.env.TEST_API_BASE_URL || DEFAULT_API_BASE_URL;
const weekStartDate = process.env.TEST_WEEK_START_DATE || getCurrentSunday();
const managerLogin = process.env.TEST_MANAGER_LOGIN || "manager@example.com";
const employeeLogin = process.env.TEST_EMPLOYEE_LOGIN || "employee@example.com";
const password = process.env.TEST_PASSWORD || DEFAULT_PASSWORD;

async function request(method, path, { token, body } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  return {
    status: response.status,
    data,
  };
}

function record(results, name, expected, actual, pass) {
  results.push({
    test: name,
    expected,
    actual,
    pass: Boolean(pass),
  });
}

async function login(loginValue) {
  return request("POST", "/auth/login", {
    body: {
      login: loginValue,
      password,
    },
  });
}

async function run() {
  const results = [];
  const manager = await login(managerLogin);
  const employee = await login(employeeLogin);
  const managerToken = manager.data && manager.data.token;
  const employeeToken = employee.data && employee.data.token;

  record(
    results,
    "manager login returns JWT",
    200,
    manager.status,
    manager.status === 200 && managerToken && managerToken !== "mock-token"
  );
  record(
    results,
    "employee login returns JWT",
    200,
    employee.status,
    employee.status === 200 && employeeToken && employeeToken !== "mock-token"
  );

  const noToken = await request(
    "GET",
    `/ml/predictions?weekStartDate=${weekStartDate}`
  );
  const badToken = await request(
    "GET",
    `/ml/predictions?weekStartDate=${weekStartDate}`,
    { token: "not-a-real-token" }
  );
  const employeeBlocked = await request(
    "GET",
    `/ml/predictions?weekStartDate=${weekStartDate}`,
    { token: employeeToken }
  );

  record(results, "missing token blocked", 401, noToken.status, noToken.status === 401);
  record(results, "invalid token blocked", 401, badToken.status, badToken.status === 401);
  record(
    results,
    "employee blocked from ML predictions",
    403,
    employeeBlocked.status,
    employeeBlocked.status === 403
  );

  const predictions = await request("POST", "/ml/shift-requirements/predict-week", {
    token: managerToken,
    body: { weekStartDate },
  });
  record(
    results,
    "manager generates ML predictions",
    201,
    predictions.status,
    predictions.status === 201 &&
      predictions.data &&
      Array.isArray(predictions.data.predictions) &&
      predictions.data.predictions.length > 0
  );

  const savedPredictions = await request(
    "GET",
    `/ml/predictions?weekStartDate=${weekStartDate}`,
    { token: managerToken }
  );
  const firstPrediction =
    savedPredictions.data &&
    Array.isArray(savedPredictions.data.predictions) &&
    savedPredictions.data.predictions.find(
      (prediction) => prediction.recommendedWaiters !== null
    );

  record(
    results,
    "manager reads saved ML predictions",
    200,
    savedPredictions.status,
    savedPredictions.status === 200 && firstPrediction
  );

  const applied = firstPrediction
    ? await request("POST", `/ml/predictions/${firstPrediction.shiftId}/apply`, {
        token: managerToken,
        body: {},
      })
    : { status: 0, data: null };
  record(
    results,
    "manager applies one ML prediction",
    200,
    applied.status,
    applied.status === 200 && applied.data && applied.data.scheduleId
  );

  const generated = await request("POST", "/schedules/generate", {
    token: managerToken,
    body: { weekStartDate },
  });
  const scheduleId = generated.data && generated.data.scheduleId;

  record(
    results,
    "schedule generation still works",
    201,
    generated.status,
    generated.status === 201 && scheduleId
  );

  const published = scheduleId
    ? await request("POST", `/schedules/${scheduleId}/publish`, {
        token: managerToken,
        body: {},
      })
    : { status: 0, data: null };
  record(
    results,
    "manager publishes schedule",
    200,
    published.status,
    published.status === 200 && published.data && published.data.publishedAt
  );

  const employeePublishedView = await request(
    "GET",
    `/schedules?weekStartDate=${weekStartDate}`,
    { token: employeeToken }
  );
  record(
    results,
    "employee sees published schedule",
    200,
    employeePublishedView.status,
    employeePublishedView.status === 200 &&
      employeePublishedView.data &&
      Array.isArray(employeePublishedView.data.days) &&
      employeePublishedView.data.days.length > 0
  );

  const unpublished = scheduleId
    ? await request("DELETE", `/schedules/${scheduleId}/publish`, {
        token: managerToken,
      })
    : { status: 0, data: null };
  record(
    results,
    "manager unpublishes schedule",
    200,
    unpublished.status,
    unpublished.status === 200 &&
      unpublished.data &&
      !unpublished.data.publishedAt
  );

  const employeeUnpublishedView = await request(
    "GET",
    `/schedules?weekStartDate=${weekStartDate}`,
    { token: employeeToken }
  );
  record(
    results,
    "employee cannot see unpublished schedule",
    200,
    employeeUnpublishedView.status,
    employeeUnpublishedView.status === 200 &&
      employeeUnpublishedView.data &&
      Array.isArray(employeeUnpublishedView.data.days) &&
      employeeUnpublishedView.data.days.length === 0
  );

  console.log(
    JSON.stringify(
      {
        apiBaseUrl,
        weekStartDate,
        scheduleId,
        results,
      },
      null,
      2
    )
  );

  if (results.some((result) => !result.pass)) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
