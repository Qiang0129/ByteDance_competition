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
        "WHERE tsv.created_by = ? AND tsv.deleted_at IS NULL",
        List.of(ownerId),
        "ORDER BY COALESCE(tsv.updated_at, tsv.created_at) DESC, tsv.id DESC");
  }

  public Optional<SchemaRecord> findOwnerSchema(long ownerId, long schemaId) {
    return querySchemas(
        "WHERE tsv.created_by = ? AND tsv.id = ? AND tsv.deleted_at IS NULL",
        List.of(ownerId, schemaId),
        "").stream().findFirst();
  }

  public Optional<SchemaRecord> findOwnerSchemaIncludingDeleted(long ownerId, long schemaId) {
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

  public void withdraw(long schemaId) {
    jdbcTemplate.update(
        """
        UPDATE task_schema_versions
        SET status = 'draft',
            published_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        schemaId);
  }

  public int countTaskReferences(long schemaId) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM tasks
        WHERE CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(reward_rule, '$.schemaVersionId')), '') AS UNSIGNED) = ?
        """,
        Integer.class,
        schemaId);
    return count == null ? 0 : count;
  }

  public int countAnnotationReferences(long schemaId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM annotations WHERE schema_version_id = ?",
        Integer.class,
        schemaId);
    return count == null ? 0 : count;
  }

  public int deleteDraft(long ownerId, long schemaId) {
    return jdbcTemplate.update(
        """
        UPDATE task_schema_versions
        SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND created_by = ?
          AND status = 'draft'
        """,
        schemaId,
        ownerId);
  }

  private List<SchemaRecord> querySchemas(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          tsv.id,
          COALESCE(tsv.task_id, referenced_task.id) AS display_task_id,
          COALESCE(t.title, referenced_task.title) AS display_task_title,
          tsv.version,
          CAST(tsv.schema_json AS CHAR) AS schema_json,
          tsv.status,
          tsv.created_by,
          u.name AS created_by_name,
          tsv.created_at,
          COALESCE(tsv.updated_at, tsv.created_at) AS updated_at,
          tsv.published_at,
          tsv.deleted_at
        FROM task_schema_versions tsv
        LEFT JOIN tasks t ON t.id = tsv.task_id
        LEFT JOIN tasks referenced_task ON referenced_task.id = (
          SELECT rt.id
          FROM tasks rt
          WHERE rt.owner_id = tsv.created_by
            AND CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(rt.reward_rule, '$.schemaVersionId')), '') AS UNSIGNED) = tsv.id
          ORDER BY COALESCE(rt.updated_at, rt.created_at) DESC, rt.id DESC
          LIMIT 1
        )
        LEFT JOIN users u ON u.id = tsv.created_by
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new SchemaRecord(
            rs.getLong("id"),
            toLong(rs.getObject("display_task_id")),
            rs.getString("display_task_title"),
            rs.getInt("version"),
            rs.getString("schema_json"),
            rs.getString("status"),
            toLong(rs.getObject("created_by")),
            rs.getString("created_by_name"),
            toLocalDateTime(rs.getTimestamp("created_at")),
            toLocalDateTime(rs.getTimestamp("updated_at")),
            toLocalDateTime(rs.getTimestamp("published_at")),
            toLocalDateTime(rs.getTimestamp("deleted_at"))),
        args.toArray());
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }
}
