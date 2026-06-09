USE labelhub;

CREATE TABLE IF NOT EXISTS owner_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash CHAR(64) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  used_by BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_owner_invitations_token_hash (token_hash),
  KEY idx_owner_invitations_created_by (created_by),
  KEY idx_owner_invitations_expires_at (expires_at),
  KEY idx_owner_invitations_used_by (used_by),
  CONSTRAINT fk_owner_invitations_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_owner_invitations_used_by FOREIGN KEY (used_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
