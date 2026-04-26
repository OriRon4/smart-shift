# Smart-Shift V1 To-Do List

This file is a planning file only.

No code should be written from this file until the plan is approved.

## 1. Locked V1 Scope

These decisions are already locked for V1:

- Use a real database flow from day one
- No prior assignment history in V1 behavior
- No `performance_logs` behavior in V1
- The week starts on Sunday
- The same waiter may work both morning and evening on the same day
- V1 focuses on one schedule screen only
- The backend and DB structure should still be ready for future growth

## 2. Proposed Final V1 Formulas

These are my proposed final formulas for V1.

They are designed to stay:

- simple
- explainable
- consistent with real DB data
- compatible with the V1 scope

### 2.1 `strength_score`

Use:

```text
seniority_score = min(10, (seniority_months / 24) * 10)
```

```text
strength_score =
  0.35 * professionalism +
  0.30 * responsibility +
  0.20 * pressure_handling +
  0.10 * seniority_score +
  0.05 * potential
```

Reasoning:

- professionalism and responsibility should dominate because they matter most for reliable waiter performance
- pressure handling matters strongly, but slightly less than the first two
- seniority should matter, but should not overpower quality
- potential stays small because V1 should reward real current strength more than future promise

### 2.2 `normalized_strength`

Use:

```text
normalized_strength = strength_score / 10
```

This keeps the value in a clean `0..1` scale for later scoring.

### 2.3 `target_shifts`

Use:

```text
target_shifts = requested_shifts * (0.55 + 0.45 * normalized_strength)
```

Reasoning:

- the target always stays between `55%` and `100%` of what the employee requested
- stronger workers are expected to receive more of what they asked for
- weaker workers still keep a meaningful fair target
- the target never goes above the number of requested shifts, which fits the V1 rule that only explicit requested shifts are eligible

### 2.4 `fairness_gap`

Use:

```text
fairness_gap = max(0, target_shifts - assigned_shifts)
```

And for scoring:

```text
fairness_gap_score = fairness_gap / max(1, target_shifts)
```

This keeps fairness pressure in a clean `0..1` range.

### 2.5 `required_strength_score`

V1 should store a real `required_strength_score` on each shift.

Representation:

- add `required_strength_score` to the `shifts` table
- type: decimal numeric field
- meaning: the minimum desired total `strength_score` of all assigned waiters in that shift

Example meaning:

- if a shift needs `3` waiters and `required_strength_score = 21`
- then the shift ideally needs a total assigned strength of at least `21`

Why this representation is best for V1:

- it is simple to understand
- it is shift-level, not employee-level
- it works naturally with a real DB
- it is easy to show later in manager tools
- it supports future algorithm improvements without redesigning the schema

### 2.6 `strength_gap_score`

Use:

```text
current_shift_strength = sum(strength_score of already assigned waiters in the shift)
```

```text
strength_gap_score =
  max(0, required_strength_score - current_shift_strength) /
  max(1, required_strength_score)
```

Meaning:

- `0` means the shift already meets the strength target
- closer to `1` means the shift still badly needs stronger staffing

### 2.7 `selection_score`

Use:

```text
selection_score =
  0.45 * normalized_strength +
  0.35 * fairness_gap_score +
  0.20 * (normalized_strength * strength_gap_score)
```

Reasoning:

- `0.45` keeps actual worker quality as the main signal
- `0.35` makes fairness important, but not stronger than quality
- `0.20` gives an extra boost to strong workers when a shift is still below its required strength target

This keeps V1 explainable:

- strong workers are generally preferred
- under-assigned workers gain fair priority
- weak shifts specifically pull stronger workers more strongly

### 2.8 Shift Ordering

Before assigning workers, sort remaining shifts by:

```text
coverage_pressure = required_waiters / available_workers
```

```text
priority_order_score =
  0.60 * coverage_pressure +
  0.40 * (required_strength_score / max(1, required_waiters * 10))
```

Sort descending.

Meaning:

- harder-to-cover shifts come first
- among similar shifts, stronger shifts come earlier

### 2.9 How To Use `required_strength_score` In V1

V1 should use it as a real target, but not as a rule that blocks assignment when impossible.

So the behavior should be:

- coverage is still the first hard operational goal
- strength target is the next important goal
- if the shift cannot meet the target with eligible workers, still assign the best possible valid workers
- mark the shift as not meeting the strength target in the backend response

This avoids fake perfection while still making shift quality real and measurable.

## 3. Proposed Backend Response Shape

This is the proposed response contract for the schedule screen.

