package com.labelhub.backend.auth;

import java.util.List;
import java.util.Optional;
import java.time.LocalDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AuthRepository {

  private final JdbcTemplate jdbcTemplate;

  public AuthRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<UserAccount> findUserByUsername(String username) {
    List<UserAccount> users = jdbcTemplate.query(
        """
        SELECT id, username, name, email, password_hash, status
        FROM users
        WHERE username = ? AND deleted_at IS NULL
        """,
        (rs, rowNum) -> new UserAccount(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("name"),
            rs.getString("email"),
            rs.getString("password_hash"),
            rs.getString("status")),
        username);
    return users.stream().findFirst();
  }

  public Optional<UserAccount> findUserById(long userId) {
    List<UserAccount> users = jdbcTemplate.query(
        """
        SELECT id, username, name, email, password_hash, status
        FROM users
        WHERE id = ? AND deleted_at IS NULL
        """,
        (rs, rowNum) -> new UserAccount(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("name"),
            rs.getString("email"),
            rs.getString("password_hash"),
            rs.getString("status")),
        userId);
    return users.stream().findFirst();
  }

  public List<UserAccount> listUsersByRoleCode(String roleCode) {
    return jdbcTemplate.query(
        """
        SELECT DISTINCT u.id, u.username, u.name, u.email, u.password_hash, u.status
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code = ?
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        ORDER BY u.name ASC, u.username ASC
        """,
        (rs, rowNum) -> new UserAccount(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("name"),
            rs.getString("email"),
            rs.getString("password_hash"),
            rs.getString("status")),
        roleCode);
  }

  public List<String> findRoleCodes(long userId) {
    return jdbcTemplate.queryForList(
        """
        SELECT r.role_code
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
        ORDER BY r.role_code
        """,
        String.class,
        userId);
  }

  public List<String> findPermissionCodes(long userId) {
    return jdbcTemplate.queryForList(
        """
        SELECT DISTINCT p.permission_code
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?
        ORDER BY p.permission_code
        """,
        String.class,
        userId);
  }

  public void updateLastLoginAt(long userId) {
    jdbcTemplate.update("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", userId);
  }

  public boolean usernameExists(String username) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM users WHERE username = ? AND deleted_at IS NULL",
        Integer.class,
        username);
    return count != null && count > 0;
  }

  public UserAccount createUser(String username, String displayName, String passwordHash, String roleCode) {
    long userId = insertUser(username, displayName, passwordHash);
    grantRole(userId, roleCode);
    return findUserById(userId)
        .orElseThrow(() -> new IllegalStateException("failed to load created user"));
  }

  public long createReviewerInvitation(String tokenHash, long createdBy, LocalDateTime expiresAt) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO reviewer_invitations (token_hash, created_by, expires_at)
          VALUES (?, ?, ?)
          """,
          new String[] {"id"});
      statement.setString(1, tokenHash);
      statement.setLong(2, createdBy);
      statement.setObject(3, expiresAt);
      return statement;
    }, keyHolder);

    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create reviewer invitation");
    }
    return key.longValue();
  }

  public Optional<ReviewerInvitationRecord> findReviewerInvitationByTokenHash(String tokenHash) {
    List<ReviewerInvitationRecord> records = jdbcTemplate.query(
        """
        SELECT id, token_hash, created_by, expires_at, used_at, used_by
        FROM reviewer_invitations
        WHERE token_hash = ?
        """,
        (rs, rowNum) -> new ReviewerInvitationRecord(
            rs.getLong("id"),
            rs.getString("token_hash"),
            rs.getLong("created_by"),
            rs.getObject("expires_at", LocalDateTime.class),
            rs.getObject("used_at", LocalDateTime.class),
            nullableLong(rs, "used_by")),
        tokenHash);
    return records.stream().findFirst();
  }

  public int markReviewerInvitationUsed(long invitationId, long userId) {
    return jdbcTemplate.update(
        """
        UPDATE reviewer_invitations
        SET used_at = CURRENT_TIMESTAMP, used_by = ?
        WHERE id = ? AND used_at IS NULL
        """,
        userId,
        invitationId);
  }

  private void grantRole(long userId, String roleCode) {
    jdbcTemplate.update(
        """
        INSERT INTO user_roles (user_id, role_id)
        SELECT ?, id FROM roles WHERE role_code = ?
        """,
        userId,
        roleCode);
  }

  public void upsertDemoUser(String username, String displayName, String passwordHash, String... roleCodes) {
    Optional<UserAccount> existingUser = findUserByUsername(username);
    long userId = existingUser
        .map(UserAccount::id)
        .orElseGet(() -> insertUser(username, displayName, passwordHash));

    if (existingUser.isPresent()) {
      jdbcTemplate.update(
          """
          UPDATE users
          SET name = ?, password_hash = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          """,
          displayName,
          passwordHash,
          userId);
    }

    for (String roleCode : roleCodes) {
      jdbcTemplate.update(
          """
          INSERT IGNORE INTO user_roles (user_id, role_id)
          SELECT ?, id FROM roles WHERE role_code = ?
          """,
          userId,
          roleCode);
    }
  }

  private long insertUser(String username, String displayName, String passwordHash) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO users (username, name, email, password_hash, status)
          VALUES (?, ?, NULL, ?, 'active')
          """,
          new String[] {"id"});
      statement.setString(1, username);
      statement.setString(2, displayName);
      statement.setString(3, passwordHash);
      return statement;
    }, keyHolder);

    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create demo user");
    }
    return key.longValue();
  }

  private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }
}
