package com.labelhub.backend.review;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
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

  public long countPendingBatches(long reviewerId) {
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM (
          SELECT a.task_id
          FROM annotations an
          JOIN assignments a ON a.id = an.assignment_id
          JOIN tasks t ON t.id = a.task_id
          WHERE an.status IN ('ai_reviewing', 'reviewing')
            AND t.deleted_at IS NULL
            AND """ + reviewerAssignmentFilter(reviewerId) + """
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

  public List<ReviewBatchRecord> listBatches(long reviewerId, String status, String keyword, int limit, int offset) {
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
        WHERE t.deleted_at IS NULL
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND """ + reviewerAssignmentFilter(reviewerId) + """
          AND an.id = (
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

  public long countBatches(long reviewerId, String status, String keyword) {
    return listBatches(reviewerId, status, keyword, Integer.MAX_VALUE, 0).size();
  }

  public Optional<ReviewBatchRecord> findBatch(long reviewerId, long taskId) {
    return listBatches(reviewerId, null, Long.toString(taskId), 1, 0).stream()
        .filter(batch -> batch.taskId() == taskId)
        .findFirst();
  }

  public List<AnnotationReviewRecord> listAnnotations(long reviewerId, long taskId, String decision, int limit, int offset) {
    String taskFilter = taskId > 0 ? "AND a.task_id = ?" : "";
    String decisionFilter = decision == null || decision.isBlank()
        ? ""
        : "AND LOWER(COALESCE(hr.decision, '')) = ?";
    String sql = """
        SELECT
          an.id AS annotation_id,
          an.assignment_id,
          a.item_id,
          a.task_id,
          t.title AS task_title,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          (
            SELECT COUNT(*)
            FROM assignments ranked
            WHERE ranked.task_id = a.task_id
              AND ranked.labeler_id = a.labeler_id
              AND ranked.status <> 'voided'
              AND ranked.id <= a.id
          ) AS item_index,
          an.schema_version_id,
          u.name AS labeler_name,
          an.submitted_at,
          CAST(an.schema_snapshot_json AS CHAR) AS schema_snapshot_json,
          CAST(an.answer_json AS CHAR) AS answer_json,
          (
            SELECT CAST(prev.answer_json AS CHAR)
            FROM annotations prev
            WHERE prev.assignment_id = an.assignment_id
              AND prev.revision_no < an.revision_no
              AND prev.status <> 'voided'
            ORDER BY prev.revision_no DESC, prev.id DESC
            LIMIT 1
          ) AS previous_answer_json,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          an.status AS annotation_status,
          an.revision_no,
          hr.decision AS human_decision,
          COALESCE(dispute_counts.disputes, 0) AS dispute_count,
          aj.id AS ai_job_id,
          aj.finished_at AS ai_finished_at,
          air.decision AS ai_decision,
          CAST(air.scores_json AS CHAR) AS ai_scores_json,
          air.total_score AS ai_total_score,
          air.comment AS ai_comment,
          CAST(air.risk_flags_json AS CHAR) AS ai_risk_flags_json,
          CAST(air.evidence_json AS CHAR) AS ai_evidence_json,
          CAST(air.response_json AS CHAR) AS ai_response_json,
          air.model_name AS ai_model_name,
          COALESCE(r.name, JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.name'))) AS ai_rule_name,
          JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.version')) AS ai_rule_version,
          hr.reason AS human_reason,
          hr.created_at AS human_reviewed_at,
          reviewer.name AS human_reviewer_name
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        JOIN users u ON u.id = a.labeler_id
        LEFT JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        LEFT JOIN ai_review_rules r ON r.id = aj.rule_id
        LEFT JOIN human_reviews hr ON hr.id = (
          SELECT latest_hr.id
          FROM human_reviews latest_hr
          WHERE latest_hr.annotation_id = an.id
          ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
          LIMIT 1
        )
        LEFT JOIN users reviewer ON reviewer.id = hr.reviewer_id
        LEFT JOIN (
          SELECT annotation_id, COUNT(*) AS disputes
          FROM human_reviews
          WHERE LOWER(decision) = 'escalate'
          GROUP BY annotation_id
        ) dispute_counts ON dispute_counts.annotation_id = an.id
        WHERE t.deleted_at IS NULL
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND """ + reviewerAssignmentFilter(reviewerId) + """
          AND an.id = (
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

  public long countAnnotations(long reviewerId, long taskId, String decision) {
    return listAnnotations(reviewerId, taskId, decision, Integer.MAX_VALUE, 0).size();
  }

  public List<AiReviewTaskSummaryRecord> listAiReviewTaskSummaries(
      long reviewerId,
      String view,
      String decision,
      String keyword,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    String filters = buildAiReviewViewFilters(reviewerId, view, decision, keyword, args);
    args.add(limit);
    args.add(offset);
    String pendingExpr = pendingHumanCountExpr(view);
    String reviewedExpr = reviewedCountExpr(view);
    String selectMetricsClause = ""
        + "          " + pendingExpr + " AS pending_human,\n"
        + "          " + reviewedExpr + " AS reviewed_count,\n";
    String sql = """
        SELECT
          t.id AS task_id,
          t.title AS task_title,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          COUNT(*) AS total,
          SUM(CASE WHEN air.decision = 'PASS' THEN 1 ELSE 0 END) AS pass_count,
          SUM(CASE WHEN air.decision = 'NEED_HUMAN_REVIEW' THEN 1 ELSE 0 END) AS need_human_count,
          SUM(CASE WHEN air.decision = 'REJECT' THEN 1 ELSE 0 END) AS reject_count,
        """ + selectMetricsClause + """
          MAX(COALESCE(air.created_at, an.updated_at)) AS updated_at
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          JOIN ai_review_results latest_result ON latest_result.job_id = latest_job.id
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        JOIN ai_review_results air ON air.job_id = aj.id
        WHERE
        """ + filters + """
        GROUP BY t.id, t.title, task_type
        ORDER BY updated_at DESC, t.id DESC
        LIMIT ? OFFSET ?
        """;
    return jdbcTemplate.query(sql, this::mapAiReviewTaskSummary, args.toArray());
  }

  public long countAiReviewTaskSummaries(
      long reviewerId,
      String view,
      String decision,
      String keyword) {
    List<Object> args = new ArrayList<>();
    String filters = buildAiReviewViewFilters(reviewerId, view, decision, keyword, args);
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM (
          SELECT t.id
          FROM annotations an
          JOIN assignments a ON a.id = an.assignment_id
          JOIN tasks t ON t.id = a.task_id
          JOIN ai_review_jobs aj ON aj.id = (
            SELECT latest_job.id
            FROM ai_review_jobs latest_job
            JOIN ai_review_results latest_result ON latest_result.job_id = latest_job.id
            WHERE latest_job.annotation_id = an.id
              AND latest_job.status = 'succeeded'
            ORDER BY latest_job.finished_at DESC, latest_job.id DESC
            LIMIT 1
          )
          JOIN ai_review_results air ON air.job_id = aj.id
          WHERE
        """ + filters + """
          GROUP BY t.id
        ) pending_tasks
        """,
        Long.class,
        args.toArray());
    return count == null ? 0 : count;
  }

  public List<AnnotationReviewRecord> listAiReviewAnnotations(
      long reviewerId,
      String view,
      long taskId,
      String decision,
      String keyword,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    args.add(taskId);
    String filters = buildAiReviewViewFilters(reviewerId, view, decision, keyword, args);
    // 已完成视图需要回填当前 reviewer 的最近一轮人工裁决,在子查询里只取该 reviewer 自己的记录,
    // 再 JOIN 出 reason / reviewed_at / reviewer_name,顺便用于 ORDER BY。
    boolean reviewed = !"pending".equals(view);
    args.add(limit);
    args.add(offset);
    String reviewerJoin = reviewed
        ? "        LEFT JOIN human_reviews my_hr ON my_hr.id = (\n"
            + "          SELECT latest_my_hr.id\n"
            + "          FROM human_reviews latest_my_hr\n"
            + "          WHERE latest_my_hr.annotation_id = an.id\n"
            + "            AND latest_my_hr.reviewer_id = " + reviewerId + "\n"
            + "          ORDER BY latest_my_hr.round_no DESC, latest_my_hr.id DESC\n"
            + "          LIMIT 1\n"
            + "        )\n"
            + "        LEFT JOIN users my_reviewer ON my_reviewer.id = my_hr.reviewer_id\n"
        : "";
    String humanColumns = reviewed
        ? "          my_hr.decision AS human_decision,\n"
            + "          my_hr.reason AS human_reason,\n"
            + "          my_hr.created_at AS human_reviewed_at,\n"
            + "          my_reviewer.name AS human_reviewer_name,\n"
        : "          NULL AS human_decision,\n"
            + "          NULL AS human_reason,\n"
            + "          NULL AS human_reviewed_at,\n"
            + "          NULL AS human_reviewer_name,\n";
    String orderBy = reviewed
        ? "ORDER BY COALESCE(my_hr.created_at, an.updated_at) DESC, an.id DESC"
        : "ORDER BY an.updated_at DESC, an.id DESC";
    String sql = """
        SELECT
          an.id AS annotation_id,
          an.assignment_id,
          a.item_id,
          a.task_id,
          t.title AS task_title,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          (
            SELECT COUNT(*)
            FROM assignments ranked
            WHERE ranked.task_id = a.task_id
              AND ranked.labeler_id = a.labeler_id
              AND ranked.status <> 'voided'
              AND ranked.id <= a.id
          ) AS item_index,
          an.schema_version_id,
          u.name AS labeler_name,
          an.submitted_at,
          CAST(an.schema_snapshot_json AS CHAR) AS schema_snapshot_json,
          CAST(an.answer_json AS CHAR) AS answer_json,
          (
            SELECT CAST(prev.answer_json AS CHAR)
            FROM annotations prev
            WHERE prev.assignment_id = an.assignment_id
              AND prev.revision_no < an.revision_no
              AND prev.status <> 'voided'
            ORDER BY prev.revision_no DESC, prev.id DESC
            LIMIT 1
          ) AS previous_answer_json,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          an.status AS annotation_status,
          an.revision_no,
        """ + humanColumns + """
          0 AS dispute_count,
          aj.id AS ai_job_id,
          aj.finished_at AS ai_finished_at,
          air.decision AS ai_decision,
          CAST(air.scores_json AS CHAR) AS ai_scores_json,
          air.total_score AS ai_total_score,
          air.comment AS ai_comment,
          CAST(air.risk_flags_json AS CHAR) AS ai_risk_flags_json,
          CAST(air.evidence_json AS CHAR) AS ai_evidence_json,
          CAST(air.response_json AS CHAR) AS ai_response_json,
          air.model_name AS ai_model_name,
          COALESCE(r.name, JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.name'))) AS ai_rule_name,
          JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.version')) AS ai_rule_version
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        JOIN users u ON u.id = a.labeler_id
        JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          JOIN ai_review_results latest_result ON latest_result.job_id = latest_job.id
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        JOIN ai_review_results air ON air.job_id = aj.id
        LEFT JOIN ai_review_rules r ON r.id = aj.rule_id
        """ + reviewerJoin + """
        WHERE a.task_id = ?
          AND
        """ + filters + "        " + orderBy + """

        LIMIT ? OFFSET ?
        """;
    return jdbcTemplate.query(sql, this::mapAnnotation, args.toArray());
  }

  public long countAiReviewAnnotations(
      long reviewerId,
      String view,
      long taskId,
      String decision,
      String keyword) {
    List<Object> args = new ArrayList<>();
    args.add(taskId);
    String filters = buildAiReviewViewFilters(reviewerId, view, decision, keyword, args);
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        JOIN users u ON u.id = a.labeler_id
        JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          JOIN ai_review_results latest_result ON latest_result.job_id = latest_job.id
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        JOIN ai_review_results air ON air.job_id = aj.id
        WHERE a.task_id = ?
          AND
        """ + filters,
        Long.class,
        args.toArray());
    return count == null ? 0 : count;
  }

  public Optional<AnnotationReviewRecord> findAnnotation(long annotationId) {
    return jdbcTemplate.query(
        """
        SELECT
          an.id AS annotation_id,
          an.assignment_id,
          a.item_id,
          a.task_id,
          t.title AS task_title,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          (
            SELECT COUNT(*)
            FROM assignments ranked
            WHERE ranked.task_id = a.task_id
              AND ranked.labeler_id = a.labeler_id
              AND ranked.status <> 'voided'
              AND ranked.id <= a.id
          ) AS item_index,
          an.schema_version_id,
          u.name AS labeler_name,
          an.submitted_at,
          CAST(an.schema_snapshot_json AS CHAR) AS schema_snapshot_json,
          CAST(an.answer_json AS CHAR) AS answer_json,
          (
            SELECT CAST(prev.answer_json AS CHAR)
            FROM annotations prev
            WHERE prev.assignment_id = an.assignment_id
              AND prev.revision_no < an.revision_no
              AND prev.status <> 'voided'
            ORDER BY prev.revision_no DESC, prev.id DESC
            LIMIT 1
          ) AS previous_answer_json,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          an.status AS annotation_status,
          an.revision_no,
          hr.decision AS human_decision,
          COALESCE(dispute_counts.disputes, 0) AS dispute_count,
          aj.id AS ai_job_id,
          aj.finished_at AS ai_finished_at,
          air.decision AS ai_decision,
          CAST(air.scores_json AS CHAR) AS ai_scores_json,
          air.total_score AS ai_total_score,
          air.comment AS ai_comment,
          CAST(air.risk_flags_json AS CHAR) AS ai_risk_flags_json,
          CAST(air.evidence_json AS CHAR) AS ai_evidence_json,
          CAST(air.response_json AS CHAR) AS ai_response_json,
          air.model_name AS ai_model_name,
          COALESCE(r.name, JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.name'))) AS ai_rule_name,
          JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.version')) AS ai_rule_version,
          hr.reason AS human_reason,
          hr.created_at AS human_reviewed_at,
          reviewer.name AS human_reviewer_name
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        JOIN users u ON u.id = a.labeler_id
        LEFT JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        LEFT JOIN ai_review_rules r ON r.id = aj.rule_id
        LEFT JOIN human_reviews hr ON hr.id = (
          SELECT latest_hr.id
          FROM human_reviews latest_hr
          WHERE latest_hr.annotation_id = an.id
          ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
          LIMIT 1
        )
        LEFT JOIN users reviewer ON reviewer.id = hr.reviewer_id
        LEFT JOIN (
          SELECT annotation_id, COUNT(*) AS disputes
          FROM human_reviews
          WHERE LOWER(decision) = 'escalate'
          GROUP BY annotation_id
        ) dispute_counts ON dispute_counts.annotation_id = an.id
        WHERE an.id = ?
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
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
          an.schema_version_id,
          CAST(an.schema_snapshot_json AS CHAR) AS schema_snapshot_json,
          CAST(an.answer_json AS CHAR) AS answer_json,
          an.revision_no,
          a.item_id
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE an.id = ?
          AND an.status <> 'voided'
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
        FOR UPDATE
        """,
        (rs, rowNum) -> new AnnotationStateRecord(
            rs.getLong("annotation_id"),
            rs.getLong("assignment_id"),
            rs.getLong("item_id"),
            rs.getLong("schema_version_id"),
            rs.getString("schema_snapshot_json"),
            rs.getString("answer_json"),
            rs.getInt("revision_no"),
            rs.getString("annotation_status"),
            rs.getString("assignment_status")),
        annotationId)
        .stream()
        .findFirst();
  }

  public List<ReviewTimelineEventRecord> listAssignmentReviewTimeline(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT
          an.id AS annotation_id,
          an.revision_no,
          aj.finished_at AS ai_finished_at,
          air.decision AS ai_decision,
          air.total_score AS ai_total_score,
          air.comment AS ai_comment,
          hr.decision AS human_decision,
          hr.reason AS human_reason,
          hr.created_at AS human_reviewed_at,
          reviewer.name AS human_reviewer_name
        FROM annotations an
        LEFT JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        LEFT JOIN ai_review_results air ON air.job_id = aj.id
        LEFT JOIN human_reviews hr ON hr.id = (
          SELECT latest_hr.id
          FROM human_reviews latest_hr
          WHERE latest_hr.annotation_id = an.id
          ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
          LIMIT 1
        )
        LEFT JOIN users reviewer ON reviewer.id = hr.reviewer_id
        WHERE an.assignment_id = ?
          AND an.status <> 'voided'
        ORDER BY an.revision_no ASC, an.id ASC
        """,
        (rs, rowNum) -> new ReviewTimelineEventRecord(
            rs.getLong("annotation_id"),
            rs.getInt("revision_no"),
            toLocalDateTime(rs.getTimestamp("ai_finished_at")),
            rs.getString("ai_decision"),
            toDouble(rs.getObject("ai_total_score")),
            rs.getString("ai_comment"),
            rs.getString("human_decision"),
            rs.getString("human_reason"),
            toLocalDateTime(rs.getTimestamp("human_reviewed_at")),
            rs.getString("human_reviewer_name")),
        assignmentId);
  }

  public void updateAnnotationStatus(long annotationId, String status) {
    jdbcTemplate.update(
        "UPDATE annotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        status,
        annotationId);
  }

  public long createAnnotation(
      long assignmentId,
      long schemaVersionId,
      String schemaSnapshotJson,
      String answerJson,
      int revisionNo,
      String status) {
    org.springframework.jdbc.support.GeneratedKeyHolder keyHolder =
        new org.springframework.jdbc.support.GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO annotations
            (assignment_id, schema_version_id, schema_snapshot_json, answer_json, status, revision_no, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          """,
          java.sql.Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, assignmentId);
      statement.setLong(2, schemaVersionId);
      statement.setString(3, schemaSnapshotJson);
      statement.setString(4, answerJson);
      statement.setString(5, status);
      statement.setInt(6, revisionNo);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create annotation");
    }
    return key.longValue();
  }

  public void updateAssignmentStatus(long assignmentId, String status) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = ?,
            submitted_at = CASE
              WHEN ? IN ('submitted', 'accepted') AND submitted_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE submitted_at
            END,
            resubmit_deadline = CASE
              WHEN ? IN ('submitted', 'accepted', 'voided') THEN NULL
              ELSE resubmit_deadline
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        status,
        status,
        status,
        assignmentId);
  }

  public void returnAssignmentForRework(long assignmentId, LocalDateTime resubmitDeadline) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = 'returned',
            resubmit_deadline = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        Timestamp.valueOf(resubmitDeadline),
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

  public boolean hasOpenDispute(long annotationId) {
    Boolean exists = jdbcTemplate.queryForObject(
        """
        SELECT EXISTS(
          SELECT 1
          FROM human_reviews hr
          JOIN annotations an ON an.id = hr.annotation_id
          WHERE hr.annotation_id = ?
            AND LOWER(hr.decision) = 'escalate'
            AND an.status = 'reviewing'
            AND an.status <> 'voided'
        )
        """,
        Boolean.class,
        annotationId);
    return Boolean.TRUE.equals(exists);
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
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
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
        WHERE hr.id = ?
          AND LOWER(hr.decision) = 'escalate'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
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

  private AiReviewTaskSummaryRecord mapAiReviewTaskSummary(
      java.sql.ResultSet rs,
      int rowNum) throws java.sql.SQLException {
    return new AiReviewTaskSummaryRecord(
        rs.getLong("task_id"),
        rs.getString("task_title"),
        blankToDefault(rs.getString("task_type"), "Annotation Task"),
        rs.getLong("total"),
        rs.getLong("pass_count"),
        rs.getLong("need_human_count"),
        rs.getLong("reject_count"),
        rs.getLong("pending_human"),
        rs.getLong("reviewed_count"),
        toLocalDateTime(rs.getTimestamp("updated_at")));
  }

  private AnnotationReviewRecord mapAnnotation(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
    return new AnnotationReviewRecord(
        rs.getLong("annotation_id"),
        rs.getLong("assignment_id"),
        rs.getLong("item_id"),
        rs.getLong("task_id"),
        rs.getString("task_title"),
        blankToDefault(rs.getString("task_type"), "Annotation Task"),
        Math.max(rs.getInt("item_index"), 1),
        rs.getLong("schema_version_id"),
        rs.getString("labeler_name"),
        toLocalDateTime(rs.getTimestamp("submitted_at")),
        rs.getString("schema_snapshot_json"),
        rs.getString("answer_json"),
        rs.getString("previous_answer_json"),
        rs.getString("raw_payload_json"),
        rs.getString("annotation_status"),
        rs.getInt("revision_no"),
        rs.getString("human_decision"),
        rs.getInt("dispute_count") > 0,
        toLong(rs.getObject("ai_job_id")),
        toLocalDateTime(rs.getTimestamp("ai_finished_at")),
        rs.getString("ai_decision"),
        rs.getString("ai_scores_json"),
        toDouble(rs.getObject("ai_total_score")),
        rs.getString("ai_comment"),
        rs.getString("ai_risk_flags_json"),
        rs.getString("ai_evidence_json"),
        rs.getString("ai_response_json"),
        rs.getString("ai_model_name"),
        rs.getString("ai_rule_name"),
        rs.getString("ai_rule_version"),
        rs.getString("human_reason"),
        toLocalDateTime(rs.getTimestamp("human_reviewed_at")),
        rs.getString("human_reviewer_name"));
  }

  /**
   * 构造 AI 预审查询的视图过滤条件。
   *
   * 三个视图共享:
   *   - 任务未删除、assignment 未作废
   *   - 仅取每条 assignment 的最新一版 annotation
   *   - 可选 AI 决策 / 关键字过滤
   *
   * pending(默认):标注还在 reviewing 状态,且当前 reviewer 未审过(允许其他 reviewer 已审,这部分留给负载分配视图判断)。
   * reviewed:当前 reviewer 已写过 human_reviews,不限 annotation 状态。
   * all:pending 与 reviewed 的并集。
   */
  private String buildAiReviewViewFilters(
      long reviewerId,
      String view,
      String decision,
      String keyword,
      List<Object> args) {
    StringBuilder filters = new StringBuilder(
        """
        t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND """ + reviewerAssignmentFilter(reviewerId) + """
          AND an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = an.assignment_id
              AND latest.status <> 'voided'
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
        """);
    String safeView = view == null ? "pending" : view;
    switch (safeView) {
      case "reviewed" -> filters.append(
          """
            AND EXISTS (
              SELECT 1 FROM human_reviews hr_done
              WHERE hr_done.annotation_id = an.id
                AND hr_done.reviewer_id = """ + reviewerId + """
            )
          """);
      case "all" -> filters.append(
          """
            AND (
              (an.status = 'reviewing' AND NOT EXISTS (
                SELECT 1 FROM human_reviews hr_pending
                WHERE hr_pending.annotation_id = an.id
              ))
              OR EXISTS (
                SELECT 1 FROM human_reviews hr_done
                WHERE hr_done.annotation_id = an.id
                  AND hr_done.reviewer_id = """ + reviewerId + """
              )
            )
          """);
      default -> filters.append(
          """
            AND an.status = 'reviewing'
            AND NOT EXISTS (
              SELECT 1
              FROM human_reviews hr_pending
              WHERE hr_pending.annotation_id = an.id
            )
          """);
    }
    if (decision != null && !decision.isBlank()) {
      filters.append("  AND air.decision = ?\n");
      args.add(decision);
    }
    if (keyword != null && !keyword.isBlank()) {
      String like = "%" + keyword.trim() + "%";
      filters.append(
          """
            AND (
              t.title LIKE ?
              OR JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) LIKE ?
              OR CAST(t.id AS CHAR) LIKE ?
              OR CAST(an.id AS CHAR) LIKE ?
            )
          """);
      args.add(like);
      args.add(like);
      args.add(like);
      args.add(like);
    }
    return filters.toString();
  }

  private String reviewerAssignmentFilter(long reviewerId) {
    return """
        (
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
              AND tri.reviewer_id = """ + reviewerId + """
          )
        )
        """;
  }

  public boolean canReviewerAccessAnnotation(long reviewerId, long annotationId) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE an.id = ?
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
          AND """ + reviewerAssignmentFilter(reviewerId),
        Integer.class,
        annotationId);
    return count != null && count > 0;
  }

  /** 任务摘要里的 pending_human 表达式:依据视图区分待审计数。 */
  private String pendingHumanCountExpr(String view) {
    return switch (view == null ? "pending" : view) {
      case "reviewed" -> "0";
      case "all" -> "SUM(CASE WHEN an.status = 'reviewing' "
          + "AND NOT EXISTS (SELECT 1 FROM human_reviews hr_count "
          + "WHERE hr_count.annotation_id = an.id) THEN 1 ELSE 0 END)";
      default -> "COUNT(*)";
    };
  }

  /** 任务摘要里的 reviewed_count 表达式:已被当前 reviewer 审过的条数。 */
  private String reviewedCountExpr(String view) {
    return switch (view == null ? "pending" : view) {
      case "pending" -> "0";
      default -> "SUM(CASE WHEN EXISTS ("
          + "SELECT 1 FROM human_reviews hr_done "
          + "WHERE hr_done.annotation_id = an.id) THEN 1 ELSE 0 END)";
    };
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private Double toDouble(Object value) {
    return value == null ? null : ((Number) value).doubleValue();
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

  public record AiReviewTaskSummaryRecord(
      long taskId,
      String taskTitle,
      String taskType,
      long total,
      long passCount,
      long needHumanCount,
      long rejectCount,
      long pendingHuman,
      long reviewedCount,
      LocalDateTime updatedAt) {}

  public record AnnotationReviewRecord(
      long annotationId,
      long assignmentId,
      long itemId,
      long taskId,
      String taskTitle,
      String taskType,
      int itemIndex,
      long schemaVersionId,
      String labelerName,
      LocalDateTime submittedAt,
      String schemaSnapshotJson,
      String answerJson,
      String previousAnswerJson,
      String rawPayloadJson,
      String annotationStatus,
      int revisionNo,
      String humanDecision,
      boolean dispute,
      Long aiJobId,
      LocalDateTime aiFinishedAt,
      String aiDecision,
      String aiScoresJson,
      Double aiTotalScore,
      String aiComment,
      String aiRiskFlagsJson,
      String aiEvidenceJson,
      String aiResponseJson,
      String aiModelName,
      String aiRuleName,
      String aiRuleVersion,
      String humanReason,
      LocalDateTime humanReviewedAt,
      String humanReviewerName) {}

  public record ReviewTimelineEventRecord(
      long annotationId,
      int revisionNo,
      LocalDateTime aiFinishedAt,
      String aiDecision,
      Double aiTotalScore,
      String aiComment,
      String humanDecision,
      String humanReason,
      LocalDateTime humanReviewedAt,
      String humanReviewerName) {}

  public record AnnotationStateRecord(
      long annotationId,
      long assignmentId,
      long itemId,
      long schemaVersionId,
      String schemaSnapshotJson,
      String answerJson,
      int revisionNo,
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