```json
{
  "weekStartDate": "2026-04-19",
  "weekEndDate": "2026-04-25",
  "generatedAt": "2026-04-22T18:30:00.000Z",
  "summary": {
    "totalShifts": 14,
    "fullyCoveredShifts": 12,
    "underCoveredShifts": 2,
    "meetsStrengthTargetShifts": 10,
    "belowStrengthTargetShifts": 4
  },
  "days": [
    {
      "date": "2026-04-19",
      "dayName": "Sunday",
      "shifts": [
        {
          "shiftId": 1,
          "shiftType": "morning",
          "requiredWaiters": 3,
          "assignedCount": 3,
          "requestedCount": 5,
          "uncoveredSlots": 0,
          "requiredStrengthScore": 21,
          "assignedStrengthScore": 22.4,
          "meetsStrengthTarget": true,
          "assignedWorkers": [
            {
              "employeeId": 8,
              "fullName": "Noam Levi",
              "strengthScore": 7.8
            }
          ]
        }
      ]
    }
  ]
}
```

Why this contract is good for V1:

- the frontend can render the weekly board directly from `days`
- the backend still returns useful schedule quality data
- the response is clean enough for the schedule page without exposing internal algorithm noise
- it leaves room for future employee fairness summaries and warnings

## 4. Smallest Possible Implementation Sequence

This is the smallest clean implementation order I recommend for V1.

Each step is intentionally small so we can build and explain everything clearly.

Progress note:

- this checklist is a high-level progress tracker
- actual implementation still happens in smaller approval-based units

- [x] Step 1
  Inspect the current backend and DB skeleton and map the current files, routes, schema state, and seed state.

- [x] Step 2
  Write a short backend structure note from the current skeleton/base:

  - what already exists
  - what can stay
  - what must change for V1

- [x] Step 3

  Review the current DB schema target against the locked V1 rules.

- [x] Step 4

  Define the exact schema changes needed for V1:

  - Sunday-based weekly flow assumptions
  - waiter-only active employees
  - `required_strength_score` on shifts
  - weekly schedules
  - schedule assignments

- [x] Step 5

  Update or create the schema SQL for the exact V1 tables.

- [x] Step 6

  Prepare one full Sunday-start demo week in seed data:

  - 7 days
  - 2 shifts per day
  - enough waiters
  - mixed request patterns
  - mixed shift strength targets

- [x] Step 7

  Create a dedicated backend response contract note/file only if still needed before endpoint work starts.

- [x] Step 8

  Create the backend route/controller/service/repository skeleton for the schedule flow.

- [x] Step 9

  Implement the repository queries for:

  - employees for one selected week
  - shifts for one selected week
  - shift requests for one selected week

- [x] Step 10

  Implement the worker strength calculation utilities.

- [x] Step 11

  Implement target shift calculation utilities.

- [x] Step 12

  Implement forced-assignment logic for shifts where availability is less than or equal to required coverage.

- [x] Step 13

  Implement shift ordering logic.

- [x] Step 14

  Implement candidate scoring logic with the approved `selection_score`.

- [x] Step 15

  Implement the main assignment flow for remaining shifts.

- [x] Step 16

  Implement V1 strength-target validation per shift:

  - assigned total strength
  - `meetsStrengthTarget`
  - uncovered slots

- [x] Step 17

  Postponed for V1 to keep the algorithm stable and explainable.

- [x] Step 18

  Implement schedule persistence:

  - save weekly schedule
  - save assignments

- [x] Step 19

  Implement the schedule-generation endpoint for one selected week.

- [ ] Step 20

  Verify the backend response with the real DB data.

- [ ] Step 21

  Set up the Angular app shell from the current frontend skeleton.

- [ ] Step 22

  Create the `schedule` feature shell in the frontend.

- [ ] Step 23

  Create frontend models matching the backend response contract.

- [ ] Step 24

  Create the frontend schedule API service.

- [ ] Step 25

  Create the schedule board page shell.

- [ ] Step 26

  Create the week selector component.

- [ ] Step 27

  Create the schedule grid component.

- [ ] Step 28

  Connect the page to the API service and render one selected week.

- [ ] Step 29

  Add simple loading, empty, and error states to the schedule screen.

- [ ] Step 30

  Run an end-to-end V1 verification pass:

  - DB data loads
  - schedule generates
  - result saves
  - frontend displays correctly

## 5. Approval Check Before Coding

Before we write code, I recommend approving these items explicitly:

1. the formulas in section 2
2. the `required_strength_score` representation and usage
3. the response contract in section 3
4. the implementation order in section 4

## TODO / NEXT PHASES

1. Improve backend schedule flow toward a richer algorithm
2. Add employee management flow
3. Add availability submission flow
4. Add manual schedule editing flow
5. Add schedule validation and warnings flow
6. Add authentication and authorization
7. Add tests, cleanup, and project presentation hardening
