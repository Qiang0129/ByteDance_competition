package com.labelhub.backend.ai;

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
public class AiReviewRepository {

  private final JdbcTemplate jdbcTemplate;

  public AiReviewRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long createRule(
      String name,
      Long scopeTaskId,
      String promptTemplate,
      String dimensionsJson,
      double passThreshold,
      double needHumanThreshold,
      int maxRetry,
      int retryBackoffSec,
      String status,
      long createdBy) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO ai_review_rules
            (name, scope_task_id, prompt_template, dimensions_json, pass_threshold,
             need_human_threshold, max_retry, retry_backoff_sec, status, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, name);
      if (scopeTaskId == null) {
        statement.setNull(2, Types.BIGINT);
      } else {
        statement.setLong(2, scopeTaskId);
      }
      statement.setString(3, promptTemplate);
      statement.setString(4, dimensionsJson);
      statement.setDouble(5, passThreshold);
      statement.setDouble(6, needHumanThreshold);
      statement.setInt(7, maxRetry);
      statement.setInt(8, retryBackoffSec);
      statement.setString(9, status);
      statement.setLong(10, createdBy);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create ai review rule");
    }
    return key.longValue();
  }

  public int updateRule(
      long ruleId,
      String name,
      Long scopeTaskId,
      String promptTemplate,
      String dimensionsJson,
      double passThreshold,
      double needHumanThreshold,
      int maxRetry,
      int retryBackoffSec,
      String status) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_rules
        SET name = ?,
            scope_task_id = ?,
            prompt_template = ?,
            dimensions_json = ?,
            pass_threshold = ?,
            need_human_threshold = ?,
            max_retry = ?,
            retry_backoff_sec = ?,
            status = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        """,
        name,
        scopeTaskId,
        promptTemplate,
        dimensionsJson,
        passThreshold,
        needHumanThreshold,
        maxRetry,
        retryBackoffSec,
        status,
        ruleId);
  }

  public int toggleRule(long ruleId, String status) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_rules
        SET status = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        """,
        status,
        ruleId);
  }

  public int deleteRule(long ruleId) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_rules
        SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        """,
        ruleId);
  }

  public Optional<AiReviewRuleRecord> findRule(long ruleId) {
    return queryRules("WHERE r.id = ? AND r.deleted_at IS NULL", List.of(ruleId), "")
        .stream()
        .findFirst();
  }

  public Optional<AiReviewRuleRecord> findEnabledRule(long ruleId) {
    return queryRules(
        "WHERE r.id = ? AND r.status = 'enabled' AND r.deleted_at IS NULL",
        List.of(ruleId),
        "")
        .stream()
        .findFirst();
  }

  public Optional<AiReviewRuleRecord> findDefaultEnabledRule(Long taskId) {
    List<Object> args = new ArrayList<>();
    String where;
    if (taskId == null) {
      where = "WHERE r.status = 'enabled' AND r.deleted_at IS NULL";
    } else {
      where = """
          WHERE r.status = 'enabled'
            AND r.deleted_at IS NULL
            AND (r.scope_task_id = ? OR r.scope_task_id IS NULL)
          """;
      args.add(taskId);
    }
    return queryRules(
        where,
        args,
        "ORDER BY CASE WHEN r.scope_task_id IS NULL THEN 1 ELSE 0 END, r.updated_at DESC, r.id DESC LIMIT 1")
        .stream()
        .findFirst();
  }

  public List<AiReviewRuleRecord> listRules(String status, Long taskId, int limit, int offset) {
    List<Object> args = new ArrayList<>();
    String where = "WHERE r.deleted_at IS NULL";
    if (status != null && !status.isBlank()) {
      where += " AND r.status = ?";
      args.add(status);
    }
    if (taskId != null) {
      where += " AND r.scope_task_id = ?";
      args.add(taskId);
    }
    args.add(limit);
    args.add(offset);
    return queryRules(where, args, "ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?");
  }

  public long countRules(String status, Long taskId) {
    List<Object> args = new ArrayList<>();
    String where = "WHERE deleted_at IS NULL";
    if (status != null && !status.isBlank()) {
      where += " AND status = ?";
      args.add(status);
    }
    if (taskId != null) {
      where += " AND scope_task_id = ?";
      args.add(taskId);
    }
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM ai_review_rules " + where,
        Long.class,
        args.toArray());
    return count == null ? 0L : count;
  }

  public Optional<AiReviewJobRecord> findNextPendingJob() {
    return queryJobs(
        """
        WHERE aj.status = 'pending'
          AND aj.available_at <= CURRENT_TIMESTAMP
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        """,
        List.of(),
        "ORDER BY aj.available_at ASC, aj.id ASC LIMIT 1 FOR UPDATE SKIP LOCKED")
        .stream()
        .findFirst();
  }

  public Optional<AiReviewJobRecord> lockJob(long jobId) {
    return queryJobs("WHERE aj.id = ?", List.of(jobId), "FOR UPDATE").stream().findFirst();
  }

  public Optional<AiReviewJobRecord> findJob(long jobId) {
    return queryJobs("WHERE aj.id = ?", List.of(jobId), "").stream().findFirst();
  }

  public int deleteJob(long jobId) {
    return jdbcTemplate.update("DELETE FROM ai_review_jobs WHERE id = ?", jobId);
  }

  public Optional<AiReviewJobPayloadRecord> findJobPayload(long jobId) {
    return jdbcTemplate.query(
        """
        SELECT
          aj.id AS job_id,
          aj.annotation_id,
          t.id AS task_id,
          t.title AS task_title,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          i.media_type,
          i.media_url,
          i.content_markdown,
          CAST(an.answer_json AS CHAR) AS answer_json,
          CAST(an.schema_snapshot_json AS CHAR) AS schema_snapshot_json,
          CAST(aj.rule_snapshot_json AS CHAR) AS rule_snapshot_json
        FROM ai_review_jobs aj
        JOIN annotations an ON an.id = aj.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        WHERE aj.id = ?
        """,
        (rs, rowNum) -> new AiReviewJobPayloadRecord(
            rs.getLong("job_id"),
            rs.getLong("annotation_id"),
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getString("raw_payload_json"),
            rs.getString("media_type"),
            rs.getString("media_url"),
            rs.getString("content_markdown"),
            rs.getString("answer_json"),
            rs.getString("schema_snapshot_json"),
            rs.getString("rule_snapshot_json")),
        jobId)
        .stream()
        .findFirst();
  }

  public int markRunning(long jobId, String runToken) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'running',
            run_token = ?,
            cancel_reason = NULL,
            error_summary = NULL,
            started_at = CURRENT_TIMESTAMP,
            finished_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        runToken,
        jobId);
  }

  public int markSucceeded(long jobId) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'succeeded',
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        jobId);
  }

  public int markFailed(long jobId, String errorSummary) {
    return jdbcTemplate.update(
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

  public int retry(long jobId, int backoffSec) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'pending',
            retry_count = retry_count + 1,
            run_token = NULL,
            error_summary = NULL,
            cancel_reason = NULL,
            available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
            started_at = NULL,
            finished_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        backoffSec,
        jobId);
  }

  public int cancelRunning(long jobId, String reason) {
    return jdbcTemplate.update(
        """
        UPDATE ai_review_jobs
        SET status = 'pending',
            run_token = NULL,
            cancel_reason = ?,
            error_summary = NULL,
            available_at = CURRENT_TIMESTAMP,
            started_at = NULL,
            finished_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        reason,
        jobId);
  }

  public void createResult(
      long jobId,
      String scoresJson,
      Double totalScore,
      String decision,
      String comment,
      String riskFlagsJson,
      String evidenceJson,
      String promptSnapshot,
      String responseJson,
      String modelName,
      Integer latencyMs) {
    jdbcTemplate.update(
        """
        INSERT INTO ai_review_results
          (job_id, scores_json, total_score, decision, comment, risk_flags_json,
           evidence_json, prompt_snapshot, response_json, model_name, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          scores_json = VALUES(scores_json),
          total_score = VALUES(total_score),
          decision = VALUES(decision),
          comment = VALUES(comment),
          risk_flags_json = VALUES(risk_flags_json),
          evidence_json = VALUES(evidence_json),
          prompt_snapshot = VALUES(prompt_snapshot),
          response_json = VALUES(response_json),
          model_name = VALUES(model_name),
          latency_ms = VALUES(latency_ms)
        """,
        jobId,
        scoresJson,
        totalScore,
        decision,
        comment,
        riskFlagsJson,
        evidenceJson,
        promptSnapshot,
        responseJson,
        modelName,
        latencyMs);
  }

  public int updateAnnotationStatus(long annotationId, String status) {
    return jdbcTemplate.update(
        "UPDATE annotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'voided'",
        status,
        annotationId);
  }

  public Optional<AiReviewResultRecord> findResultByAnnotation(long annotationId) {
    return jdbcTemplate.query(
        """
        SELECT
          air.id,
          aj.annotation_id,
          CAST(air.scores_json AS CHAR) AS scores_json,
          air.total_score,
          air.decision,
          air.comment,
          CAST(air.risk_flags_json AS CHAR) AS risk_flags_json,
          CAST(air.evidence_json AS CHAR) AS evidence_json,
          air.prompt_snapshot,
          CAST(air.response_json AS CHAR) AS response_json,
          air.model_name,
          air.latency_ms
        FROM ai_review_results air
        JOIN ai_review_jobs aj ON aj.id = air.job_id
        WHERE aj.annotation_id = ?
        ORDER BY air.id DESC
        LIMIT 1
        """,
        this::mapResult,
        annotationId)
        .stream()
        .findFirst();
  }

  public List<AiReviewJobTimelineRecord> listAssignmentAiJobTimeline(long jobId) {
    return jdbcTemplate.query(
        """
        SELECT
          an.id AS annotation_id,
          an.revision_no,
          aj.id AS job_id,
          aj.status AS job_status,
          aj.retry_count,
          aj.error_summary,
          aj.cancel_reason,
          aj.created_at,
          aj.available_at,
          aj.started_at,
          aj.finished_at,
          air.decision,
          air.total_score,
          air.comment
        FROM ai_review_jobs current_job
        JOIN annotations current_annotation ON current_annotation.id = current_job.annotation_id
        JOIN annotations an ON an.assignment_id = current_annotation.assignment_id
        JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        WHERE current_job.id = ?
          AND an.status <> 'voided'
        ORDER BY an.revision_no ASC, an.id ASC, aj.created_at ASC, aj.id ASC
        """,
        (rs, rowNum) -> new AiReviewJobTimelineRecord(
            rs.getLong("annotation_id"),
            rs.getInt("revision_no"),
            rs.getLong("job_id"),
            rs.getString("job_status"),
            rs.getInt("retry_count"),
            rs.getString("error_summary"),
            rs.getString("cancel_reason"),
            toLocalDateTime(rs.getTimestamp("created_at")),
            toLocalDateTime(rs.getTimestamp("available_at")),
            toLocalDateTime(rs.getTimestamp("started_at")),
            toLocalDateTime(rs.getTimestamp("finished_at")),
            rs.getString("decision"),
            toDouble(rs.getObject("total_score")),
            rs.getString("comment")),
        jobId);
  }

  public List<AiReviewJobRecord> listJobs(
      String status,
      Long ruleId,
      Long taskId,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    String where = "WHERE t.deleted_at IS NULL";
    if (status != null && !status.isBlank()) {
      where += " AND aj.status = ?";
      args.add(status);
    }
    if (ruleId != null) {
      where += " AND aj.rule_id = ?";
      args.add(ruleId);
    }
    if (taskId != null) {
      where += " AND t.id = ?";
      args.add(taskId);
    }
    args.add(limit);
    args.add(offset);
    return queryJobs(where, args, "ORDER BY aj.updated_at DESC, aj.id DESC LIMIT ? OFFSET ?");
  }

  public long countJobs(String status, Long ruleId, Long taskId) {
    List<Object> args = new ArrayList<>();
    String where = "WHERE t.deleted_at IS NULL";
    if (status != null && !status.isBlank()) {
      where += " AND aj.status = ?";
      args.add(status);
    }
    if (ruleId != null) {
      where += " AND aj.rule_id = ?";
      args.add(ruleId);
    }
    if (taskId != null) {
      where += " AND t.id = ?";
      args.add(taskId);
    }
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM ai_review_jobs aj
        JOIN annotations an ON an.id = aj.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        """ + where,
        Long.class,
        args.toArray());
    return count == null ? 0L : count;
  }

  private List<AiReviewRuleRecord> queryRules(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          r.id,
          r.name,
          r.scope_task_id,
          t.title AS scope_task_title,
          r.prompt_template,
          CAST(r.dimensions_json AS CHAR) AS dimensions_json,
          r.pass_threshold,
          r.need_human_threshold,
          r.max_retry,
          r.retry_backoff_sec,
          r.status,
          r.version,
          u.name AS created_by_name,
          r.created_at,
          r.updated_at
        FROM ai_review_rules r
        LEFT JOIN tasks t ON t.id = r.scope_task_id
        LEFT JOIN users u ON u.id = r.created_by
        """ + whereClause + " " + suffix;
    return jdbcTemplate.query(sql, this::mapRule, args.toArray());
  }

  private List<AiReviewJobRecord> queryJobs(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          aj.id,
          aj.annotation_id,
          an.revision_no,
          t.id AS task_id,
          t.title AS task_title,
          (
            SELECT COUNT(*)
            FROM assignments ranked
            WHERE ranked.task_id = a.task_id
              AND ranked.status <> 'voided'
              AND ranked.id <= a.id
          ) AS item_index,
          (
            SELECT COUNT(*)
            FROM assignments total_assignments
            WHERE total_assignments.task_id = a.task_id
              AND total_assignments.status <> 'voided'
          ) AS item_total,
          aj.rule_id,
          COALESCE(r.name, JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.name'))) AS rule_name,
          CAST(aj.rule_snapshot_json AS CHAR) AS rule_snapshot_json,
          aj.status,
          aj.run_token,
          aj.retry_count,
          aj.error_summary,
          aj.cancel_reason,
          aj.available_at,
          aj.started_at,
          aj.finished_at,
          aj.created_at,
          aj.updated_at,
          air.decision,
          air.total_score
        FROM ai_review_jobs aj
        JOIN annotations an ON an.id = aj.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN ai_review_rules r ON r.id = aj.rule_id
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        """ + whereClause + " " + suffix;
    return jdbcTemplate.query(sql, this::mapJob, args.toArray());
  }

  private AiReviewRuleRecord mapRule(java.sql.ResultSet rs, int rowNum)
      throws java.sql.SQLException {
    return new AiReviewRuleRecord(
        rs.getLong("id"),
        rs.getString("name"),
        toLong(rs.getObject("scope_task_id")),
        rs.getString("scope_task_title"),
        rs.getString("prompt_template"),
        rs.getString("dimensions_json"),
        rs.getDouble("pass_threshold"),
        rs.getDouble("need_human_threshold"),
        rs.getInt("max_retry"),
        rs.getInt("retry_backoff_sec"),
        rs.getString("status"),
        rs.getInt("version"),
        rs.getString("created_by_name"),
        toLocalDateTime(rs.getTimestamp("created_at")),
        toLocalDateTime(rs.getTimestamp("updated_at")));
  }

  private AiReviewJobRecord mapJob(java.sql.ResultSet rs, int rowNum)
      throws java.sql.SQLException {
    return new AiReviewJobRecord(
        rs.getLong("id"),
        rs.getLong("annotation_id"),
        rs.getInt("revision_no"),
        rs.getLong("task_id"),
        rs.getString("task_title"),
        toInteger(rs.getObject("item_index")),
        toInteger(rs.getObject("item_total")),
        toLong(rs.getObject("rule_id")),
        rs.getString("rule_name"),
        rs.getString("rule_snapshot_json"),
        rs.getString("status"),
        rs.getString("run_token"),
        rs.getInt("retry_count"),
        rs.getString("error_summary"),
        rs.getString("cancel_reason"),
        toLocalDateTime(rs.getTimestamp("available_at")),
        toLocalDateTime(rs.getTimestamp("started_at")),
        toLocalDateTime(rs.getTimestamp("finished_at")),
        toLocalDateTime(rs.getTimestamp("created_at")),
        toLocalDateTime(rs.getTimestamp("updated_at")),
        rs.getString("decision"),
        toDouble(rs.getObject("total_score")));
  }

  private AiReviewResultRecord mapResult(java.sql.ResultSet rs, int rowNum)
      throws java.sql.SQLException {
    return new AiReviewResultRecord(
        rs.getLong("id"),
        rs.getLong("annotation_id"),
        rs.getString("scores_json"),
        toDouble(rs.getObject("total_score")),
        rs.getString("decision"),
        rs.getString("comment"),
        rs.getString("risk_flags_json"),
        rs.getString("evidence_json"),
        rs.getString("prompt_snapshot"),
        rs.getString("response_json"),
        rs.getString("model_name"),
        toInteger(rs.getObject("latency_ms")));
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private Integer toInteger(Object value) {
    return value == null ? null : ((Number) value).intValue();
  }

  private Double toDouble(Object value) {
    return value == null ? null : ((Number) value).doubleValue();
  }

  public record AiReviewRuleRecord(
      long id,
      String name,
      Long scopeTaskId,
      String scopeTaskTitle,
      String promptTemplate,
      String dimensionsJson,
      double passThreshold,
      double needHumanThreshold,
      int maxRetry,
      int retryBackoffSec,
      String status,
      int version,
      String createdByName,
      LocalDateTime createdAt,
      LocalDateTime updatedAt) {}

  public record AiReviewJobRecord(
      long id,
      long annotationId,
      int revisionNo,
      long taskId,
      String taskTitle,
      Integer itemIndex,
      Integer itemTotal,
      Long ruleId,
      String ruleName,
      String ruleSnapshotJson,
      String status,
      String runToken,
      int retryCount,
      String errorSummary,
      String cancelReason,
      LocalDateTime availableAt,
      LocalDateTime startedAt,
      LocalDateTime finishedAt,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      String decision,
      Double totalScore) {}

  public record AiReviewJobPayloadRecord(
      long jobId,
      long annotationId,
      long taskId,
      String taskTitle,
      String rawPayloadJson,
      String mediaType,
      String mediaUrl,
      String contentMarkdown,
      String answerJson,
      String schemaSnapshotJson,
      String ruleSnapshotJson) {}

  public record AiReviewResultRecord(
      long id,
      long annotationId,
      String scoresJson,
      Double totalScore,
      String decision,
      String comment,
      String riskFlagsJson,
      String evidenceJson,
      String promptSnapshot,
      String responseJson,
      String modelName,
      Integer latencyMs) {}

  public record AiReviewJobTimelineRecord(
      long annotationId,
      int revisionNo,
      long jobId,
      String jobStatus,
      int retryCount,
      String errorSummary,
      String cancelReason,
      LocalDateTime createdAt,
      LocalDateTime availableAt,
      LocalDateTime startedAt,
      LocalDateTime finishedAt,
      String decision,
      Double totalScore,
      String comment) {}
}
