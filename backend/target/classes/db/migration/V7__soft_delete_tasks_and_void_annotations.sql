-- Soft-delete tasks while preserving assignments and annotations for audit.

USE labelhub;

SET @task_deleted_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND COLUMN_NAME = 'deleted_at'
);
SET @sql := IF(
  @task_deleted_at_exists = 0,
  'ALTER TABLE tasks ADD COLUMN deleted_at DATETIME NULL AFTER published_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @task_deleted_at_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND INDEX_NAME = 'idx_tasks_deleted_at'
);
SET @sql := IF(
  @task_deleted_at_index_exists = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_deleted_at (deleted_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
