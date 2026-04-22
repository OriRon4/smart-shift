CREATE TABLE employees (
  id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'waiter',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
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
    CHECK (seniority_months >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_employees_role_is_active
  ON employees (role, is_active);

CREATE TABLE shifts (
  id INT NOT NULL AUTO_INCREMENT,
  shift_date DATE NOT NULL,
  shift_type ENUM('morning', 'evening') NOT NULL,
  required_waiters INT UNSIGNED NOT NULL,
  required_strength_score DECIMAL(6,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_shifts_shift_date_shift_type
    UNIQUE (shift_date, shift_type),
  CONSTRAINT chk_shifts_required_waiters
    CHECK (required_waiters > 0),
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
  PRIMARY KEY (id),
  CONSTRAINT uq_weekly_schedules_week_start_date
    UNIQUE (week_start_date)
) ENGINE=InnoDB;

CREATE TABLE schedule_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  schedule_id INT NOT NULL,
  shift_id INT NOT NULL,
  employee_id INT NOT NULL,
  assigned_strength_score DECIMAL(6,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_schedule_assignments_schedule_shift_employee
    UNIQUE (schedule_id, shift_id, employee_id),
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
