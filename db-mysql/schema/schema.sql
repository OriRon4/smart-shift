CREATE TABLE employees (
  id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('waiter', 'bartender', 'manager', 'shift_manager') NOT NULL DEFAULT 'waiter',
  seniority_months INT NOT NULL DEFAULT 0,
  professionalism TINYINT UNSIGNED NOT NULL DEFAULT 5,
  responsibility TINYINT UNSIGNED NOT NULL DEFAULT 5,
  pressure_handling TINYINT UNSIGNED NOT NULL DEFAULT 5,
  potential TINYINT UNSIGNED NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  CONSTRAINT chk_employees_seniority_non_negative CHECK (seniority_months >= 0),
  CONSTRAINT chk_employees_professionalism CHECK (professionalism BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_responsibility CHECK (responsibility BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_pressure_handling CHECK (pressure_handling BETWEEN 0 AND 10),
  CONSTRAINT chk_employees_potential CHECK (potential BETWEEN 0 AND 10)
);

CREATE TABLE shifts (
  id INT NOT NULL AUTO_INCREMENT,
  shift_date DATE NOT NULL,
  shift_type ENUM('morning', 'evening') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  required_waiters INT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_shifts_date_type UNIQUE (shift_date, shift_type),
  CONSTRAINT chk_shifts_required_waiters_positive CHECK (required_waiters > 0)
);

CREATE TABLE shift_requests (
  id INT NOT NULL AUTO_INCREMENT,
  employee_id INT NOT NULL,
  shift_id INT NOT NULL,
  can_work BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  CONSTRAINT uq_shift_requests_employee_shift UNIQUE (employee_id, shift_id),
  CONSTRAINT fk_shift_requests_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id),
  CONSTRAINT fk_shift_requests_shift
    FOREIGN KEY (shift_id) REFERENCES shifts (id)
);

CREATE TABLE weekly_schedules (
  id INT NOT NULL AUTO_INCREMENT,
  week_start_date DATE NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(100) DEFAULT NULL,
  status ENUM('draft', 'final') NOT NULL DEFAULT 'draft',
  PRIMARY KEY (id),
  CONSTRAINT uq_weekly_schedules_week_start UNIQUE (week_start_date)
);

CREATE TABLE schedule_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  schedule_id INT NOT NULL,
  shift_id INT NOT NULL,
  employee_id INT NOT NULL,
  assignment_score DECIMAL(5, 2) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uq_schedule_assignments_schedule_shift_employee
    UNIQUE (schedule_id, shift_id, employee_id),
  CONSTRAINT fk_schedule_assignments_schedule
    FOREIGN KEY (schedule_id) REFERENCES weekly_schedules (id),
  CONSTRAINT fk_schedule_assignments_shift
    FOREIGN KEY (shift_id) REFERENCES shifts (id),
  CONSTRAINT fk_schedule_assignments_employee
    FOREIGN KEY (employee_id) REFERENCES employees (id)
);
