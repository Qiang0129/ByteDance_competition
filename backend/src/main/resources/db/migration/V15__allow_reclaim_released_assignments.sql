-- Released deadline assignments are kept as voided audit records. The same
-- labeler may reclaim the same item after the owner renews the original task,
-- so the historical unique key must become a non-unique lookup index.

USE labelhub;

SET @assignment_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'uk_assignments_task_item_labeler'
);
SET @sql := IF(
  @assignment_unique_exists > 0,
  'ALTER TABLE assignments DROP INDEX uk_assignments_task_item_labeler',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @assignment_lookup_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'idx_assignments_task_item_labeler'
);
SET @sql := IF(
  @assignment_lookup_exists = 0,
  'ALTER TABLE assignments ADD INDEX idx_assignments_task_item_labeler (task_id, item_id, labeler_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
