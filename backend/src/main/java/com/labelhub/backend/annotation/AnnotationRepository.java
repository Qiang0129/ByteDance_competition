package com.labelhub.backend.annotation;

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
public class AnnotationRepository {

  private final JdbcTemplate jdbcTemplate;

  public AnnotationRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<AssignmentItemRecord> findAssignmentForLabeler(long assignmentId, long labelerId) {
    return queryAssignment(
        "WHERE a.id = ? AND a.labeler_id = ?",
        List.of(assignmentId, labelerId),
        "").stream().findFirst();
  }

  public Optional<AssignmentItemRecord> lockAssignmentForLabeler(long assignmentId, long labelerId) {
    return queryAssignment(
        "WHERE a.id = ? AND a.labeler_id = ?",
        List.of(assignmentId, labelerId),
        "FOR UPDATE").stream().findFirst();
  }

  public Optional<SchemaSnapshotRecord> findSchema(long schemaVersionId) {
    return jdbcTemplate.query(
        """
        SELECT id, version, CAST(schema_json AS CHAR) AS schema_json, status
        FROM task_schema_versions
        WHERE id = ?
        """,
        (rs, rowNum) -> new SchemaSnapshotRecord(
            rs.getLong("id"),
            rs.getInt("version"),
            rs.getString("schema_json"),
            rs.getString("status")),
        schemaVersionId)
        .stream()
        .findFirst();
  }

  public Optional<DraftRecord> findDraft(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT assignment_id, CAST(answer_json AS CHAR) AS answer_json, updated_at
        FROM drafts
        WHERE assignment_id = ?
        """,
        (rs, rowNum) -> new DraftRecord(
            rs.getLong("assignment_id"),
            rs.getString("answer_json"),
            toLocalDateTime(rs.getTimestamp("updated_at"))),
        assignmentId)
        .stream()
        .findFirst();
  }

  public DraftRecord upsertDraft(long assignmentId, String answerJson) {
    jdbcTemplate.update(
        """
        INSERT INTO drafts (assignment_id, answer_json)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          answer_json = VALUES(answer_json),
          updated_at = CURRENT_TIMESTAMP
        """,
        assignmentId,
        answerJson);
    return findDraft(assignmentId)
        .orElseThrow(() -> new IllegalStateException("failed to load saved draft"));
  }

  public List<Long> listAssignmentIdsForPosition(long taskId, long labelerId) {
    return jdbcTemplate.query(
        """
        SELECT id
        FROM assignments
        WHERE task_id = ? AND labeler_id = ?
        ORDER BY id ASC
        """,
        (rs, rowNum) -> rs.getLong("id"),
        taskId,
        labelerId);
  }

  public Optional<String> findLatestReturnReason(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT hr.reason
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        WHERE an.assignment_id = ?
          AND LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected')
          AND hr.reason IS NOT NULL
          AND hr.reason <> ''
        ORDER BY hr.created_at DESC, hr.id DESC
        LIMIT 1
        """,
        (rs, rowNum) -> rs.getString("reason"),
        assignmentId)
        .stream()
        .findFirst();
  }

  public int nextRevisionNo(long assignmentId) {
    Integer next = jdbcTemplate.queryForObject(
        """
        SELECT COALESCE(MAX(revision_no), 0) + 1
        FROM annotations
        WHERE assignment_id = ?
        """,
        Integer.class,
        assignmentId);
    return next == null ? 1 : next;
  }

  public long createAnnotation(
      long assignmentId,
      long schemaVersionId,
      String answerJson,
      int revisionNo) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO annotations
            (assignment_id, schema_version_id, answer_json, status, revision_no, submitted_at)
          VALUES (?, ?, ?, 'submitted', ?, CURRENT_TIMESTAMP)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, assignmentId);
      statement.setLong(2, schemaVersionId);
      statement.setString(3, answerJson);
      statement.setInt(4, revisionNo);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create annotation");
    }
    return key.longValue();
  }

  public void markSubmitted(long assignmentId, long itemId) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = 'submitted',
            submitted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        assignmentId);
    jdbcTemplate.update(
        """
        UPDATE items
        SET item_status = 'submitted',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        itemId);
  }

  public void deleteDraft(long assignmentId) {
    jdbcTemplate.update("DELETE FROM drafts WHERE assignment_id = ?", assignmentId);
  }

  public void createAiReviewJob(long annotationId, long schemaVersionId) {
    String jobKey = "annotation:%d:schema:%d:prompt:default-v1"
        .formatted(annotationId, schemaVersionId);
    jdbcTemplate.update(
        """
        INSERT INTO ai_review_jobs
          (annotation_id, job_key, status, retry_count, available_at)
        VALUES (?, ?, 'pending', 0, CURRENT_TIMESTAMP)
        """,
        annotationId,
        jobKey);
  }

  private List<AssignmentItemRecord> queryAssignment(
      String whereClause,
      List<Object> args,
      String suffix) {
    String sql = """
        SELECT
          a.id AS assignment_id,
          a.task_id,
          a.item_id,
          a.labeler_id,
          a.status AS assignment_status,
          t.title AS task_title,
          t.status AS task_status,
          CAST(t.reward_rule AS CHAR) AS reward_rule_json,
          i.item_status,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          i.media_type,
          i.media_url,
          i.content_markdown,
          tsv.id AS fallback_schema_version_id,
          tsv.version AS fallback_schema_version,
          CAST(tsv.schema_json AS CHAR) AS fallback_schema_json,
          tsv.status AS fallback_schema_status
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        LEFT JOIN task_schema_versions tsv ON tsv.id = (
          SELECT latest_tsv.id
          FROM task_schema_versions latest_tsv
          WHERE latest_tsv.task_id = a.task_id
          ORDER BY latest_tsv.version DESC
          LIMIT 1
        )
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new AssignmentItemRecord(
            rs.getLong("assignment_id"),
            rs.getLong("task_id"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id"),
            rs.getString("assignment_status"),
            rs.getString("task_title"),
            rs.getString("task_status"),
            rs.getString("reward_rule_json"),
            rs.getString("item_status"),
            rs.getString("raw_payload_json"),
            rs.getString("media_type"),
            rs.getString("media_url"),
            rs.getString("content_markdown"),
            toLong(rs.getObject("fallback_schema_version_id")),
            toInteger(rs.getObject("fallback_schema_version")),
            rs.getString("fallback_schema_json"),
            rs.getString("fallback_schema_status")),
        args.toArray());
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

  public record AssignmentItemRecord(
      long assignmentId,
      long taskId,
      long itemId,
      long labelerId,
      String assignmentStatus,
      String taskTitle,
      String taskStatus,
      String rewardRuleJson,
      String itemStatus,
      String rawPayloadJson,
      String mediaType,
      String mediaUrl,
      String contentMarkdown,
      Long fallbackSchemaVersionId,
      Integer fallbackSchemaVersion,
      String fallbackSchemaJson,
      String fallbackSchemaStatus) {}

  public record SchemaSnapshotRecord(
      long id,
      int version,
      String schemaJson,
      String status) {}

  public record DraftRecord(
      long assignmentId,
      String answerJson,
      LocalDateTime updatedAt) {}
}
