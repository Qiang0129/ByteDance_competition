package com.labelhub.backend.ai;

import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AiModelConfigRepository {

  private final JdbcTemplate jdbcTemplate;

  public AiModelConfigRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<AiModelConfigRecord> findActive() {
    return jdbcTemplate.query(
        """
        SELECT
          c.id,
          c.provider_name,
          c.notes,
          c.license_url,
          c.api_base_url,
          c.use_full_url,
          c.model_name,
          c.reasoning_effort,
          c.wire_api,
          c.worker_concurrency,
          c.encrypted_api_key,
          c.api_key_mask,
          c.status,
          c.created_by,
          c.updated_by,
          u.name AS updated_by_name,
          c.created_at,
          c.updated_at
        FROM ai_model_configs c
        LEFT JOIN users u ON u.id = c.updated_by
        WHERE c.status = 'active'
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 1
        """,
        this::mapRecord)
        .stream()
        .findFirst();
  }

  public List<AiModelConfigRecord> findAll() {
    return jdbcTemplate.query(
        """
        SELECT
          c.id,
          c.provider_name,
          c.notes,
          c.license_url,
          c.api_base_url,
          c.use_full_url,
          c.model_name,
          c.reasoning_effort,
          c.wire_api,
          c.worker_concurrency,
          c.encrypted_api_key,
          c.api_key_mask,
          c.status,
          c.created_by,
          c.updated_by,
          u.name AS updated_by_name,
          c.created_at,
          c.updated_at
        FROM ai_model_configs c
        LEFT JOIN users u ON u.id = c.updated_by
        ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.updated_at DESC, c.id DESC
        """,
        this::mapRecord);
  }

  public Optional<AiModelConfigRecord> findById(long configId) {
    return jdbcTemplate.query(
        """
        SELECT
          c.id,
          c.provider_name,
          c.notes,
          c.license_url,
          c.api_base_url,
          c.use_full_url,
          c.model_name,
          c.reasoning_effort,
          c.wire_api,
          c.worker_concurrency,
          c.encrypted_api_key,
          c.api_key_mask,
          c.status,
          c.created_by,
          c.updated_by,
          u.name AS updated_by_name,
          c.created_at,
          c.updated_at
        FROM ai_model_configs c
        LEFT JOIN users u ON u.id = c.updated_by
        WHERE c.id = ?
        """,
        this::mapRecord,
        configId)
        .stream()
        .findFirst();
  }

  public long insertActive(
      String providerName,
      String notes,
      String licenseUrl,
      String apiBaseUrl,
      boolean useFullUrl,
      String modelName,
      String reasoningEffort,
      String wireApi,
      int workerConcurrency,
      String encryptedApiKey,
      String apiKeyMask,
      long operatorId) {
    deactivateActive();
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO ai_model_configs
            (provider_name, notes, license_url, api_base_url, use_full_url, model_name,
             reasoning_effort, wire_api, worker_concurrency, encrypted_api_key, api_key_mask, status, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, providerName);
      statement.setString(2, notes);
      statement.setString(3, licenseUrl);
      statement.setString(4, apiBaseUrl);
      statement.setBoolean(5, useFullUrl);
      statement.setString(6, modelName);
      statement.setString(7, reasoningEffort);
      statement.setString(8, wireApi);
      statement.setInt(9, workerConcurrency);
      statement.setString(10, encryptedApiKey);
      statement.setString(11, apiKeyMask);
      statement.setLong(12, operatorId);
      statement.setLong(13, operatorId);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create ai model config");
    }
    return key.longValue();
  }

  public long insert(
      String providerName,
      String notes,
      String licenseUrl,
      String apiBaseUrl,
      boolean useFullUrl,
      String modelName,
      String reasoningEffort,
      String wireApi,
      int workerConcurrency,
      String encryptedApiKey,
      String apiKeyMask,
      String status,
      long operatorId) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO ai_model_configs
            (provider_name, notes, license_url, api_base_url, use_full_url, model_name,
             reasoning_effort, wire_api, worker_concurrency, encrypted_api_key, api_key_mask, status, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, providerName);
      statement.setString(2, notes);
      statement.setString(3, licenseUrl);
      statement.setString(4, apiBaseUrl);
      statement.setBoolean(5, useFullUrl);
      statement.setString(6, modelName);
      statement.setString(7, reasoningEffort);
      statement.setString(8, wireApi);
      statement.setInt(9, workerConcurrency);
      statement.setString(10, encryptedApiKey);
      statement.setString(11, apiKeyMask);
      statement.setString(12, status);
      statement.setLong(13, operatorId);
      statement.setLong(14, operatorId);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create ai model config");
    }
    return key.longValue();
  }

  public int updateActive(
      long configId,
      String providerName,
      String notes,
      String licenseUrl,
      String apiBaseUrl,
      boolean useFullUrl,
      String modelName,
      String reasoningEffort,
      String wireApi,
      int workerConcurrency,
      String encryptedApiKey,
      String apiKeyMask,
      long operatorId) {
    return jdbcTemplate.update(
        """
        UPDATE ai_model_configs
        SET provider_name = ?,
            notes = ?,
            license_url = ?,
            api_base_url = ?,
            use_full_url = ?,
            model_name = ?,
            reasoning_effort = ?,
            wire_api = ?,
            worker_concurrency = ?,
            encrypted_api_key = ?,
            api_key_mask = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active'
        """,
        providerName,
        notes,
        licenseUrl,
        apiBaseUrl,
        useFullUrl,
        modelName,
        reasoningEffort,
        wireApi,
        workerConcurrency,
        encryptedApiKey,
        apiKeyMask,
        operatorId,
        configId);
  }

  public int update(
      long configId,
      String providerName,
      String notes,
      String licenseUrl,
      String apiBaseUrl,
      boolean useFullUrl,
      String modelName,
      String reasoningEffort,
      String wireApi,
      int workerConcurrency,
      String encryptedApiKey,
      String apiKeyMask,
      long operatorId) {
    return jdbcTemplate.update(
        """
        UPDATE ai_model_configs
        SET provider_name = ?,
            notes = ?,
            license_url = ?,
            api_base_url = ?,
            use_full_url = ?,
            model_name = ?,
            reasoning_effort = ?,
            wire_api = ?,
            worker_concurrency = ?,
            encrypted_api_key = ?,
            api_key_mask = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        providerName,
        notes,
        licenseUrl,
        apiBaseUrl,
        useFullUrl,
        modelName,
        reasoningEffort,
        wireApi,
        workerConcurrency,
        encryptedApiKey,
        apiKeyMask,
        operatorId,
        configId);
  }

  public int delete(long configId) {
    return jdbcTemplate.update("DELETE FROM ai_model_configs WHERE id = ?", configId);
  }

  public int activate(long configId, long operatorId) {
    int updated = jdbcTemplate.update(
        """
        UPDATE ai_model_configs
        SET status = 'active',
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        operatorId,
        configId);
    if (updated > 0) {
      jdbcTemplate.update(
          """
          UPDATE ai_model_configs
          SET status = 'inactive',
              updated_at = CURRENT_TIMESTAMP
          WHERE status = 'active' AND id <> ?
          """,
          configId);
    }
    return updated;
  }

  private void deactivateActive() {
    jdbcTemplate.update(
        """
        UPDATE ai_model_configs
        SET status = 'inactive',
            updated_at = CURRENT_TIMESTAMP
        WHERE status = 'active'
        """);
  }

  private AiModelConfigRecord mapRecord(java.sql.ResultSet rs, int rowNum)
      throws java.sql.SQLException {
    return new AiModelConfigRecord(
        rs.getLong("id"),
        rs.getString("provider_name"),
        rs.getString("notes"),
        rs.getString("license_url"),
        rs.getString("api_base_url"),
        rs.getBoolean("use_full_url"),
        rs.getString("model_name"),
        rs.getString("reasoning_effort"),
        rs.getString("wire_api"),
        rs.getInt("worker_concurrency"),
        rs.getString("encrypted_api_key"),
        rs.getString("api_key_mask"),
        rs.getString("status"),
        toLong(rs.getObject("created_by")),
        toLong(rs.getObject("updated_by")),
        rs.getString("updated_by_name"),
        toLocalDateTime(rs.getTimestamp("created_at")),
        toLocalDateTime(rs.getTimestamp("updated_at")));
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  public record AiModelConfigRecord(
      long id,
      String providerName,
      String notes,
      String licenseUrl,
      String apiBaseUrl,
      boolean useFullUrl,
      String modelName,
      String reasoningEffort,
      String wireApi,
      int workerConcurrency,
      String encryptedApiKey,
      String apiKeyMask,
      String status,
      Long createdBy,
      Long updatedBy,
      String updatedByName,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}
}
