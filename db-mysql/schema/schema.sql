CREATE TABLE employees (
  id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(100) NOT NULL,
  phone_number VARCHAR(10) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'waiter',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  setup_status ENUM('pending', 'complete') NOT NULL DEFAULT 'pending',
  professionalism TINYINT UNSIGNED NOT NULL,
  responsibility TINYINT UNSIGNED NOT NULL,
  pressure_handling TINYINT UNSIGNED NOT NULL,
  seniority_months INT UNSIGNED NOT NULL DEFAULT 0,
  potential TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_employees_professionalism
    CHECK (professionalism BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_responsibility
    CHECK (responsibility BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_pressure_handling
    CHECK (pressure_handling BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_potential
    CHECK (potential BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_seniority_months
    CHECK (seniority_months >= 0),
  CONSTRAINT chk_employees_phone_number
    CHECK (phone_number REGEXP '^05[0-9]{8}$')
) ENGINE=InnoDB;

CREATE INDEX idx_employees_role_is_active
  ON employees (role, is_active);

CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  employee_id INT NULL,
  username VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  permission_role ENUM('manager', 'shift_leader', 'employee') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT fk_users_employee_id
    FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_users_permission_role
  ON users (permission_role);

CREATE TABLE shifts (
  id INT NOT NULL AUTO_INCREMENT,
  shift_date DATE NOT NULL,
  shift_type ENUM('morning', 'evening') NOT NULL,
  required_waiters INT UNSIGNED NOT NULL,
  required_bartenders INT UNSIGNED NOT NULL DEFAULT 1,
  required_shift_leaders INT UNSIGNED NOT NULL DEFAULT 1,
  required_strength_score DECIMAL(6,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_shifts_shift_date_shift_type
    UNIQUE (shift_date, shift_type),
  CONSTRAINT chk_shifts_required_waiters
    CHECK (required_waiters > 0),
  CONSTRAINT chk_shifts_required_bartenders
    CHECK (required_bartenders >= 0),
  CONSTRAINT chk_shifts_required_shift_leaders
    CHECK (required_shift_leaders >= 0),
  CONSTRAINT chk_shifts_required_strength_score
    CHECK (required_strength_score >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_shifts_shift_date
  ON shifts (shift_date);

CREATE TABLE shift_requests (
  id INT NOT NULL AUTO_INCREMENT,
  employee_id INT NOT NULL,
  shift_id INT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_shift_requests_employee_id_shift_id
    UNIQUE (employee_id, shift_id),
  CONSTRAINT fk_shift_requests_employee_id
    FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_shift_requests_shift_id
    FOREIGN KEY (shift_id) REFERENCES shifts (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_shift_requests_shift_id
  ON shift_requests (shift_id);

CREATE TABLE weekly_schedules (
  id INT NOT NULL AUTO_INCREMENT,
  week_start_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_weekly_schedules_week_start_date
    UNIQUE (week_start_date)
) ENGINE=InnoDB;

CREATE TABLE schedule_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  schedule_id INT NOT NULL,
  shift_id INT NOT NULL,
  employee_id INT NOT NULL,
  job_role VARCHAR(30) NOT NULL DEFAULT 'waiter',
  assigned_strength_score DECIMAL(6,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_schedule_assignments_schedule_shift_role_employee
    UNIQUE (schedule_id, shift_id, job_role, employee_id),
  CONSTRAINT chk_schedule_assignments_assigned_strength_score
    CHECK (assigned_strength_score >= 0),
  CONSTRAINT fk_schedule_assignments_schedule_id
    FOREIGN KEY (schedule_id) REFERENCES weekly_schedules (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_schedule_assignments_shift_id
    FOREIGN KEY (shift_id) REFERENCES shifts (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_schedule_assignments_employee_id
    FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_schedule_assignments_shift_id
  ON schedule_assignments (shift_id);

CREATE INDEX idx_schedule_assignments_employee_id
  ON schedule_assignments (employee_id);

CREATE TABLE shift_performance_logs (
  id INT NOT NULL AUTO_INCREMENT,
  shift_date DATE NOT NULL,
  shift_type ENUM('morning', 'evening') NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  is_weekend BOOLEAN NOT NULL,
  expected_customer_load INT UNSIGNED NOT NULL,
  actual_waiters_count INT UNSIGNED NOT NULL,
  actual_strength_score DECIMAL(6,2) NOT NULL,
  manager_rating DECIMAL(3,1) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_shift_performance_logs_shift_date_type
    UNIQUE (shift_date, shift_type),
  CONSTRAINT chk_shift_performance_logs_day_of_week
    CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_shift_performance_logs_expected_customer_load
    CHECK (expected_customer_load BETWEEN 1 AND 1000),
  CONSTRAINT chk_shift_performance_logs_actual_strength_score
    CHECK (actual_strength_score BETWEEN 0 AND 100),
  CONSTRAINT chk_shift_performance_logs_manager_rating
    CHECK (manager_rating BETWEEN 1 AND 10),
  INDEX idx_shift_performance_logs_shift_pattern
    (day_of_week, shift_type, is_weekend)
) ENGINE=InnoDB;

CREATE TABLE shift_ml_predictions (
  id INT NOT NULL AUTO_INCREMENT,
  shift_id INT NOT NULL,
  recommended_waiters INT UNSIGNED NOT NULL,
  recommended_strength_score DECIMAL(6,2) NOT NULL,
  model_version VARCHAR(80) NOT NULL DEFAULT 'shift_requirements_demo_v1',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_shift_ml_predictions_shift_id
    UNIQUE (shift_id),
  CONSTRAINT chk_shift_ml_predictions_recommended_waiters
    CHECK (recommended_waiters > 0),
  CONSTRAINT chk_shift_ml_predictions_recommended_strength_score
    CHECK (recommended_strength_score BETWEEN 0 AND 100),
  CONSTRAINT fk_shift_ml_predictions_shift_id
    FOREIGN KEY (shift_id) REFERENCES shifts (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;
