package com.labelhub.backend.review;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ReviewRepository {

  private final JdbcTemplate jdbcTemplate;

  public ReviewRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countPendingBatches() {
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM (
          SELECT a.task_id
          FROM annotations an
          JOIN assignments a ON a.id = an.assignment_id
          WHERE an.status IN ('ai_reviewing', 'reviewing')
          GROUP BY a.task_id
        ) pending_tasks
        """,
        Long.class);
    return count == null ? 0 : count;
  }

  public long countHumanReviewsToday(String decision) {
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM human_reviews
        WHERE LOWER(decision) = ?
          AND DATE(created_at) = CURRENT_DATE()
        """,
        Long.class,
        decision);
    return count == null ? 0 : count;
  }

  public long countReviewedTotal(long reviewerId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM human_reviews WHERE reviewer_id = ?",
        Long.class,
        reviewerId);
    return count == null ? 0 : count;
  }

  public List<ReviewBatchRecord> listBatches(String status, String keyword, int limit, int offset) {
    String having = "";
    if (status != null && !status.isBlank()) {
      having = switch (status) {
        case "pending" -> "HAVING pending > 0 AND reviewed = 0";
        case "in_review" -> "HAVING pending > 0 AND reviewed > 0";
        case "completed" -> "HAVING pending = 0 AND reviewed > 0";
        default -> "";
      };
    }
    String keywordFilter = keyword == null || keyword.isBlank()
        ? ""
        : "AND (t.title LIKE ? OR CAST(t.id AS CHAR) LIKE ?)";
    String sql = """
        SELECT
          t.id AS task_id,
          t.title AS task_title,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          SUM(CASE WHEN an.status IN ('ai_reviewing', 'reviewing') THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN an.status IN ('accepted', 'returned', 'exported') THEN 1 ELSE 0 END) AS reviewed,
          SUM(CASE WHEN air.decision IN ('REJECT', 'NEED_HUMAN_REVIEW') THEN 1 ELSE 0 END) AS need_human_review,
          t.deadline,
          MAX(an.updated_at) AS updated_at
        FROM tasks t
        JOIN assignments a ON a.task_id = t.id
        JOIN annotations an ON an.assignment_id = a.id
        LEFT JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        WHERE an.id = (
          SELECT latest.id
          FROM annotations latest
          WHERE latest.assignment_id = a.id
          ORDER BY latest.revision_no DESC, latest.id DESC
          LIMIT 1
        )
        """ + keywordFilter + """
        GROUP BY t.id, t.title, task_type, t.deadline
        """ + having + """
        ORDER BY pending DESC, updated_at DESC
        LIMIT ? OFFSET ?
        """;
    if (keyword == null || keyword.isBlank()) {
      return jdbcTemplate.query(sql, this::mapBatch, limit, offset);
    }
    String like = "%" + keyword.trim() + "%";
    return jdbcTemplate.query(sql, this::mapBatch, like, like, limit, offset);
  }

  public long countBatches(String status, String keyword) {
    return listBatches(status, keyword, Integer.MAX_VALUE, 0).size();
  }

  public Optional<ReviewBatchRecord> findBatch(long taskId) {
    return listBatches(null, Long.toString(taskId), 1, 0).stream()
        .filter(batch -> batch.taskId() == taskId)
        .findFirst();
  }

  public List<AnnotationReviewRecord> listAnnotations(long taskId, String decision, int limit, int offset) {
    String taskFilter = taskId > 0 ? "AND a.task_id = ?" : "";
    String decisionFilter = decision == null || decision.isBlank()
        ? ""
        : "AND LOWER(COALESCE(hr.decision, '')) = ?";
    String sql = """
        SELECT
          an.id AS annotation_id,
          an.assignment_id,
          a.item_id,
          an.schema_version_id,
          u.name AS labeler_name,
          an.submitted_at,
          CAST(an.answer_json AS CHAR) AS answer_json,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          an.status AS annotation_status,
          an.revision_no,
          hr.decision AS human_decision,
          COALESCE(dispute_counts.disputes, 0) AS dispute_count,
          aj.id AS ai_job_id,
          air.decision AS ai_decision,
          CAST(air.scores_json AS CHAR) AS ai_scores_json,
          air.comment AS ai_comment,
          CAST(air.response_json AS CHAR) AS ai_response_json
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN items i ON i.id = a.item_id
        JOIN users u ON u.id = a.labeler_id
        LEFT JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        LEFT JOIN human_reviews hr ON hr.id = (
          SELECT latest_hr.id
          FROM human_reviews latest_hr
          WHERE latest_hr.annotation_id = an.id
          ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
          LIMIT 1
        )
        LEFT JOIN (
          SELECT annotation_id, COUNT(*) AS disputes
          FROM human_reviews
          WHERE LOWER(decision) = 'escalate'
          GROUP BY annotation_id
        ) dispute_counts ON dispute_counts.annotation_id = an.id
        WHERE an.id = (
          SELECT latest.id
          FROM annotations latest
          WHERE latest.assignment_id = an.assignment_id
          ORDER BY latest.revision_no DESC, latest.id DESC
          LIMIT 1
        )
        """ + taskFilter + """
        """ + decisionFilter + """
        ORDER BY an.updated_at DESC, an.id DESC
        LIMIT ? OFFSET ?
        """;
    if (taskId > 0 && decision != null && !decision.isBlank()) {
      return jdbcTemplate.query(sql, this::mapAnnotation, taskId, decision.toLowerCase(), limit, offset);
    }
    if (taskId > 0) {
      return jdbcTemplate.query(sql, this::mapAnnotation, taskId, limit, offset);
    }
    if (decision != null && !decision.isBlank()) {
      return jdbcTemplate.query(sql, this::mapAnnotation, decision.toLowerCase(), limit, offset);
    }
    return jdbcTemplate.query(sql, this::mapAnnotation, limit, offset);
  }

  public long countAnnotations(long taskId, String decision) {
    return listAnnotations(taskId, decision, Integer.MAX_VALUE, 0).size();
  }

  public Optional<AnnotationReviewRecord> findAnnotation(long annotationId) {
    return jdbcTemplate.query(
        """
        SELECT
          an.id AS annotation_id,
          an.assignment_id,
          a.item_id,
          an.schema_version_id,
          u.name AS labeler_name,
          an.submitted_at,
          CAST(an.answer_json AS CHAR) AS answer_json,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          an.status AS annotation_status,
          an.revision_no,
          hr.decision AS human_decision,
          COALESCE(dispute_counts.disputes, 0) AS dispute_count,
          aj.id AS ai_job_id,
          air.decision AS ai_decision,
          CAST(air.scores_json AS CHAR) AS ai_scores_json,
          air.comment AS ai_comment,
          CAST(air.response_json AS CHAR) AS ai_response_json
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN items i ON i.id = a.item_id
        JOIN users u ON u.id = a.labeler_id
        LEFT JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        LEFT JOIN human_reviews hr ON hr.id = (
          SELECT latest_hr.id
          FROM human_reviews latest_hr
          WHERE latest_hr.annotation_id = an.id
          ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
          LIMIT 1
        )
        LEFT JOIN (
          SELECT annotation_id, COUNT(*) AS disputes
          FROM human_reviews
          WHERE LOWER(decision) = 'escalate'
          GROUP BY annotation_id
        ) dispute_counts ON dispute_counts.annotation_id = an.id
        WHERE an.id = ?
        """,
        this::mapAnnotation,
        annotationId)
        .stream()
        .findFirst();
  }

  public Optional<AnnotationStateRecord> lockAnnotationState(long annotationId) {
    return jdbcTemplate.query(
        """
        SELECT
          an.id AS annotation_id,
          an.assignment_id,
          an.status AS annotation_status,
          a.status AS assignment_status,
          a.item_id
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        WHERE an.id = ?
        FOR UPDATE
        """,
        (rs, rowNum) -> new AnnotationStateRecord(
            rs.getLong("annotation_id"),
            rs.getLong("assignment_id"),
            rs.getLong("item_id"),
            rs.getString("annotation_status"),
            rs.getString("assignment_status")),
        annotationId)
        .stream()
        .findFirst();
  }

  public void updateAnnotationStatus(long annotationId, String status) {
    jdbcTemplate.update(
        "UPDATE annotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        status,
        annotationId);
  }

  public void updateAssignmentStatus(long assignmentId, String status) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        status,
        assignmentId);
  }

  public void updateItemStatus(long itemId, String status) {
    jdbcTemplate.update(
        "UPDATE items SET item_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        status,
        itemId);
  }

  public int nextReviewRound(long annotationId) {
    Integer next = jdbcTemplate.queryForObject(
        "SELECT COALESCE(MAX(round_no), 0) + 1 FROM human_reviews WHERE annotation_id = ?",
        Integer.class,
        annotationId);
    return next == null ? 1 : next;
  }

  public void createHumanReview(
      long annotationId,
      long reviewerId,
      int roundNo,
      String decision,
      String reason,
      String diffJson) {
    jdbcTemplate.update(
        """
        INSERT INTO human_reviews (annotation_id, reviewer_id, round_no, decision, reason, diff_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        annotationId,
        reviewerId,
        roundNo,
        decision,
        reason,
        diffJson);
  }

  public List<DisputeRecord> listDisputes(String status, int limit, int offset) {
    String statusFilter = "";
    if ("open".equals(status)) {
      statusFilter = "AND an.status = 'reviewing'";
    } else if ("resolved".equals(status)) {
      statusFilter = "AND an.status IN ('accepted', 'returned', 'exported')";
    }
    return jdbcTemplate.query(
        """
        SELECT
          hr.id AS dispute_id,
          an.id AS annotation_id,
          a.task_id,
          t.title AS task_title,
          hr.reason,
          u.name AS raised_by,
          hr.created_at AS raised_at,
          CASE WHEN an.status = 'reviewing' THEN 'open' ELSE 'resolved' END AS dispute_status,
          (
            SELECT COUNT(*)
            FROM human_reviews all_hr
            WHERE all_hr.annotation_id = an.id
          ) AS rounds
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN users u ON u.id = hr.reviewer_id
        WHERE LOWER(hr.decision) = 'escalate'
        """ + statusFilter + """
        ORDER BY hr.created_at DESC, hr.id DESC
        LIMIT ? OFFSET ?
        """,
        (rs, rowNum) -> new DisputeRecord(
            rs.getLong("dispute_id"),
            rs.getLong("annotation_id"),
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getString("reason"),
            rs.getString("raised_by"),
            toLocalDateTime(rs.getTimestamp("raised_at")),
            rs.getString("dispute_status"),
            rs.getInt("rounds")),
        limit,
        offset);
  }

  public long countDisputes(String status) {
    return listDisputes(status, Integer.MAX_VALUE, 0).size();
  }

  public Optional<DisputeRecord> findDispute(long disputeId) {
    return jdbcTemplate.query(
        """
        SELECT
          hr.id AS dispute_id,
          an.id AS annotation_id,
          a.task_id,
          t.title AS task_title,
          hr.reason,
          u.name AS raised_by,
          hr.created_at AS raised_at,
          CASE WHEN an.status = 'reviewing' THEN 'open' ELSE 'resolved' END AS dispute_status,
          (
            SELECT COUNT(*)
            FROM human_reviews all_hr
            WHERE all_hr.annotation_id = an.id
          ) AS rounds
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN users u ON u.id = hr.reviewer_id
        WHERE hr.id = ? AND LOWER(hr.decision) = 'escalate'
        """,
        (rs, rowNum) -> new DisputeRecord(
            rs.getLong("dispute_id"),
            rs.getLong("annotation_id"),
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getString("reason"),
            rs.getString("raised_by"),
            toLocalDateTime(rs.getTimestamp("raised_at")),
            rs.getString("dispute_status"),
            rs.getInt("rounds")),
        disputeId)
        .stream()
        .findFirst();
  }

  private ReviewBatchRecord mapBatch(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    long pending = rs.getLong("pending");
    long reviewed = rs.getLong("reviewed");
    long needHuman = rs.getLong("need_human_review");
    String status = pending == 0 && reviewed > 0 ? "completed" : reviewed > 0 ? "in_review" : "pending";
    String priority = needHuman > 0 ? "high" : "normal";
    return new ReviewBatchRecord(
        rs.getLong("task_id"),
        rs.getString("task_title"),
        blankToDefault(rs.getString("task_type"), "Annotation Task"),
        pending,
        reviewed,
        needHuman,
        1.0,
        priority,
        status,
        toLocalDateTime(rs.getTimestamp("deadline")),
        toLocalDateTime(rs.getTimestamp("updated_at")));
  }

  private AnnotationReviewRecord mapAnnotation(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new AnnotationReviewRecord(
        rs.getLong("annotation_id"),
        rs.getLong("assignment_id"),
        rs.getLong("item_id"),
        rs.getLong("schema_version_id"),
        rs.getString("labeler_name"),
        toLocalDateTime(rs.getTimestamp("submitted_at")),
        rs.getString("answer_json"),
        rs.getString("raw_payload_json"),
        rs.getString("annotation_status"),
        rs.getInt("revision_no"),
        rs.getString("human_decision"),
        rs.getInt("dispute_count") > 0,
        toLong(rs.getObject("ai_job_id")),
        rs.getString("ai_decision"),
        rs.getString("ai_scores_json"),
        rs.getString("ai_comment"),
        rs.getString("ai_response_json"));
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  public record ReviewBatchRecord(
      long taskId,
      String taskTitle,
      String taskType,
      long pending,
      long reviewed,
      long needHumanReview,
      double samplingRatio,
      String priority,
      String status,
      LocalDateTime deadline,
      LocalDateTime updatedAt) {}

  public record AnnotationReviewRecord(
      long annotationId,
      long assignmentId,
      long itemId,
      long schemaVersionId,
      String labelerName,
      LocalDateTime submittedAt,
      String answerJson,
      String rawPayloadJson,
      String annotationStatus,
      int revisionNo,
      String humanDecision,
      boolean dispute,
      Long aiJobId,
      String aiDecision,
      String aiScoresJson,
      String aiComment,
      String aiResponseJson) {}

  public record AnnotationStateRecord(
      long annotationId,
      long assignmentId,
      long itemId,
      String annotationStatus,
      String assignmentStatus) {}

  public record DisputeRecord(
      long disputeId,
      long annotationId,
      long taskId,
      String taskTitle,
      String reason,
      String raisedBy,
      LocalDateTime raisedAt,
      String status,
      int rounds) {}
}
