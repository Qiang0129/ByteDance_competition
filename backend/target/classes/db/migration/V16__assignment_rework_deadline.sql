-- Human review returns get an independent 48-hour rework window.

USE labelhub;

SET @resubmit_deadline_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND COLUMN_NAME = 'resubmit_deadline'
);
SET @sql := IF(
  @resubmit_deadline_exists = 0,
  'ALTER TABLE assignments ADD COLUMN resubmit_deadline DATETIME DEFAULT NULL AFTER locked_until',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @resubmit_deadline_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'assignments'
    AND INDEX_NAME = 'idx_assignments_resubmit_deadline'
);
SET @sql := IF(
  @resubmit_deadline_index_exists = 0,
  'ALTER TABLE assignments ADD INDEX idx_assignments_resubmit_deadline (resubmit_deadline)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE assignments a
SET a.resubmit_deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 48 HOUR)
WHERE a.status = 'returned'
  AND a.resubmit_deadline IS NULL
  AND EXISTS (
    SELECT 1
    FROM annotations an
    JOIN human_reviews hr ON hr.annotation_id = an.id
    WHERE an.assignment_id = a.id
      AND an.status <> 'voided'
      AND LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected')
  );
