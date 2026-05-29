package com.labelhub.backend.ai;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AiReviewRepository {

  private final JdbcTemplate jdbcTemplate;

  public AiReviewRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<AiReviewJobRecord> findNextPendingJob() {
    return jdbcTemplate.query(
        """
        SELECT aj.id, aj.annotation_id, aj.status, aj.retry_count, aj.error_summary,
               aj.available_at, aj.started_at, aj.finished_at
        FROM ai_review_jobs aj
        JOIN annotations an ON an.id = aj.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE aj.status = 'pending'
          AND aj.available_at <= CURRENT_TIMESTAMP
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        ORDER BY aj.available_at ASC, aj.id ASC
        LIMIT 1
        FOR UPDATE
        """,
        this::mapJob)
        .stream()
        .findFirst();
  }

  public Optional<AiReviewJobRecord> lockJob(long jobId) {
    return jdbcTemplate.query(
        """
        SELECT id, annotation_id, status, retry_count, error_summary, available_at, started_at, finished_at
        FROM ai_review_jobs
        WHERE id = ?
        FOR UPDATE
        """,
        this::mapJob,
        jobId)
        .stream()
        .findFirst();
  }

  public void markRunning(long jobId) {
    jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'running',
            started_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        jobId);
  }

  public void markSucceeded(long jobId) {
    jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'succeeded',
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        jobId);
  }

  public void markFailed(long jobId, String errorSummary) {
    jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'failed',
            error_summary = ?,
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        errorSummary,
        jobId);
  }

  public void retry(long jobId) {
    jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'pending',
            retry_count = retry_count + 1,
            error_summary = NULL,
            available_at = CURRENT_TIMESTAMP,
            started_at = NULL,
            finished_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        jobId);
  }

  public void createResult(
      long jobId,
      String scoresJson,
      String decision,
      String comment,
      String promptSnapshot,
      String responseJson) {
    jdbcTemplate.update(
        """
        INSERT INTO ai_review_results
          (job_id, scores_json, decision, comment, prompt_snapshot, response_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          scores_json = VALUES(scores_json),
          decision = VALUES(decision),
          comment = VALUES(comment),
          prompt_snapshot = VALUES(prompt_snapshot),
          response_json = VALUES(response_json)
        """,
        jobId,
        scoresJson,
        decision,
        comment,
        promptSnapshot,
        responseJson);
  }

  public int updateAnnotationStatus(long annotationId, String status) {
    return jdbcTemplate.update(
        "UPDATE annotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'voided'",
        status,
        annotationId);
  }

  private AiReviewJobRecord mapJob(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new AiReviewJobRecord(
        rs.getLong("id"),
        rs.getLong("annotation_id"),
        rs.getString("status"),
        rs.getInt("retry_count"),
        rs.getString("error_summary"),
        toLocalDateTime(rs.getTimestamp("available_at")),
        toLocalDateTime(rs.getTimestamp("started_at")),
        toLocalDateTime(rs.getTimestamp("finished_at")));
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  public record AiReviewJobRecord(
      long id,
      long annotationId,
      String status,
      int retryCount,
      String errorSummary,
      LocalDateTime availableAt,
      LocalDateTime startedAt,
      LocalDateTime finishedAt) {}
}
