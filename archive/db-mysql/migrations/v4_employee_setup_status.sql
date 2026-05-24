ALTER TABLE employees
  ADD COLUMN setup_status ENUM('pending', 'complete') NOT NULL DEFAULT 'complete' AFTER is_active;
