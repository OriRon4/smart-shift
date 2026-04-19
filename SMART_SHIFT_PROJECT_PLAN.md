# Smart-Shift Project Plan

## Overview

Smart-Shift is a restaurant shift scheduling system for generating a weekly waiter schedule based on:

- worker availability
- manager-defined worker attributes
- manager-defined shift coverage requirements

The first version is intentionally narrow. Its goal is to produce a valid, explainable, demo-ready weekly schedule with a clear heuristic algorithm, clean backend structure, and room for future improvement.

---

## V1 Scope

The current version focuses on one generated schedule for one selected week.

In scope for V1:

- waiters only
- one selected week per schedule run
- explicit availability per shift
- manager-defined worker attributes
- manager-defined required waiters per shift
- heuristic scheduling with a simple improvement loop
- saved generated schedules in MySQL

Out of scope for V1:

- historical balancing across previous weeks
- automatic worker score updates
- machine learning
- dynamic staffing prediction
- advanced labor rules such as max weekly hours or rest-time constraints

---

## Final V1 Scheduling Rules

### Worker eligibility

- Only `employees` with `is_active = TRUE` and `role = 'waiter'` are eligible.
- A worker may be assigned to a shift only if there is an explicit `shift_requests.can_work = TRUE` record for that exact shift.
- No request record means the worker is treated as unavailable for that shift.
- A worker may be assigned to both morning and evening shifts on the same day.
- V1 does not enforce a hard maximum number of shifts per worker per week.

### Scheduling window

- Schedule generation runs for one selected week only.
- The API accepts a `weekStartDate` input.
- The backend normalizes that date to the Monday of the selected week.
- Only shifts and availability requests inside that one week are used during generation.

### Worker strength

Base worker strength:

`strength = 0.4 * professionalism + 0.4 * responsibility + 0.2 * pressure_handling`

Penalty rule:

- If `responsibility <= 3`, subtract `1.5` from the worker's strength.
- Adjusted strength cannot go below `0`.

Notes:

- `potential` exists in the schema but is not used in the V1 scheduling score.
- Historical performance is not used in V1.

### Shift priority order

Shifts are processed in this order:

1. Higher shortage risk first
2. Higher `required_waiters` first
3. Evening before morning
4. Earlier date first

Shortage risk is based on:

`max(0, required_waiters - available_workers_for_shift)`

### Initial assignment rule

For each shift:

1. Build the list of eligible workers for that shift
2. Sort workers by:
   - higher adjusted strength
   - fewer already assigned shifts
   - higher number of requested shifts
   - lower employee id as deterministic tie-breaker
3. Assign up to `required_waiters`

If not enough eligible workers exist, the shift remains partially uncovered. V1 reports the shortage instead of assigning unavailable workers.

### Validity and scoring

A shift is considered fully covered when:

- `assignedCount === requiredWaiters`

A shift is considered valid when:

- it is fully covered
- no employee appears more than once in the same shift

The schedule score is:

- `45%` coverage score
- `25%` validity score
- `20%` shift strength score
- `10%` fairness score

Fairness in V1 is calculated only across workers who requested at least one shift.

- The algorithm compares assigned shifts to requested shifts using a proportional fulfillment ratio.
- This keeps fairness simple while still rewarding balanced distribution relative to availability.

### Improvement phase

After the initial schedule is built:

- the algorithm performs up to `3` improvement passes
- each pass tries worker swaps inside shifts
- a change is kept only if the total schedule score improves
- no improvement step may introduce duplicate assignments inside a shift

---

## Current Implementation Status

Already implemented:

- modular backend under `backend-node.js`
- MySQL schema and seed scripts under `db-mysql`
- worker strength calculation and low-responsibility penalty
- shift priority ordering
- initial heuristic assignment generation
- schedule evaluation and scoring
- simple improvement loop
- schedule persistence into `weekly_schedules` and `schedule_assignments`
- API support for generating a schedule for one selected week
- waiter-only filtering for generation

Current backend behavior:

- `POST /generate-schedule` requires `weekStartDate` in the request body
- the selected week is normalized to Monday-to-Sunday
- only active waiters are considered during schedule generation
- uncovered shifts are returned in the response instead of being silently forced full
- the response includes:
  - score breakdown
  - per-shift summaries
  - employee assignment statistics
  - number of improvement passes

Important repo note:

- the root `index.js` still exists as a legacy entry file
- the real backend entry point is `backend-node.js/src/server.js`

---

## Database Status

Implemented tables:

- `employees`
- `shifts`
- `shift_requests`
- `weekly_schedules`
- `schedule_assignments`

Schema support already exists for:

- `professionalism`
- `responsibility`
- `pressure_handling`
- `potential`
- `required_waiters`

Current schema direction:

- worker attributes are stored directly in `employees`
- required coverage is stored directly in `shifts`
- final generated assignments are stored in `schedule_assignments`

---

## Remaining Work

### Frontend

- [ ] Create the Angular frontend inside `frontend-angular`
- [ ] Build a weekly schedule view
- [ ] Add a week selector that sends `weekStartDate` to schedule generation
- [ ] Build forms for worker availability input
- [ ] Build forms for manager-defined worker attributes
- [ ] Build forms for weekly shift coverage requirements
- [ ] Connect frontend pages to backend API endpoints

### API

- [x] Generate a weekly schedule
- [ ] Fetch employees
- [ ] Fetch shifts
- [ ] Submit or update shift requests
- [ ] Fetch saved schedules
- [ ] Update worker attributes
- [ ] Update required waiters per shift

### Testing And Quality

- [x] Add initial unit tests for worker strength calculation
- [x] Add initial unit tests for core scheduling behavior
- [ ] Add tests for schedule persistence
- [ ] Add API tests for schedule generation endpoints
- [ ] Add edge-case tests for invalid week input
- [ ] Add edge-case tests for very low worker availability
- [ ] Add tests for fairness behavior across uneven availability

### Documentation And Demo Prep

- [ ] Add a step-by-step algorithm explanation for presentation
- [ ] Document the API request and response shape
- [ ] Add a simple system architecture diagram
- [ ] Prepare demo data for more than one week
- [ ] Document postponed features clearly for the final presentation

---

## Suggested API Contract For V1

### Generate Schedule

`POST /generate-schedule`

Request body:

```json
{
  "weekStartDate": "2026-04-13"
}
```

Response includes:

- normalized `weekStartDate`
- schedule summary
- score breakdown
- employee assignment stats
- shift-level coverage and validity details

---

## Future Extensions

Later versions may include:

- historical balancing across multiple weeks
- automatic worker score updates based on observed performance
- use of `potential` as part of a more advanced assignment strategy
- dynamic estimation of required waiters per shift
- stronger fairness constraints
- labor-rule constraints such as rest time or weekly workload caps
