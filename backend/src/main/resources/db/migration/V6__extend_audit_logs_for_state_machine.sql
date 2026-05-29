-- Extend audit logs so every workflow state transition is traceable.

USE labelhub;

SET @operator_role_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'operator_role'
);
SET @sql := IF(
  @operator_role_exists = 0,
  'ALTER TABLE audit_logs ADD COLUMN operator_role VARCHAR(64) NULL AFTER operator_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @from_state_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'from_state'
);
SET @sql := IF(
  @from_state_exists = 0,
  'ALTER TABLE audit_logs ADD COLUMN from_state VARCHAR(64) NULL AFTER action',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @to_state_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'to_state'
);
SET @sql := IF(
  @to_state_exists = 0,
  'ALTER TABLE audit_logs ADD COLUMN to_state VARCHAR(64) NULL AFTER from_state',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @reason_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'reason'
);
SET @sql := IF(
  @reason_exists = 0,
  'ALTER TABLE audit_logs ADD COLUMN reason TEXT NULL AFTER to_state',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @snapshot_json_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'snapshot_json'
);
SET @sql := IF(
  @snapshot_json_exists = 0,
  'ALTER TABLE audit_logs ADD COLUMN snapshot_json JSON NULL AFTER after_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @state_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_logs_state_transition'
);
SET @sql := IF(
  @state_index_exists = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_logs_state_transition (entity_type, from_state, to_state)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
