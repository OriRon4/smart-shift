const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateWorkerStrength } = require("../utils/strength");
const { generateScheduleDraft } = require("./schedulingAlgorithm");

test("calculateWorkerStrength uses the documented v1 formula", () => {
  const employee = {
    professionalism: 8,
    responsibility: 6,
    pressure_handling: 9,
  };

  assert.equal(calculateWorkerStrength(employee), 7.4);
});

test("generateScheduleDraft assigns only available workers and leaves shortages uncovered", () => {
  const employees = [
    {
      id: 1,
      full_name: "Noam",
      professionalism: 9,
      responsibility: 9,
      pressure_handling: 8,
    },
    {
      id: 2,
      full_name: "Dana",
      professionalism: 6,
      responsibility: 8,
      pressure_handling: 7,
    },
  ];
  const shifts = [
    {
      id: 101,
      shift_date: "2026-04-13",
      shift_type: "morning",
      required_waiters: 2,
    },
    {
      id: 102,
      shift_date: "2026-04-13",
      shift_type: "evening",
      required_waiters: 1,
    },
  ];
  const requests = [
    { employee_id: 1, shift_id: 101, can_work: true },
    { employee_id: 2, shift_id: 102, can_work: true },
  ];

  const draft = generateScheduleDraft(employees, shifts, requests, {
    weekStartDate: "2026-04-13",
  });

  assert.deepEqual(draft.assignmentsByShift.get(101), [1]);
  assert.deepEqual(draft.assignmentsByShift.get(102), [2]);

  const morningSummary = draft.evaluation.shiftSummaries.find(
    (shift) => shift.shiftId === 101
  );

  assert.equal(morningSummary.assignedCount, 1);
  assert.equal(morningSummary.uncoveredSlots, 1);
  assert.equal(morningSummary.isFullyCovered, false);
});

test("generateScheduleDraft can assign the same worker to morning and evening on the same day", () => {
  const employees = [
    {
      id: 1,
      full_name: "Shira",
      professionalism: 8,
      responsibility: 9,
      pressure_handling: 8,
    },
  ];
  const shifts = [
    {
      id: 201,
      shift_date: "2026-04-14",
      shift_type: "morning",
      required_waiters: 1,
    },
    {
      id: 202,
      shift_date: "2026-04-14",
      shift_type: "evening",
      required_waiters: 1,
    },
  ];
  const requests = [
    { employee_id: 1, shift_id: 201, can_work: true },
    { employee_id: 1, shift_id: 202, can_work: true },
  ];

  const draft = generateScheduleDraft(employees, shifts, requests, {
    weekStartDate: "2026-04-13",
  });

  assert.deepEqual(draft.assignmentsByShift.get(201), [1]);
  assert.deepEqual(draft.assignmentsByShift.get(202), [1]);
  assert.equal(
    draft.employeeStats.find((employee) => employee.employeeId === 1)
      .assignedCount,
    2
  );
});
