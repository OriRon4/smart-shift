ALTER TABLE shifts
  ADD COLUMN required_bartenders INT UNSIGNED NOT NULL DEFAULT 1 AFTER required_waiters,
  ADD COLUMN required_shift_leaders INT UNSIGNED NOT NULL DEFAULT 1 AFTER required_bartenders;

ALTER TABLE schedule_assignments
  ADD COLUMN job_role VARCHAR(30) NOT NULL DEFAULT 'waiter' AFTER employee_id;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  employee_id INT NULL,
  username VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  permission_role ENUM('manager', 'shift_leader', 'employee') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT fk_users_employee_id
    FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO employees (
  id,
  full_name,
  role,
  is_active,
  professionalism,
  responsibility,
  pressure_handling,
  seniority_months,
  potential
)
VALUES
  (17, 'Bar Zohar', 'bartender', TRUE, 8, 8, 9, 24, 7),
  (18, 'Alon Weiss', 'bartender', TRUE, 7, 8, 8, 14, 8),
  (19, 'Hila Mor', 'bartender', TRUE, 9, 7, 8, 30, 6),
  (20, 'Adi Kaplan', 'shift_leader', TRUE, 9, 9, 9, 42, 7),
  (21, 'Tal Sivan', 'shift_leader', TRUE, 8, 9, 8, 28, 8),
  (22, 'Manager Demo', 'manager', TRUE, 8, 9, 8, 60, 6);

INSERT IGNORE INTO users (
  id,
  employee_id,
  username,
  email,
  password_hash,
  permission_role,
  is_active
)
VALUES
  (1, 22, 'manager', 'manager@example.com', 'password', 'manager', TRUE),
  (2, 20, 'leader', 'leader@example.com', 'password', 'shift_leader', TRUE),
  (3, 1, 'employee', 'employee@example.com', 'password', 'employee', TRUE);

INSERT IGNORE INTO shift_requests (
  employee_id,
  shift_id
)
VALUES
  (17, 1), (17, 2), (17, 4), (17, 6), (17, 8), (17, 10), (17, 12),
  (18, 1), (18, 3), (18, 5), (18, 7), (18, 9), (18, 11), (18, 13),
  (19, 2), (19, 4), (19, 6), (19, 8), (19, 10), (19, 12), (19, 14),
  (20, 1), (20, 2), (20, 4), (20, 6), (20, 8), (20, 10), (20, 12), (20, 14),
  (21, 1), (21, 3), (21, 5), (21, 7), (21, 9), (21, 11), (21, 13);
