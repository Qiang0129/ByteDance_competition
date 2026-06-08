-- 压缩当前实现中的冗余表：保留外部接口不变，先迁移数据再删除旧表。

ALTER TABLE users
  ADD COLUMN roles_json JSON NULL AFTER status;

UPDATE users u
LEFT JOIN (
  SELECT
    ur.user_id,
    JSON_ARRAYAGG(r.role_code) AS roles_json
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  GROUP BY ur.user_id
) migrated_roles ON migrated_roles.user_id = u.id
SET u.roles_json = COALESCE(migrated_roles.roles_json, JSON_ARRAY());

ALTER TABLE users
  MODIFY roles_json JSON NOT NULL;

ALTER TABLE ai_review_jobs
  ADD COLUMN scores_json JSON NULL AFTER rule_snapshot_json,
  ADD COLUMN total_score DECIMAL(10, 4) NULL AFTER scores_json,
  ADD COLUMN decision VARCHAR(32) NULL AFTER total_score,
  ADD COLUMN comment TEXT NULL AFTER decision,
  ADD COLUMN risk_flags_json JSON NULL AFTER comment,
  ADD COLUMN evidence_json JSON NULL AFTER risk_flags_json,
  ADD COLUMN prompt_snapshot MEDIUMTEXT NULL AFTER evidence_json,
  ADD COLUMN response_json JSON NULL AFTER prompt_snapshot,
  ADD COLUMN model_name VARCHAR(128) NULL AFTER response_json,
  ADD COLUMN latency_ms INT UNSIGNED NULL AFTER model_name,
  ADD COLUMN result_created_at DATETIME NULL AFTER latency_ms,
  ADD INDEX idx_ai_review_jobs_decision (decision),
  ADD INDEX idx_ai_review_jobs_result_created_at (result_created_at);

UPDATE ai_review_jobs aj
JOIN ai_review_results air ON air.job_id = aj.id
SET aj.scores_json = air.scores_json,
    aj.total_score = air.total_score,
    aj.decision = air.decision,
    aj.comment = air.comment,
    aj.risk_flags_json = air.risk_flags_json,
    aj.evidence_json = air.evidence_json,
    aj.prompt_snapshot = air.prompt_snapshot,
    aj.response_json = air.response_json,
    aj.model_name = air.model_name,
    aj.latency_ms = air.latency_ms,
    aj.result_created_at = air.created_at;

CREATE TABLE task_user_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  allocation_role VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  item_count INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_user_allocations_task_role_user (task_id, allocation_role, user_id),
  KEY idx_task_user_allocations_role_user (allocation_role, user_id),
  CONSTRAINT fk_task_user_allocations_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_user_allocations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO task_user_allocations
  (task_id, allocation_role, user_id, item_count, created_at, updated_at)
SELECT task_id, 'labeler', labeler_id, item_count, created_at, updated_at
FROM task_labeler_allocations;

INSERT INTO task_user_allocations
  (task_id, allocation_role, user_id, item_count, created_at, updated_at)
SELECT task_id, 'reviewer', reviewer_id, item_count, created_at, updated_at
FROM task_reviewer_allocations;

ALTER TABLE task_items
  ADD COLUMN reviewer_id BIGINT UNSIGNED NULL AFTER position_no,
  ADD KEY idx_task_items_reviewer_task (reviewer_id, task_id),
  ADD CONSTRAINT fk_task_items_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE RESTRICT;

UPDATE task_items ti
JOIN task_review_items tri ON tri.task_id = ti.task_id AND tri.item_id = ti.item_id
SET ti.reviewer_id = tri.reviewer_id;

INSERT INTO audit_logs (entity_type, entity_id, action, reason, snapshot_json)
SELECT
  'schema',
  0,
  'schema.archive_unused_table',
  'archive file_assets before compact schema migration',
  JSON_OBJECT(
    'table', 'file_assets',
    'rows', JSON_ARRAYAGG(JSON_OBJECT(
      'id', id,
      'ownerId', owner_id,
      'storageType', storage_type,
      'objectKey', object_key,
      'url', url,
      'mimeType', mime_type,
      'size', size,
      'checksum', checksum,
      'createdAt', created_at
    ))
  )
FROM file_assets
HAVING COUNT(*) > 0;

INSERT INTO audit_logs (entity_type, entity_id, action, reason, snapshot_json)
SELECT
  'schema',
  0,
  'schema.archive_unused_table',
  'archive dataset_import_profiles before compact schema migration',
  JSON_OBJECT(
    'table', 'dataset_import_profiles',
    'rows', JSON_ARRAYAGG(JSON_OBJECT(
      'id', id,
      'datasetType', dataset_type,
      'fieldMappingJson', field_mapping_json,
      'mediaStrategy', media_strategy,
      'createdBy', created_by,
      'createdAt', created_at,
      'updatedAt', updated_at
    ))
  )
FROM dataset_import_profiles
HAVING COUNT(*) > 0;

DROP TABLE IF EXISTS file_assets;
DROP TABLE IF EXISTS dataset_import_profiles;
DROP TABLE IF EXISTS ai_review_results;
DROP TABLE IF EXISTS task_review_items;
DROP TABLE IF EXISTS task_labeler_allocations;
DROP TABLE IF EXISTS task_reviewer_allocations;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
