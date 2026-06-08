package com.labelhub.backend.auth;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AuthRepository {

  private static final List<String> ALL_PERMISSIONS = List.of(
      "admin:manage",
      "ai_model:manage",
      "ai_review:manage",
      "annotation:submit",
      "assignment:claim",
      "auth:login",
      "dataset:manage",
      "export:manage",
      "file:manage",
      "human_review:manage",
      "schema:manage",
      "task:manage",
      "user:read:self");

  private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.of(
      "owner", List.of(
          "auth:login",
          "user:read:self",
          "task:manage",
          "dataset:manage",
          "schema:manage",
          "export:manage",
          "file:manage",
          "ai_review:manage",
          "ai_model:manage"),
      "labeler", List.of(
          "auth:login",
          "user:read:self",
          "assignment:claim",
          "annotation:submit",
          "file:manage"),
      "reviewer", List.of(
          "auth:login",
          "user:read:self",
          "human_review:manage",
          "ai_review:manage",
          "file:manage"),
      "ai_reviewer", List.of(
          "ai_review:manage",
          "ai_model:manage"),
      "system_agent", List.of(
          "ai_review:manage",
          "file:manage"),
      "admin", ALL_PERMISSIONS);

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
        WHERE JSON_CONTAINS(COALESCE(u.roles_json, JSON_ARRAY()), JSON_QUOTE(?))
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
        SELECT role_code
        FROM users u
        JOIN JSON_TABLE(
          COALESCE(u.roles_json, JSON_ARRAY()),
          '$[*]' COLUMNS (role_code VARCHAR(64) PATH '$')
        ) roles
        WHERE u.id = ?
        ORDER BY role_code
        """,
        String.class,
        userId);
  }

  public List<String> findPermissionCodes(long userId) {
    Set<String> permissions = new LinkedHashSet<>();
    for (String role : findRoleCodes(userId)) {
      permissions.addAll(ROLE_PERMISSIONS.getOrDefault(role, List.of()));
    }
    return permissions.stream().sorted().toList();
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
    long userId = insertUser(username, displayName, passwordHash, List.of(roleCode));
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

  public void upsertDemoUser(String username, String displayName, String passwordHash, String... roleCodes) {
    Optional<UserAccount> existingUser = findUserByUsername(username);
    long userId = existingUser
        .map(UserAccount::id)
        .orElseGet(() -> insertUser(username, displayName, passwordHash, List.of(roleCodes)));

    if (existingUser.isPresent()) {
      jdbcTemplate.update(
          """
          UPDATE users
          SET name = ?,
              password_hash = ?,
              roles_json = ?,
              status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          """,
          displayName,
          passwordHash,
          writeRolesJson(List.of(roleCodes)),
          userId);
    }
  }

  private long insertUser(String username, String displayName, String passwordHash, List<String> roleCodes) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO users (username, name, email, password_hash, status, roles_json)
          VALUES (?, ?, NULL, ?, 'active', ?)
          """,
          new String[] {"id"});
      statement.setString(1, username);
      statement.setString(2, displayName);
      statement.setString(3, passwordHash);
      statement.setString(4, writeRolesJson(roleCodes));
      return statement;
    }, keyHolder);

    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create demo user");
    }
    return key.longValue();
  }

  private String writeRolesJson(List<String> roleCodes) {
    List<String> roles = new ArrayList<>();
    for (String roleCode : roleCodes) {
      if (roleCode != null && !roleCode.isBlank() && !roles.contains(roleCode.trim())) {
        roles.add(roleCode.trim());
      }
    }
    return roles.stream()
        .map(role -> "\"" + role.replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
        .collect(java.util.stream.Collectors.joining(",", "[", "]"));
  }

  private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }
}
