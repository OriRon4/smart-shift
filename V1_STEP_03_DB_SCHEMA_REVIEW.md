# Smart-Shift V1 Step 3 - DB Schema Review

This file records the result of Step 3 from the approved V1 to-do flow:

> Define exactly what DB schema V1 needs against the current empty DB skeleton.

At this stage, the DB folders are still empty of real SQL, so this file defines the exact schema V1 should implement next.

## 1. Step 3 Goal

Define the minimal real database schema required for V1, with:

- the exact tables
- the exact fields
- primary keys
- foreign keys
- important constraints
- what is required now
- what is intentionally postponed

## 2. V1 Schema Summary

V1 needs exactly these five business tables:

1. `employees`
2. `shifts`
3. `shift_requests`
4. `weekly_schedules`
5. `schedule_assignments`

This matches the approved V1 scope:

- active waiters only
- one selected Sunday-start week at a time
- explicit shift requests
- generated weekly schedule records
- saved assignments

## 3. Exact Tables Required Now

### 3.1 `employees`

Purpose:

- store waiter identity
- store active/inactive status
- store manager-defined scoring attributes used by the V1 algorithm

Required fields:

```text
id
full_name
role
is_active
professionalism
responsibility
pressure_handling
seniority_months
potential
```

Recommended field design:

```text
id INT PRIMARY KEY AUTO_INCREMENT
full_name VARCHAR(100) NOT NULL
role VARCHAR(30) NOT NULL DEFAULT 'waiter'
is_active BOOLEAN NOT NULL DEFAULT TRUE
professionalism TINYINT UNSIGNED NOT NULL
responsibility TINYINT UNSIGNED NOT NULL
pressure_handling TINYINT UNSIGNED NOT NULL
seniority_months INT UNSIGNED NOT NULL DEFAULT 0
potential TINYINT UNSIGNED NOT NULL
```

Required constraints:

- primary key on `id`
- `professionalism` between `0` and `10`
- `responsibility` between `0` and `10`
- `pressure_handling` between `0` and `10`
- `potential` between `0` and `10`
- `seniority_months >= 0`

Important V1 note:

- V1 scheduling will filter to `role = 'waiter'` and `is_active = true`
- the schema may still store other roles later, but V1 logic ignores them

### 3.2 `shifts`

Purpose:

- store the actual shift slots for one or more weeks
- store coverage demand
- store the real V1 strength target per shift

Required fields:

```text
id
shift_date
shift_type
required_waiters
required_strength_score
```

Recommended field design:

```text
id INT PRIMARY KEY AUTO_INCREMENT
shift_date DATE NOT NULL
shift_type ENUM('morning', 'evening') NOT NULL
required_waiters INT UNSIGNED NOT NULL
required_strength_score DECIMAL(6,2) NOT NULL
```

Required constraints:

- primary key on `id`
- unique constraint on `(shift_date, shift_type)`
- `required_waiters > 0`
- `required_strength_score >= 0`

Important V1 note:

- V1 week selection should be derived from `shift_date`
- no separate `week_start_date` column is required in `shifts`
- Sunday-start week logic should be enforced in the backend/query layer, not duplicated in this table

### 3.3 `shift_requests`

Purpose:

- store employee availability/request data for exact shifts
- define which workers are eligible for each exact shift

Required fields:

```text
id
employee_id
shift_id
can_work
```

Recommended field design:

```text
id INT PRIMARY KEY AUTO_INCREMENT
employee_id INT NOT NULL
shift_id INT NOT NULL
can_work BOOLEAN NOT NULL
```

Required constraints:

- primary key on `id`
- foreign key `employee_id -> employees.id`
- foreign key `shift_id -> shifts.id`
- unique constraint on `(employee_id, shift_id)`

Important V1 note:

- only explicit `can_work = true` rows make an employee eligible
- missing request row means not eligible
- `can_work = false` may exist in the schema, but V1 scheduling logic ignores it as eligibility

### 3.4 `weekly_schedules`

Purpose:

- represent one generated schedule entity for one selected week

Required fields:

```text
id
week_start_date
generated_at
```

Recommended field design:

