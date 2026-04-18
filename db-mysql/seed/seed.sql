INSERT INTO employees (
  id,
  full_name,
  role,
  seniority_months,
  professionalism,
  responsibility,
  pressure_handling,
  potential,
  is_active
)
VALUES
  (1, 'Noam', 'waiter', 0, 9, 9, 8, 6, TRUE),
  (2, 'Dana', 'waiter', 0, 7, 8, 7, 8, TRUE),
  (3, 'Itay', 'waiter', 0, 6, 6, 5, 9, TRUE),
  (4, 'Shira', 'waiter', 0, 8, 9, 8, 7, TRUE),
  (5, 'Omer', 'waiter', 0, 5, 6, 5, 8, TRUE),
  (6, 'Lior', 'waiter', 0, 7, 7, 6, 7, TRUE);

INSERT INTO shifts (
  id,
  shift_date,
  shift_type,
  start_time,
  end_time,
  required_waiters
)
VALUES
  (1, '2026-04-18', 'morning', '11:00:00', '17:00:00', 3),
  (2, '2026-04-18', 'evening', '17:00:00', '23:59:00', 4),
  (3, '2026-04-19', 'morning', '11:00:00', '17:00:00', 3),
  (4, '2026-04-19', 'evening', '17:00:00', '23:59:00', 5);

INSERT INTO shift_requests (
  id,
  employee_id,
  shift_id,
  can_work
)
VALUES
  (1, 1, 4, TRUE),
  (2, 1, 3, TRUE),
  (3, 1, 2, TRUE),
  (4, 1, 1, TRUE),
  (5, 2, 4, TRUE),
  (6, 2, 3, TRUE),
  (7, 2, 2, TRUE),
  (8, 2, 1, TRUE),
  (9, 3, 4, TRUE),
  (10, 3, 3, TRUE),
  (11, 3, 2, TRUE),
  (12, 3, 1, TRUE),
  (13, 4, 4, TRUE),
  (14, 4, 3, TRUE),
  (15, 4, 2, TRUE),
  (16, 4, 1, TRUE),
  (17, 5, 4, TRUE),
  (18, 5, 3, TRUE),
  (19, 5, 2, TRUE),
  (20, 5, 1, TRUE),
  (21, 6, 4, TRUE),
  (22, 6, 3, TRUE),
  (23, 6, 2, TRUE),
  (24, 6, 1, TRUE);
