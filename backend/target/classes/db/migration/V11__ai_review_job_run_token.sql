-- Add execution token support for cancelling and safely re-running AI review jobs.

USE labelhub;

SET @run_token_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND COLUMN_NAME = 'run_token'
);
SET @sql := IF(
  @run_token_exists = 0,
  'ALTER TABLE ai_review_jobs ADD COLUMN run_token VARCHAR(64) NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cancel_reason_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND COLUMN_NAME = 'cancel_reason'
);
SET @sql := IF(
  @cancel_reason_exists = 0,
  'ALTER TABLE ai_review_jobs ADD COLUMN cancel_reason TEXT NULL AFTER error_summary',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @run_token_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND INDEX_NAME = 'idx_ai_review_jobs_run_token'
);
SET @sql := IF(
  @run_token_index_exists = 0,
  'ALTER TABLE ai_review_jobs ADD INDEX idx_ai_review_jobs_run_token (run_token)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
