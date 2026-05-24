package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class TaskRepository {

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public TaskRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public long createTask(
      long ownerId,
      String title,
      String description,
      String status,
      Integer quota,
      LocalDateTime deadline,
      TaskMetadata metadata,
      int schemaVersion) {
    String metadataJson = writeMetadata(metadata);
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO tasks (title, description, status, owner_id, quota, deadline, reward_rule, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, title);
      statement.setString(2, description);
      statement.setString(3, status);
      statement.setLong(4, ownerId);
      if (quota == null) {
        statement.setNull(5, Types.INTEGER);
      } else {
        statement.setInt(5, quota);
      }
      if (deadline == null) {
        statement.setNull(6, Types.TIMESTAMP);
      } else {
        statement.setTimestamp(6, Timestamp.valueOf(deadline));
      }
      statement.setString(7, metadataJson);
      if ("published".equals(status)) {
        statement.setTimestamp(8, Timestamp.valueOf(LocalDateTime.now()));
      } else {
        statement.setNull(8, Types.TIMESTAMP);
      }
      return statement;
    }, keyHolder);

    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create task");
    }

    long taskId = key.longValue();
    createSchemaVersion(taskId, schemaVersion, metadata.schema(), ownerId, status);
    return taskId;
  }

  public Optional<TaskRecord> findTask(long taskId) {
    List<TaskRecord> records = queryTasks(
        """
        WHERE t.id = ?
        """,
        List.of(taskId),
        "");
    return records.stream().findFirst();
  }

  public List<TaskRecord> listOwnerTasks(long ownerId) {
    return queryTasks(
        """
        WHERE t.owner_id = ?
        """,
        List.of(ownerId),
        "ORDER BY t.created_at DESC");
  }

  public long countMarketTasks(String keyword, String normalizedTaskType) {
    QueryParts query = buildMarketWhere(keyword, normalizedTaskType);
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tasks t " + query.whereClause(),
        Long.class,
        query.args().toArray());
    return count == null ? 0L : count;
  }

  public List<TaskRecord> listMarketTasks(
      String keyword,
      String normalizedTaskType,
      int offset,
      int pageSize) {
    QueryParts query = buildMarketWhere(keyword, normalizedTaskType);
    List<Object> args = new ArrayList<>(query.args());
    args.add(pageSize);
    args.add(offset);
    return queryTasks(
        query.whereClause(),
        args,
        "ORDER BY t.published_at DESC, t.created_at DESC LIMIT ? OFFSET ?");
  }

  public int updateTaskState(long ownerId, long taskId, String state) {
    return jdbcTemplate.update(
        """
        UPDATE tasks
        SET status = ?,
            published_at = CASE
              WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE published_at
            END
        WHERE id = ? AND owner_id = ?
        """,
        state,
        state,
        taskId,
        ownerId);
  }

  public void updateLatestSchemaState(long taskId, String state) {
    jdbcTemplate.update(
        """
        UPDATE task_schema_versions
        SET status = ?,
            published_at = CASE
              WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE published_at
            END
        WHERE task_id = ?
        ORDER BY version DESC
        LIMIT 1
        """,
        state,
        state,
        taskId);
  }

  private void createSchemaVersion(
      long taskId,
      int version,
      String schemaLabel,
      long ownerId,
      String status) {
    String schemaJson = writeSchema(schemaLabel);
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO task_schema_versions
            (task_id, version, schema_json, status, created_by, published_at)
          VALUES (?, ?, ?, ?, ?, ?)
          """);
      statement.setLong(1, taskId);
      statement.setInt(2, version);
      statement.setString(3, schemaJson);
      statement.setString(4, status);
      statement.setLong(5, ownerId);
      if ("published".equals(status)) {
        statement.setTimestamp(6, Timestamp.valueOf(LocalDateTime.now()));
      } else {
        statement.setNull(6, Types.TIMESTAMP);
      }
      return statement;
    });
  }

  private List<TaskRecord> queryTasks(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.owner_id,
          u.name AS owner_name,
          t.quota,
          COALESCE(ac.quota_used, 0) AS quota_used,
          t.deadline,
          CAST(t.reward_rule AS CHAR) AS reward_rule_json,
          t.created_at,
          tsv.id AS schema_version_id,
          tsv.version AS schema_version
        FROM tasks t
        JOIN users u ON u.id = t.owner_id
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS quota_used
          FROM assignments
          GROUP BY task_id
        ) ac ON ac.task_id = t.id
        LEFT JOIN task_schema_versions tsv ON tsv.id = (
          SELECT latest_tsv.id
          FROM task_schema_versions latest_tsv
          WHERE latest_tsv.task_id = t.id
          ORDER BY latest_tsv.version DESC
          LIMIT 1
        )
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new TaskRecord(
            rs.getLong("id"),
            rs.getString("title"),
            rs.getString("description"),
            rs.getString("status"),
            rs.getLong("owner_id"),
            rs.getString("owner_name"),
            toInteger(rs.getObject("quota")),
            rs.getInt("quota_used"),
            toLocalDateTime(rs.getTimestamp("deadline")),
            rs.getString("reward_rule_json"),
            toLocalDateTime(rs.getTimestamp("created_at")),
            toLong(rs.getObject("schema_version_id")),
            toInteger(rs.getObject("schema_version"))),
        args.toArray());
  }

  private QueryParts buildMarketWhere(String keyword, String normalizedTaskType) {
    List<String> clauses = new ArrayList<>();
    List<Object> args = new ArrayList<>();
    clauses.add("t.status = 'published'");
    clauses.add("(t.deadline IS NULL OR t.deadline >= CURRENT_TIMESTAMP)");

    if (keyword != null && !keyword.isBlank()) {
      clauses.add("(t.title LIKE ? OR t.description LIKE ?)");
      String likeKeyword = "%" + keyword.trim() + "%";
      args.add(likeKeyword);
      args.add(likeKeyword);
    }

    if (normalizedTaskType != null && !normalizedTaskType.isBlank()) {
      clauses.add(
          "LOWER(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')), ' ', '_')) = ?");
      args.add(normalizedTaskType);
    }

    return new QueryParts("WHERE " + String.join(" AND ", clauses), args);
  }

  private String writeMetadata(TaskMetadata metadata) {
    try {
      return objectMapper.writeValueAsString(metadata);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize task metadata", exception);
    }
  }

  private String writeSchema(String schemaLabel) {
    try {
      return objectMapper.writeValueAsString(new SchemaSnapshot(schemaLabel, true));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize schema snapshot", exception);
    }
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Integer toInteger(Object value) {
    return value == null ? null : ((Number) value).intValue();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private record QueryParts(String whereClause, List<Object> args) {}

  private record SchemaSnapshot(String schemaLabel, boolean placeholder) {}
}
