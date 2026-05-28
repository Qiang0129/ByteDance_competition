-- Soft-delete schema versions without breaking existing task and annotation references.

USE labelhub;

SET @deleted_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'task_schema_versions'
    AND COLUMN_NAME = 'deleted_at'
);
SET @sql := IF(
  @deleted_at_exists = 0,
  'ALTER TABLE task_schema_versions ADD COLUMN deleted_at DATETIME NULL AFTER published_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @deleted_at_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'task_schema_versions'
    AND INDEX_NAME = 'idx_task_schema_versions_deleted_at'
);
SET @sql := IF(
  @deleted_at_index_exists = 0,
  'ALTER TABLE task_schema_versions ADD INDEX idx_task_schema_versions_deleted_at (deleted_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
