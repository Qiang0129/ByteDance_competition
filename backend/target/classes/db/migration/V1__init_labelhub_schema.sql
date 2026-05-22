-- LabelHub initial MySQL schema.
-- This script is idempotent for local bootstrap and can be reused by backend migration tooling.

CREATE DATABASE IF NOT EXISTS labelhub
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE labelhub;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  last_login_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_code VARCHAR(64) NOT NULL,
  role_name VARCHAR(128) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_code (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  permission_code VARCHAR(128) NOT NULL,
  permission_name VARCHAR(128) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permissions_code (permission_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_roles_user_role (user_id, role_id),
  KEY idx_user_roles_role_id (role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_permissions_role_permission (role_id, permission_id),
  KEY idx_role_permissions_permission_id (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  storage_key VARCHAR(512) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) DEFAULT NULL,
  size BIGINT UNSIGNED DEFAULT NULL,
  checksum VARCHAR(128) DEFAULT NULL,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_files_storage_key (storage_key),
  KEY idx_files_created_by (created_by),
  CONSTRAINT fk_files_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  owner_id BIGINT UNSIGNED NOT NULL,
  quota INT UNSIGNED DEFAULT NULL,
  deadline DATETIME DEFAULT NULL,
  reward_rule JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_tasks_owner_status (owner_id, status),
  KEY idx_tasks_deadline (deadline),
  CONSTRAINT fk_tasks_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_schema_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  schema_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_schema_versions_task_version (task_id, version),
  KEY idx_task_schema_versions_status (status),
  KEY idx_task_schema_versions_created_by (created_by),
  CONSTRAINT fk_task_schema_versions_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_schema_versions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS datasets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  file_id BIGINT UNSIGNED DEFAULT NULL,
  dataset_type VARCHAR(64) DEFAULT NULL,
  import_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  success_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_summary TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_datasets_task_status (task_id, import_status),
  KEY idx_datasets_file_id (file_id),
  CONSTRAINT fk_datasets_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_datasets_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  dataset_id BIGINT UNSIGNED NOT NULL,
  item_key VARCHAR(128) DEFAULT NULL,
  raw_payload JSON NOT NULL,
  media_type VARCHAR(64) DEFAULT NULL,
  media_url VARCHAR(1024) DEFAULT NULL,
  content_markdown MEDIUMTEXT DEFAULT NULL,
  item_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_items_task_status (task_id, item_status),
  KEY idx_items_dataset_status (dataset_id, item_status),
  KEY idx_items_item_key (item_key),
  CONSTRAINT fk_items_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_items_dataset FOREIGN KEY (dataset_id) REFERENCES datasets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  labeler_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'claimed',
  locked_until DATETIME DEFAULT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_assignments_item_labeler (item_id, labeler_id),
  KEY idx_assignments_task_status (task_id, status),
  KEY idx_assignments_labeler_status (labeler_id, status),
  KEY idx_assignments_locked_until (locked_until),
  CONSTRAINT fk_assignments_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_assignments_item FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE,
  CONSTRAINT fk_assignments_labeler FOREIGN KEY (labeler_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS annotations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT UNSIGNED NOT NULL,
  schema_version_id BIGINT UNSIGNED NOT NULL,
  answer_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  revision_no INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_annotations_assignment_revision (assignment_id, revision_no),
  KEY idx_annotations_schema_version_id (schema_version_id),
  KEY idx_annotations_status (status),
  CONSTRAINT fk_annotations_assignment FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE,
  CONSTRAINT fk_annotations_schema_version FOREIGN KEY (schema_version_id) REFERENCES task_schema_versions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT UNSIGNED NOT NULL,
  answer_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_drafts_assignment (assignment_id),
  CONSTRAINT fk_drafts_assignment FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_review_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  annotation_id BIGINT UNSIGNED NOT NULL,
  job_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_summary TEXT DEFAULT NULL,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME DEFAULT NULL,
  finished_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_review_jobs_job_key (job_key),
  KEY idx_ai_review_jobs_status_available (status, available_at),
  KEY idx_ai_review_jobs_annotation (annotation_id),
  CONSTRAINT fk_ai_review_jobs_annotation FOREIGN KEY (annotation_id) REFERENCES annotations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_review_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  scores_json JSON DEFAULT NULL,
  decision VARCHAR(32) DEFAULT NULL,
  comment TEXT DEFAULT NULL,
  prompt_snapshot MEDIUMTEXT DEFAULT NULL,
  response_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_review_results_job (job_id),
  KEY idx_ai_review_results_decision (decision),
  CONSTRAINT fk_ai_review_results_job FOREIGN KEY (job_id) REFERENCES ai_review_jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS human_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  annotation_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  round_no INT UNSIGNED NOT NULL DEFAULT 1,
  decision VARCHAR(32) NOT NULL,
  reason TEXT DEFAULT NULL,
  diff_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_human_reviews_annotation_round (annotation_id, round_no),
  KEY idx_human_reviews_reviewer (reviewer_id),
  KEY idx_human_reviews_decision (decision),
  CONSTRAINT fk_human_reviews_annotation FOREIGN KEY (annotation_id) REFERENCES annotations (id) ON DELETE CASCADE,
  CONSTRAINT fk_human_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED DEFAULT NULL,
  action VARCHAR(64) NOT NULL,
  before_json JSON DEFAULT NULL,
  after_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_entity (entity_type, entity_id),
  KEY idx_audit_logs_operator (operator_id),
  KEY idx_audit_logs_created_at (created_at),
  CONSTRAINT fk_audit_logs_operator FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS export_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  format VARCHAR(32) NOT NULL,
  mapping_json JSON DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  file_id BIGINT UNSIGNED DEFAULT NULL,
  error_summary TEXT DEFAULT NULL,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_export_jobs_task_status (task_id, status),
  KEY idx_export_jobs_file_id (file_id),
  KEY idx_export_jobs_created_by (created_by),
  CONSTRAINT fk_export_jobs_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_export_jobs_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE SET NULL,
  CONSTRAINT fk_export_jobs_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id BIGINT UNSIGNED DEFAULT NULL,
  storage_type VARCHAR(32) NOT NULL DEFAULT 'local',
  object_key VARCHAR(512) NOT NULL,
  url VARCHAR(1024) DEFAULT NULL,
  mime_type VARCHAR(128) DEFAULT NULL,
  size BIGINT UNSIGNED DEFAULT NULL,
  checksum VARCHAR(128) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_file_assets_object_key (object_key),
  KEY idx_file_assets_owner (owner_id),
  CONSTRAINT fk_file_assets_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dataset_import_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dataset_type VARCHAR(64) NOT NULL,
  field_mapping_json JSON NOT NULL,
  media_strategy VARCHAR(64) NOT NULL DEFAULT 'preserve',
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dataset_import_profiles_type (dataset_type),
  KEY idx_dataset_import_profiles_created_by (created_by),
  CONSTRAINT fk_dataset_import_profiles_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (role_code, role_name, description)
VALUES
  ('owner', 'Owner', 'Project owner: manage datasets, tasks, schemas, review configuration, and exports'),
  ('labeler', 'Labeler', 'Labeler: claim assignments, save drafts, and submit annotations'),
  ('reviewer', 'Reviewer', 'Reviewer: review annotations and handle quality feedback'),
  ('admin', 'Admin', 'System administrator: manage users, roles, permissions, and platform settings'),
  ('system_agent', 'System Agent', 'System account for AI review jobs and asynchronous writeback')
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO permissions (permission_code, permission_name, description)
VALUES
  ('auth:login', 'Login', 'Authenticate and obtain current user information'),
  ('user:read:self', 'Read current user', 'Read current user profile and permissions'),
  ('task:manage', 'Manage tasks', 'Create, update, publish, pause, and end tasks'),
  ('dataset:manage', 'Manage datasets', 'Import datasets and inspect dataset items'),
  ('schema:manage', 'Manage schemas', 'Create draft schemas and publish schema versions'),
  ('assignment:claim', 'Claim assignments', 'Claim tasks or items from the marketplace'),
  ('annotation:submit', 'Submit annotations', 'Save drafts and submit annotation answers'),
  ('ai_review:manage', 'Manage AI reviews', 'Create, inspect, and retry AI review jobs'),
  ('human_review:manage', 'Manage human reviews', 'Approve, reject, return, and batch review annotations'),
  ('export:manage', 'Manage exports', 'Create export jobs and download exported files'),
  ('file:manage', 'Manage files', 'Upload, query, and proxy files or media assets'),
  ('admin:manage', 'Admin management', 'Manage platform users, roles, and permissions')
ON DUPLICATE KEY UPDATE
  permission_name = VALUES(permission_name),
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'auth:login', 'user:read:self', 'task:manage', 'dataset:manage', 'schema:manage', 'export:manage', 'file:manage'
)
WHERE r.role_code = 'owner';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'auth:login', 'user:read:self', 'assignment:claim', 'annotation:submit', 'file:manage'
)
WHERE r.role_code = 'labeler';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'auth:login', 'user:read:self', 'human_review:manage', 'ai_review:manage', 'file:manage'
)
WHERE r.role_code = 'reviewer';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
WHERE r.role_code = 'admin';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_code IN ('ai_review:manage', 'file:manage')
WHERE r.role_code = 'system_agent';
