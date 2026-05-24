ALTER TABLE weekly_schedules
  ADD COLUMN published_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at;
