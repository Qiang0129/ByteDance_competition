package com.labelhub.backend.schema;

import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class SchemaRepository {

  private final JdbcTemplate jdbcTemplate;

  public SchemaRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public boolean taskBelongsToOwner(long taskId, long ownerId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tasks WHERE id = ? AND owner_id = ?",
        Integer.class,
        taskId,
        ownerId);
    return count != null && count > 0;
  }

  public int nextTaskVersion(long taskId) {
    Integer nextVersion = jdbcTemplate.queryForObject(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM task_schema_versions WHERE task_id = ?",
        Integer.class,
        taskId);
    return nextVersion == null ? 1 : nextVersion;
  }

  public long createDraft(Long taskId, int version, String schemaJson, long ownerId) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO task_schema_versions
            (task_id, version, schema_json, status, created_by, published_at)
          VALUES (?, ?, ?, 'draft', ?, NULL)
          """,
          Statement.RETURN_GENERATED_KEYS);
      if (taskId == null) {
        statement.setNull(1, Types.BIGINT);
      } else {
        statement.setLong(1, taskId);
      }
      statement.setInt(2, version);
      statement.setString(3, schemaJson);
      statement.setLong(4, ownerId);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create schema draft");
    }
    return key.longValue();
  }

  public List<SchemaRecord> listOwnerSchemas(long ownerId) {
    return querySchemas(
        "WHERE tsv.created_by = ?",
        List.of(ownerId),
        "ORDER BY COALESCE(tsv.updated_at, tsv.created_at) DESC, tsv.id DESC");
  }

  public Optional<SchemaRecord> findOwnerSchema(long ownerId, long schemaId) {
    return querySchemas(
        "WHERE tsv.created_by = ? AND tsv.id = ?",
        List.of(ownerId, schemaId),
        "").stream().findFirst();
  }

  public void updateDraft(long schemaId, Long taskId, int version, String schemaJson) {
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          UPDATE task_schema_versions
          SET task_id = ?,
              version = ?,
              schema_json = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          """);
      if (taskId == null) {
        statement.setNull(1, Types.BIGINT);
      } else {
        statement.setLong(1, taskId);
      }
      statement.setInt(2, version);
      statement.setString(3, schemaJson);
      statement.setLong(4, schemaId);
      return statement;
    });
  }

  public void publish(long schemaId) {
    jdbcTemplate.update(
        """
        UPDATE task_schema_versions
        SET status = 'published',
            published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        schemaId);
  }

  private List<SchemaRecord> querySchemas(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          tsv.id,
          tsv.task_id,
          t.title AS task_title,
          tsv.version,
          CAST(tsv.schema_json AS CHAR) AS schema_json,
          tsv.status,
          tsv.created_by,
          u.name AS created_by_name,
          tsv.created_at,
          COALESCE(tsv.updated_at, tsv.created_at) AS updated_at,
          tsv.published_at
        FROM task_schema_versions tsv
        LEFT JOIN tasks t ON t.id = tsv.task_id
        LEFT JOIN users u ON u.id = tsv.created_by
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new SchemaRecord(
            rs.getLong("id"),
            toLong(rs.getObject("task_id")),
            rs.getString("task_title"),
            rs.getInt("version"),
            rs.getString("schema_json"),
            rs.getString("status"),
            toLong(rs.getObject("created_by")),
            rs.getString("created_by_name"),
            toLocalDateTime(rs.getTimestamp("created_at")),
            toLocalDateTime(rs.getTimestamp("updated_at")),
            toLocalDateTime(rs.getTimestamp("published_at"))),
        args.toArray());
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }
}
