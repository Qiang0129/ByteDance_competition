-- Allow the same labeler to annotate the same dataset item in different tasks.
-- The old unique key only used (item_id, labeler_id), which breaks when a dataset
-- is reused by a new task after the previous task's assignments are voided.

USE labelhub;

SET @new_assignment_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'uk_assignments_task_item_labeler'
);
SET @sql := IF(
  @new_assignment_unique_exists = 0,
  'ALTER TABLE assignments ADD UNIQUE KEY uk_assignments_task_item_labeler (task_id, item_id, labeler_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @assignment_item_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'idx_assignments_item_id'
);
SET @sql := IF(
  @assignment_item_index_exists = 0,
  'ALTER TABLE assignments ADD INDEX idx_assignments_item_id (item_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @old_assignment_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'uk_assignments_item_labeler'
);
SET @sql := IF(
  @old_assignment_unique_exists > 0,
  'ALTER TABLE assignments DROP INDEX uk_assignments_item_labeler',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
