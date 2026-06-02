-- Store export execution metadata for downloadable Owner exports.

USE labelhub;

SET @export_started_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'export_jobs'
    AND COLUMN_NAME = 'started_at'
);
SET @sql := IF(
  @export_started_at_exists = 0,
  'ALTER TABLE export_jobs ADD COLUMN started_at DATETIME NULL AFTER progress',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @export_completed_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'export_jobs'
    AND COLUMN_NAME = 'completed_at'
);
SET @sql := IF(
  @export_completed_at_exists = 0,
  'ALTER TABLE export_jobs ADD COLUMN completed_at DATETIME NULL AFTER started_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @export_exported_count_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'export_jobs'
    AND COLUMN_NAME = 'exported_count'
);
SET @sql := IF(
  @export_exported_count_exists = 0,
  'ALTER TABLE export_jobs ADD COLUMN exported_count INT UNSIGNED NULL AFTER file_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

