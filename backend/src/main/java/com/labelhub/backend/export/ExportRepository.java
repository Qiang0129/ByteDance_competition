package com.labelhub.backend.export;

import java.sql.ResultSet;
import java.sql.SQLException;
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
public class ExportRepository {

  private final JdbcTemplate jdbcTemplate;

  public ExportRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public boolean isTaskOwnedBy(long ownerId, long taskId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tasks WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
        Integer.class,
        taskId,
        ownerId);
    return count != null && count > 0;
  }

  public Optional<TaskRecord> findOwnerTask(long ownerId, long taskId) {
    return jdbcTemplate.query(
        """
        SELECT id, title
        FROM tasks
        WHERE id = ?
          AND owner_id = ?
          AND deleted_at IS NULL
        """,
        (rs, rowNum) -> new TaskRecord(rs.getLong("id"), rs.getString("title")),
        taskId,
        ownerId)
        .stream()
        .findFirst();
  }

  public long countExportableAnnotations(long taskId) {
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.task_id = ?
          AND an.status IN ('accepted', 'exported')
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
          AND an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = an.assignment_id
              AND latest.status <> 'voided'
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
        """,
        Long.class,
        taskId);
    return count == null ? 0 : count;
  }

  public long countAcceptedAnnotations(long taskId) {
    return countExportableAnnotations(taskId);
  }

  public long createExportJob(long taskId, String format, String mappingJson, long createdBy) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO export_jobs (task_id, format, mapping_json, status, progress, created_by)
          VALUES (?, ?, ?, 'pending', 0, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, taskId);
      statement.setString(2, format);
      statement.setString(3, mappingJson);
      statement.setLong(4, createdBy);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create export job");
    }
    return key.longValue();
  }

  public long createFile(
      long ownerId,
      String storageKey,
      String filename,
      String mimeType,
      long size,
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
      statement.setLong(4, size);
      statement.setString(5, checksum);
      statement.setLong(6, ownerId);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create file record");
    }
    return key.longValue();
  }

  public List<ExportJobRecord> listOwnerExportJobs(long ownerId) {
    return jdbcTemplate.query(
        selectExportJobSql() + """
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
        ORDER BY ej.created_at DESC, ej.id DESC
        """,
        this::mapJob,
        ownerId);
  }

  public Optional<ExportJobRecord> lockOwnerExportJob(long ownerId, long exportId) {
    return jdbcTemplate.query(
        selectExportJobSql() + """
        WHERE ej.id = ?
          AND t.owner_id = ?
          AND t.deleted_at IS NULL
        FOR UPDATE
        """,
        this::mapJob,
        exportId,
        ownerId)
        .stream()
        .findFirst();
  }

  public Optional<ExportJobRecord> findOwnerExportJob(long ownerId, long exportId) {
    return jdbcTemplate.query(
        selectExportJobSql() + """
        WHERE ej.id = ?
          AND t.owner_id = ?
          AND t.deleted_at IS NULL
        """,
        this::mapJob,
        exportId,
        ownerId)
        .stream()
        .findFirst();
  }

  public ExportOverviewRecord overview(long ownerId, LocalDateTime monthStart, LocalDateTime monthEnd) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN ej.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_jobs,
          SUM(CASE WHEN ej.status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
          SUM(CASE
            WHEN ej.status = 'succeeded'
              AND COALESCE(ej.completed_at, ej.updated_at) >= ?
              AND COALESCE(ej.completed_at, ej.updated_at) < ?
            THEN COALESCE(ej.exported_count, 0)
            ELSE 0
          END) AS monthly_exported_items,
          SUM(CASE
            WHEN ej.status = 'succeeded'
              AND COALESCE(ej.completed_at, ej.updated_at) >= ?
              AND COALESCE(ej.completed_at, ej.updated_at) < ?
            THEN COALESCE(f.size, 0)
            ELSE 0
          END) AS monthly_file_size_bytes
        FROM export_jobs ej
        JOIN tasks t ON t.id = ej.task_id
        LEFT JOIN files f ON f.id = ej.file_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
        """,
        (rs, rowNum) -> new ExportOverviewRecord(
            rs.getLong("total_jobs"),
            rs.getLong("succeeded_jobs"),
            rs.getLong("failed_jobs"),
            rs.getLong("monthly_exported_items"),
            rs.getLong("monthly_file_size_bytes")),
        Timestamp.valueOf(monthStart),
        Timestamp.valueOf(monthEnd),
        Timestamp.valueOf(monthStart),
        Timestamp.valueOf(monthEnd),
        ownerId);
  }

  public void markRunning(long exportId) {
    jdbcTemplate.update(
        """
        UPDATE export_jobs
        SET status = 'running',
            progress = 10,
            error_summary = NULL,
            started_at = CURRENT_TIMESTAMP,
            completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        exportId);
  }

  public void markSucceeded(long exportId, long fileId, int exportedCount) {
    jdbcTemplate.update(
        """
        UPDATE export_jobs
        SET status = 'succeeded',
            progress = 100,
            file_id = ?,
            exported_count = ?,
            error_summary = NULL,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        fileId,
        exportedCount,
        exportId);
  }

  public void markFailed(long exportId, int progress, String errorSummary) {
    jdbcTemplate.update(
        """
        UPDATE export_jobs
        SET status = 'failed',
            progress = ?,
            error_summary = ?,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        progress,
        errorSummary,
        exportId);
  }

  public void markAcceptedAnnotationsExported(List<Long> annotationIds) {
    // 瀵煎嚭宸叉敼涓洪潪鐮村潖鎬ф搷浣滐紝淇濈暀鍏煎鍏ュ彛銆?
  }

  public void markDownloaded(long exportId) {
    jdbcTemplate.update(
        """
        UPDATE export_jobs
        SET downloaded_at = COALESCE(downloaded_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'succeeded'
        """,
        exportId);
  }

  public List<ExportRowRecord> listExportableRows(long taskId) {
    return jdbcTemplate.query(
        """
        SELECT
          t.id AS task_id,
          t.title AS task_title,
          an.id AS annotation_id,
          an.status AS annotation_status,
          a.id AS assignment_id,
          a.item_id,
          (
            SELECT COUNT(*)
            FROM assignments ranked
            WHERE ranked.task_id = a.task_id
              AND ranked.labeler_id = a.labeler_id
              AND ranked.status <> 'voided'
              AND ranked.id <= a.id
          ) AS item_index,
          labeler.name AS labeler_name,
          reviewer.name AS reviewer_name,
          latest_hr.decision AS human_decision,
          latest_hr.reason AS human_reason,
          latest_hr.created_at AS human_reviewed_at,
          aj.decision AS ai_decision,
          aj.total_score AS ai_total_score,
          an.submitted_at,
          an.updated_at AS annotation_updated_at,
          CAST(item.raw_payload AS CHAR) AS raw_payload_json,
          item.content_markdown,
          item.media_type,
          item.media_url,
          CAST(an.answer_json AS CHAR) AS answer_json,
          CAST(an.schema_snapshot_json AS CHAR) AS schema_snapshot_json
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items item ON item.id = a.item_id
        JOIN users labeler ON labeler.id = a.labeler_id
        LEFT JOIN human_reviews latest_hr ON latest_hr.id = (
          SELECT hr2.id
          FROM human_reviews hr2
          WHERE hr2.annotation_id = an.id
          ORDER BY hr2.round_no DESC, hr2.id DESC
          LIMIT 1
        )
        LEFT JOIN users reviewer ON reviewer.id = latest_hr.reviewer_id
        LEFT JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        WHERE t.id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status IN ('accepted', 'exported')
          AND an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = a.id
              AND latest.status <> 'voided'
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
        ORDER BY item_index ASC, an.id ASC
        """,
        this::mapExportRow,
        taskId);
  }

  public List<ExportRowRecord> listAcceptedExportRows(long taskId) {
    return listExportableRows(taskId);
  }

  public Optional<String> findLatestTaskSchemaJson(long taskId) {
    return jdbcTemplate.query(
        """
        SELECT CAST(schema_json AS CHAR) AS schema_json
        FROM task_schema_versions
        WHERE task_id = ?
          AND status = 'published'
          AND deleted_at IS NULL
        ORDER BY version DESC, id DESC
        LIMIT 1
        """,
        (rs, rowNum) -> rs.getString("schema_json"),
        taskId)
        .stream()
        .findFirst();
  }

  private String selectExportJobSql() {
    return """
        SELECT
          ej.id,
          ej.task_id,
          t.title AS task_title,
          ej.format,
          ej.status,
          ej.progress,
          ej.file_id,
          ej.exported_count,
          ej.error_summary,
          CAST(ej.mapping_json AS CHAR) AS mapping_json,
          ej.started_at,
          ej.completed_at,
          ej.downloaded_at,
          ej.created_at,
          ej.updated_at,
          creator.name AS created_by_name,
          f.storage_key,
          f.filename,
          f.mime_type,
          f.size AS file_size
        FROM export_jobs ej
        JOIN tasks t ON t.id = ej.task_id
        LEFT JOIN users creator ON creator.id = ej.created_by
        LEFT JOIN files f ON f.id = ej.file_id
        """;
  }

  private ExportJobRecord mapJob(ResultSet rs, int rowNum) throws SQLException {
    return new ExportJobRecord(
        rs.getLong("id"),
        rs.getLong("task_id"),
        rs.getString("task_title"),
        rs.getString("format"),
        rs.getString("status"),
        rs.getInt("progress"),
        toLong(rs.getObject("file_id")),
        toInteger(rs.getObject("exported_count")),
        rs.getString("error_summary"),
        rs.getString("mapping_json"),
        toLocalDateTime(rs.getTimestamp("started_at")),
        toLocalDateTime(rs.getTimestamp("completed_at")),
        toLocalDateTime(rs.getTimestamp("downloaded_at")),
        toLocalDateTime(rs.getTimestamp("created_at")),
        toLocalDateTime(rs.getTimestamp("updated_at")),
        rs.getString("created_by_name"),
        rs.getString("storage_key"),
        rs.getString("filename"),
        rs.getString("mime_type"),
        toLong(rs.getObject("file_size")));
  }

  private ExportRowRecord mapExportRow(ResultSet rs, int rowNum) throws SQLException {
    return new ExportRowRecord(
        rs.getLong("task_id"),
        rs.getString("task_title"),
        rs.getLong("annotation_id"),
        rs.getString("annotation_status"),
        rs.getLong("assignment_id"),
        rs.getLong("item_id"),
        rs.getInt("item_index"),
        rs.getString("labeler_name"),
        rs.getString("reviewer_name"),
        rs.getString("human_decision"),
        rs.getString("human_reason"),
        toLocalDateTime(rs.getTimestamp("human_reviewed_at")),
        rs.getString("ai_decision"),
        toDouble(rs.getObject("ai_total_score")),
        toLocalDateTime(rs.getTimestamp("submitted_at")),
        toLocalDateTime(rs.getTimestamp("annotation_updated_at")),
        rs.getString("raw_payload_json"),
        rs.getString("content_markdown"),
        rs.getString("media_type"),
        rs.getString("media_url"),
        rs.getString("answer_json"),
        rs.getString("schema_snapshot_json"));
  }

  private String placeholders(int count) {
    return String.join(", ", java.util.Collections.nCopies(count, "?"));
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value instanceof Number number ? number.longValue() : null;
  }

  private Integer toInteger(Object value) {
    return value instanceof Number number ? number.intValue() : null;
  }

  private Double toDouble(Object value) {
    return value instanceof Number number ? number.doubleValue() : null;
  }

  public record TaskRecord(long taskId, String taskTitle) {}

  public record ExportOverviewRecord(
      long totalJobs,
      long succeededJobs,
      long failedJobs,
      long monthlyExportedItems,
      long monthlyFileSizeBytes) {}

  public record ExportJobRecord(
      long id,
      long taskId,
      String taskTitle,
      String format,
      String status,
      int progress,
      Long fileId,
      Integer exportedCount,
      String errorSummary,
      String mappingJson,
      LocalDateTime startedAt,
      LocalDateTime completedAt,
      LocalDateTime downloadedAt,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      String createdByName,
      String storageKey,
      String filename,
      String mimeType,
      Long fileSize) {}

  public record ExportRowRecord(
      long taskId,
      String taskTitle,
      long annotationId,
      String annotationStatus,
      long assignmentId,
      long itemId,
      int itemIndex,
      String labelerName,
      String reviewerName,
      String humanDecision,
      String humanReason,
      LocalDateTime humanReviewedAt,
      String aiDecision,
      Double aiTotalScore,
      LocalDateTime submittedAt,
      LocalDateTime annotationUpdatedAt,
      String rawPayloadJson,
      String contentMarkdown,
      String mediaType,
      String mediaUrl,
      String answerJson,
      String schemaSnapshotJson) {}
}
