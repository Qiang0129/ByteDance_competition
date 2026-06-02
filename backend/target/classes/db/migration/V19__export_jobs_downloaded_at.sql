-- Track whether an export file has been downloaded at least once.

USE labelhub;

SET @export_downloaded_at_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'export_jobs'
    AND COLUMN_NAME = 'downloaded_at'
);
SET @sql := IF(
  @export_downloaded_at_exists = 0,
  'ALTER TABLE export_jobs ADD COLUMN downloaded_at DATETIME NULL AFTER completed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
