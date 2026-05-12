CREATE TABLE IF NOT EXISTS shift_performance_logs (
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

CREATE TABLE IF NOT EXISTS shift_ml_predictions (
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
