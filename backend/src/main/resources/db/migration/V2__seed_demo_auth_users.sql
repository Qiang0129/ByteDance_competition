-- Demo users for local Phase 1 authentication verification.
-- Passwords are BCrypt hashes for owner123, labeler123, and reviewer123.

USE labelhub;

INSERT INTO users (username, name, email, password_hash, status)
VALUES
  ('owner', 'Owner Demo', NULL, '$2b$10$OvlGhLwNg4PFONfwteVs5OxsV.QaKIcf1E5Kf9yo7MCXKZkx9Hb9i', 'active'),
  ('labeler', 'Labeler Demo', NULL, '$2b$10$O9rDMrTt9xGRCGMs9ycfp.6XUCE82u51ymh9LC3pj612PgB85uqNK', 'active'),
  ('reviewer', 'Reviewer Demo', NULL, '$2b$10$VHH4k9fv0Dr/qSvNgvL5iuBDiJdvg4tZItgLybfln27sjHEfNuHEO', 'active')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  password_hash = VALUES(password_hash),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP;

INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.role_code = 'owner'
WHERE u.username = 'owner';

INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.role_code = 'labeler'
WHERE u.username = 'labeler';

INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.role_code = 'reviewer'
WHERE u.username = 'reviewer';
