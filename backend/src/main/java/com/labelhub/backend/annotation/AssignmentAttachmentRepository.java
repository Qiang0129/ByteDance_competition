package com.labelhub.backend.annotation;

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
public class AssignmentAttachmentRepository {

  private final JdbcTemplate jdbcTemplate;

  public AssignmentAttachmentRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<AssignmentAttachmentContext> findAssignmentContext(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT
          a.id AS assignment_id,
          a.task_id,
          a.item_id,
          a.labeler_id,
          a.status AS assignment_status,
          a.resubmit_deadline,
          t.owner_id,
          t.status AS task_status,
          t.deadline AS task_deadline,
          t.deleted_at AS task_deleted_at,
          tsv.id AS schema_version_id,
          CAST(tsv.schema_json AS CHAR) AS schema_json
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN task_schema_versions tsv ON tsv.id = COALESCE(
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.schemaVersionId')), '') AS UNSIGNED),
          (
            SELECT latest_tsv.id
            FROM task_schema_versions latest_tsv
            WHERE latest_tsv.task_id = a.task_id
            ORDER BY latest_tsv.version DESC
            LIMIT 1
          )
        )
        WHERE a.id = ?
        """,
        (rs, rowNum) -> new AssignmentAttachmentContext(
            rs.getLong("assignment_id"),
            rs.getLong("task_id"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id"),
            rs.getLong("owner_id"),
            rs.getString("assignment_status"),
            toLocalDateTime(rs.getTimestamp("resubmit_deadline")),
            rs.getString("task_status"),
            toLocalDateTime(rs.getTimestamp("task_deadline")),
            toLocalDateTime(rs.getTimestamp("task_deleted_at")),
            toLong(rs.getObject("schema_version_id")),
            rs.getString("schema_json")),
        assignmentId)
        .stream()
        .findFirst();
  }

  public long createFile(
      long userId,
      String storageKey,
      String filename,
      String mimeType,
      Long size,
      String checksum) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO files (storage_key, filename, mime_type, size, checksum, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, storageKey);
      statement.setString(2, filename);
      statement.setString(3, mimeType);
      if (size == null) {
        statement.setNull(4, Types.BIGINT);
      } else {
        statement.setLong(4, size);
      }
      statement.setString(5, checksum);
      statement.setLong(6, userId);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create file record");
    }
    return key.longValue();
  }

  public void createAssignmentAttachment(
      long assignmentId,
      String fieldName,
      long fileId,
      long uploadedBy) {
    jdbcTemplate.update(
        """
        INSERT IGNORE INTO assignment_attachments (assignment_id, field_name, file_id, uploaded_by)
        VALUES (?, ?, ?, ?)
        """,
        assignmentId,
        fieldName,
        fileId,
        uploadedBy);
  }

  public Optional<AttachmentFileRecord> findAttachmentFile(long assignmentId, long fileId) {
    return jdbcTemplate.query(
        """
        SELECT
          f.id,
          f.storage_key,
          f.filename,
          f.mime_type,
          f.size,
          f.checksum
        FROM assignment_attachments aa
        JOIN files f ON f.id = aa.file_id
        WHERE aa.assignment_id = ?
          AND aa.file_id = ?
        """,
        (rs, rowNum) -> new AttachmentFileRecord(
            rs.getLong("id"),
            rs.getString("storage_key"),
            rs.getString("filename"),
            rs.getString("mime_type"),
            toLong(rs.getObject("size")),
            rs.getString("checksum")),
        assignmentId,
        fileId)
        .stream()
        .findFirst();
  }

  public boolean canReviewerAccessAssignment(long reviewerId, long assignmentId) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.id = ?
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
          AND (
            NOT EXISTS (
              SELECT 1
              FROM task_review_items tri_any
              WHERE tri_any.task_id = a.task_id
            )
            OR EXISTS (
              SELECT 1
              FROM task_review_items tri
              WHERE tri.task_id = a.task_id
                AND tri.item_id = a.item_id
                AND tri.reviewer_id = ?
            )
          )
        """,
        Integer.class,
        assignmentId,
        reviewerId);
    return count != null && count > 0;
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Number number) {
      return number.longValue();
    }
    return Long.parseLong(value.toString());
  }

  public record AssignmentAttachmentContext(
      long assignmentId,
      long taskId,
      long itemId,
      long labelerId,
      long ownerId,
      String assignmentStatus,
      LocalDateTime resubmitDeadline,
      String taskStatus,
      LocalDateTime taskDeadline,
      LocalDateTime taskDeletedAt,
      Long schemaVersionId,
      String schemaJson) {}

  public record AttachmentFileRecord(
      long id,
      String storageKey,
      String filename,
      String mimeType,
      Long size,
      String checksum) {}
}
