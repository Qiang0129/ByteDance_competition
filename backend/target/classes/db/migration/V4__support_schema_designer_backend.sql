-- Support standalone Schema Designer drafts and template updates.
-- Safe to run once on databases initialized before this backend module.

USE labelhub;

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'task_schema_versions'
    AND CONSTRAINT_NAME = 'fk_task_schema_versions_task'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(
  @fk_exists > 0,
  'ALTER TABLE task_schema_versions DROP FOREIGN KEY fk_task_schema_versions_task',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE task_schema_versions
  MODIFY task_id BIGINT UNSIGNED DEFAULT NULL;

SET @updated_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'task_schema_versions'
    AND COLUMN_NAME = 'updated_at'
);
SET @sql := IF(
  @updated_at_exists = 0,
  'ALTER TABLE task_schema_versions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'task_schema_versions'
    AND CONSTRAINT_NAME = 'fk_task_schema_versions_task'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE task_schema_versions ADD CONSTRAINT fk_task_schema_versions_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
