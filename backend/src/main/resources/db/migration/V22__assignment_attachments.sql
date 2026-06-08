CREATE TABLE IF NOT EXISTS assignment_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(128) NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_assignment_attachments_assignment_field_file (assignment_id, field_name, file_id),
  KEY idx_assignment_attachments_assignment_field (assignment_id, field_name),
  KEY idx_assignment_attachments_file (file_id),
  KEY idx_assignment_attachments_uploaded_by (uploaded_by),
  CONSTRAINT fk_assignment_attachments_assignment FOREIGN KEY (assignment_id) REFERENCES assignments (id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_attachments_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignment_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
