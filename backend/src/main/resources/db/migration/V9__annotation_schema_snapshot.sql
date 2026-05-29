-- Store the schema used at submission time so historical annotations can be
-- rendered even after a schema is withdrawn and edited in place.

USE labelhub;

SET @schema_snapshot_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'annotations'
    AND COLUMN_NAME = 'schema_snapshot_json'
);
SET @sql := IF(
  @schema_snapshot_exists = 0,
  'ALTER TABLE annotations ADD COLUMN schema_snapshot_json JSON NULL AFTER schema_version_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE annotations an
JOIN task_schema_versions tsv ON tsv.id = an.schema_version_id
SET an.schema_snapshot_json = tsv.schema_json
WHERE an.schema_snapshot_json IS NULL;
