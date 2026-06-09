-- Store the labeler reward amount on each assignment so historical rewards do
-- not change when an owner edits the task reward rule later.

USE labelhub;

SET @reward_amount_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND COLUMN_NAME = 'reward_amount'
);
SET @sql := IF(
  @reward_amount_exists = 0,
  'ALTER TABLE assignments ADD COLUMN reward_amount DECIMAL(10, 4) NOT NULL DEFAULT 0 AFTER labeler_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE assignments a
JOIN tasks t ON t.id = a.task_id
SET a.reward_amount = COALESCE(
  CAST(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.rewardPerItem')) AS DECIMAL(10, 4)),
  0
)
WHERE a.reward_amount = 0;

SET @reward_month_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'idx_assignments_labeler_reward_month'
);
SET @sql := IF(
  @reward_month_index_exists = 0,
  'ALTER TABLE assignments ADD INDEX idx_assignments_labeler_reward_month (labeler_id, claimed_at, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
