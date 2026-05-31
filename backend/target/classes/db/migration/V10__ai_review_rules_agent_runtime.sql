-- Add AI review rules and runtime metadata for the independent AI Agent.

USE labelhub;

CREATE TABLE IF NOT EXISTS ai_review_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  scope_task_id BIGINT UNSIGNED DEFAULT NULL,
  prompt_template MEDIUMTEXT NOT NULL,
  dimensions_json JSON NOT NULL,
  pass_threshold DECIMAL(10, 4) NOT NULL DEFAULT 80.0000,
  need_human_threshold DECIMAL(10, 4) NOT NULL DEFAULT 70.0000,
  max_retry INT UNSIGNED NOT NULL DEFAULT 2,
  retry_backoff_sec INT UNSIGNED NOT NULL DEFAULT 30,
  status VARCHAR(32) NOT NULL DEFAULT 'enabled',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_ai_review_rules_status (status, deleted_at),
  KEY idx_ai_review_rules_scope_task (scope_task_id),
  KEY idx_ai_review_rules_created_by (created_by),
  CONSTRAINT fk_ai_review_rules_task FOREIGN KEY (scope_task_id) REFERENCES tasks (id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_review_rules_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @job_rule_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND COLUMN_NAME = 'rule_id'
);
SET @sql := IF(
  @job_rule_id_exists = 0,
  'ALTER TABLE ai_review_jobs ADD COLUMN rule_id BIGINT UNSIGNED NULL AFTER job_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @job_rule_snapshot_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND COLUMN_NAME = 'rule_snapshot_json'
);
SET @sql := IF(
  @job_rule_snapshot_exists = 0,
  'ALTER TABLE ai_review_jobs ADD COLUMN rule_snapshot_json JSON NULL AFTER rule_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @job_rule_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND INDEX_NAME = 'idx_ai_review_jobs_rule'
);
SET @sql := IF(
  @job_rule_index_exists = 0,
  'ALTER TABLE ai_review_jobs ADD INDEX idx_ai_review_jobs_rule (rule_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @job_rule_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_jobs'
    AND CONSTRAINT_NAME = 'fk_ai_review_jobs_rule'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(
  @job_rule_fk_exists = 0,
  'ALTER TABLE ai_review_jobs ADD CONSTRAINT fk_ai_review_jobs_rule FOREIGN KEY (rule_id) REFERENCES ai_review_rules (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @result_total_score_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_results'
    AND COLUMN_NAME = 'total_score'
);
SET @sql := IF(
  @result_total_score_exists = 0,
  'ALTER TABLE ai_review_results ADD COLUMN total_score DECIMAL(10, 4) NULL AFTER scores_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @result_risk_flags_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_results'
    AND COLUMN_NAME = 'risk_flags_json'
);
SET @sql := IF(
  @result_risk_flags_exists = 0,
  'ALTER TABLE ai_review_results ADD COLUMN risk_flags_json JSON NULL AFTER comment',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @result_evidence_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_results'
    AND COLUMN_NAME = 'evidence_json'
);
SET @sql := IF(
  @result_evidence_exists = 0,
  'ALTER TABLE ai_review_results ADD COLUMN evidence_json JSON NULL AFTER risk_flags_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @result_model_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_results'
    AND COLUMN_NAME = 'model_name'
);
SET @sql := IF(
  @result_model_exists = 0,
  'ALTER TABLE ai_review_results ADD COLUMN model_name VARCHAR(128) NULL AFTER response_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @result_latency_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_review_results'
    AND COLUMN_NAME = 'latency_ms'
);
SET @sql := IF(
  @result_latency_exists = 0,
  'ALTER TABLE ai_review_results ADD COLUMN latency_ms INT UNSIGNED NULL AFTER model_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO roles (role_code, role_name, description)
VALUES
  ('ai_reviewer', 'AI Reviewer', 'AI review operator: inspect rules, jobs, results, and retries'),
  ('system_agent', 'System Agent', 'System account for AI review jobs and asynchronous writeback');

INSERT IGNORE INTO permissions (permission_code, permission_name, description)
VALUES
  ('ai_review:manage', 'Manage AI reviews', 'Create, inspect, and retry AI review jobs');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_code = 'ai_review:manage'
WHERE r.role_code IN ('ai_reviewer', 'system_agent', 'owner', 'reviewer');

INSERT INTO ai_review_rules
  (name, prompt_template, dimensions_json, pass_threshold, need_human_threshold,
   max_retry, retry_backoff_sec, status, created_by)
SELECT
  '默认质量预审规则',
  '你是 LabelHub 的 AI 预审员。请根据题目原始数据 {{rawPayload}}、标注答案 {{answer}}、表单 schema {{schema}} 和规则 {{rule}} 进行质量审核。按 0~100 分为每个维度评分，给出总分、风险标签、证据和 PASS / NEED_HUMAN_REVIEW / REJECT 判定。',
  CAST('[{"key":"relevance","label":"相关性","weight":0.35,"maxScore":100},{"key":"accuracy","label":"准确性","weight":0.35,"maxScore":100},{"key":"format_compliance","label":"格式合规","weight":0.2,"maxScore":100},{"key":"safety","label":"安全风险","weight":0.1,"maxScore":100}]' AS JSON),
  80.0000,
  70.0000,
  2,
  30,
  'enabled',
  NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM ai_review_rules
  WHERE name = '默认质量预审规则'
    AND deleted_at IS NULL
);