```text
id INT PRIMARY KEY AUTO_INCREMENT
week_start_date DATE NOT NULL
generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Required constraints:

- primary key on `id`
- unique constraint on `week_start_date`

Important V1 note:

- because schedule versioning is postponed, V1 should allow only one saved schedule row per week
- `week_start_date` must represent the Sunday of the scheduled week
- enforcing "must be Sunday" is better handled in backend logic for V1 than as a DB-level hard constraint

### 3.5 `schedule_assignments`

Purpose:

- store the actual employee-to-shift assignments belonging to a generated weekly schedule

Required fields:

```text
id
schedule_id
shift_id
employee_id
assigned_strength_score
```

Recommended field design:

```text
id INT PRIMARY KEY AUTO_INCREMENT
schedule_id INT NOT NULL
shift_id INT NOT NULL
employee_id INT NOT NULL
assigned_strength_score DECIMAL(6,2) NOT NULL
```

Required constraints:

- primary key on `id`
- foreign key `schedule_id -> weekly_schedules.id`
- foreign key `shift_id -> shifts.id`
- foreign key `employee_id -> employees.id`
- unique constraint on `(schedule_id, shift_id, employee_id)`

Important V1 note:

- `assigned_strength_score` should snapshot the worker strength used at generation time
- this keeps historical generated schedules explainable even if employee attributes change later

## 4. Recommended Foreign-Key Behavior

These are the recommended foreign-key behaviors for V1:

### `shift_requests`

- `employee_id -> employees.id`:
  - `ON DELETE RESTRICT`
  - `ON UPDATE CASCADE`
- `shift_id -> shifts.id`:
  - `ON DELETE RESTRICT`
  - `ON UPDATE CASCADE`

Reason:

- request rows should not silently disappear if base records are deleted by mistake

### `schedule_assignments`

- `schedule_id -> weekly_schedules.id`:
  - `ON DELETE CASCADE`
  - `ON UPDATE CASCADE`
- `shift_id -> shifts.id`:
  - `ON DELETE RESTRICT`
  - `ON UPDATE CASCADE`
- `employee_id -> employees.id`:
  - `ON DELETE RESTRICT`
  - `ON UPDATE CASCADE`

Reason:

- if a weekly schedule row is intentionally removed, its assignments should go with it
- shifts and employees should not be casually deleted if assignments depend on them

## 5. Important Constraints Required Now

These constraints are important enough to be part of V1 now:

### Data-quality constraints

- employee scoring attributes must stay on the `0..10` scale
- `seniority_months` must not be negative
- `required_waiters` must be positive
- `required_strength_score` must not be negative
- `shift_type` must be limited to `morning` or `evening`

### Uniqueness constraints

- one shift slot per `(shift_date, shift_type)`
- one request row per `(employee_id, shift_id)`
- one weekly schedule row per `week_start_date`
- one assignment row per `(schedule_id, shift_id, employee_id)`

### Business constraints handled in application logic, not DB

These are still important, but should be enforced in the backend rather than in SQL constraints:

- selected week must start on Sunday
- schedule generation should use only one selected week at a time
- only active waiters participate in V1 scheduling
- only explicit `can_work = true` requests make a worker eligible
- the same waiter may appear in both morning and evening on the same day

## 6. What Is Required Now Vs Postponed

### Required now

These are required in the first real V1 schema:

- `employees`
- `shifts`
- `shift_requests`
- `weekly_schedules`
- `schedule_assignments`
- waiter scoring fields
- `required_waiters`
- `required_strength_score`
- one saved schedule per Sunday-start week

### Intentionally postponed

These should **not** be part of the first V1 schema:

- `performance_logs`
- prior assignment history logic tables
- authentication tables
- authorization tables
- password fields
- audit log tables
- schedule versioning tables
- manual edit tracking tables
- employee availability templates across many weeks
- role-mix tables
- ML or prediction tables
- fairness summary tables
- warning/notification tables

## 7. Clean V1 DB Starting Point

If we translate this review into the next SQL step, the clean V1 starting point is:

### Minimal core entities

- employees with scoring attributes
- shifts with coverage and strength targets
- exact employee-to-shift requests
- one schedule record per week
- assignment rows under that schedule

### Minimal DB behavior

- backend selects one Sunday-start week
- backend loads only that week's shifts and requests
- backend filters active waiters only
- backend generates a schedule
- backend saves one weekly schedule row and its assignments

## 8. Step 3 Conclusion

The DB skeleton is currently empty, but V1 now has a fully defined schema target.

So Step 3 is complete:

- the exact V1 tables are defined
- the exact fields are defined
- the PK/FK structure is defined
- the important constraints are defined
- postponed DB items are explicitly separated from required V1 items
