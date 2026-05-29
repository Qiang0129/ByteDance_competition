package com.labelhub.backend.export;

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
        "SELECT COUNT(*) FROM tasks WHERE id = ? AND owner_id = ?",
        Integer.class,
        taskId,
        ownerId);
    return count != null && count > 0;
  }

  public long countAcceptedAnnotations(long taskId) {
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        WHERE a.task_id = ?
          AND an.status = 'accepted'
          AND an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = an.assignment_id
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
        """,
        Long.class,
        taskId);
    return count == null ? 0 : count;
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

  public List<ExportJobRecord> listOwnerExportJobs(long ownerId) {
    return jdbcTemplate.query(
        """
        SELECT ej.id, ej.task_id, ej.format, ej.status, ej.progress, ej.error_summary, ej.created_at, ej.updated_at
        FROM export_jobs ej
        JOIN tasks t ON t.id = ej.task_id
        WHERE t.owner_id = ?
        ORDER BY ej.created_at DESC, ej.id DESC
        """,
        this::mapJob,
        ownerId);
  }

  public Optional<ExportJobRecord> lockOwnerExportJob(long ownerId, long exportId) {
    return jdbcTemplate.query(
        """
        SELECT ej.id, ej.task_id, ej.format, ej.status, ej.progress, ej.error_summary, ej.created_at, ej.updated_at
        FROM export_jobs ej
        JOIN tasks t ON t.id = ej.task_id
        WHERE ej.id = ? AND t.owner_id = ?
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
        """
        SELECT ej.id, ej.task_id, ej.format, ej.status, ej.progress, ej.error_summary, ej.created_at, ej.updated_at
        FROM export_jobs ej
        JOIN tasks t ON t.id = ej.task_id
        WHERE ej.id = ? AND t.owner_id = ?
        """,
        this::mapJob,
        exportId,
        ownerId)
        .stream()
        .findFirst();
  }

  public void updateStatus(long exportId, String status, int progress, String errorSummary) {
    jdbcTemplate.update(
        """
        UPDATE export_jobs
        SET status = ?,
            progress = ?,
            error_summary = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        status,
        progress,
        errorSummary,
        exportId);
  }

  public void markAcceptedAnnotationsExported(long taskId) {
    jdbcTemplate.update(
        """
        UPDATE annotations an
        JOIN assignments a ON a.id = an.assignment_id
        SET an.status = 'exported',
            an.updated_at = CURRENT_TIMESTAMP
        WHERE a.task_id = ?
          AND an.status = 'accepted'
        """,
        taskId);
  }

  public List<Long> listAcceptedAnnotationIds(long taskId) {
    return jdbcTemplate.query(
        """
        SELECT an.id
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        WHERE a.task_id = ?
          AND an.status = 'accepted'
        ORDER BY an.id ASC
        """,
        (rs, rowNum) -> rs.getLong("id"),
        taskId);
  }

  private ExportJobRecord mapJob(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new ExportJobRecord(
        rs.getLong("id"),
        rs.getLong("task_id"),
        rs.getString("format"),
        rs.getString("status"),
        rs.getInt("progress"),
        rs.getString("error_summary"),
        toLocalDateTime(rs.getTimestamp("created_at")),
        toLocalDateTime(rs.getTimestamp("updated_at")));
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  public record ExportJobRecord(
      long id,
      long taskId,
      String format,
      String status,
      int progress,
      String errorSummary,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}
}
