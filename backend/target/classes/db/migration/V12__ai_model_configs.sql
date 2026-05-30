-- Persist encrypted LLM model configuration used by the independent AI Agent.

USE labelhub;

CREATE TABLE IF NOT EXISTS ai_model_configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_name VARCHAR(128) NOT NULL,
  notes VARCHAR(512) DEFAULT NULL,
  license_url VARCHAR(512) DEFAULT NULL,
  api_base_url VARCHAR(512) NOT NULL,
  use_full_url TINYINT(1) NOT NULL DEFAULT 0,
  model_name VARCHAR(128) NOT NULL,
  reasoning_effort VARCHAR(32) NOT NULL DEFAULT 'high',
  wire_api VARCHAR(32) NOT NULL DEFAULT 'responses',
  encrypted_api_key TEXT NOT NULL,
  api_key_mask VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED DEFAULT NULL,
  updated_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_model_configs_status (status, updated_at),
  KEY idx_ai_model_configs_created_by (created_by),
  KEY idx_ai_model_configs_updated_by (updated_by),
  CONSTRAINT fk_ai_model_configs_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_model_configs_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (permission_code, permission_name, description)
VALUES
  ('ai_model:manage', 'Manage AI model config', 'Configure encrypted LLM provider settings for AI review');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_code = 'ai_model:manage'
WHERE r.role_code IN ('owner', 'ai_reviewer');
