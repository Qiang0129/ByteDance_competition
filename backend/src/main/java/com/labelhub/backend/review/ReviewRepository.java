package com.labelhub.backend.review;

import java.sql.Timestamp;
import java.time.LocalDate;
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

  public ReviewerDecisionCounts countReviewerDecisions(long reviewerId, LocalDateTime startAt) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE WHEN LOWER(hr.decision) IN ('approve', 'revise') THEN 1 ELSE 0 END) AS approve_count,
          SUM(CASE WHEN LOWER(hr.decision) = 'return' THEN 1 ELSE 0 END) AS return_count,
          SUM(CASE WHEN LOWER(hr.decision) = 'escalate' THEN 1 ELSE 0 END) AS dispute_count
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE hr.reviewer_id = ?
          AND hr.created_at >= ?
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        """,
        (rs, rowNum) -> new ReviewerDecisionCounts(
            rs.getLong("approve_count"),
            rs.getLong("return_count"),
            rs.getLong("dispute_count")),
        reviewerId,
        Timestamp.valueOf(startAt));
  }

  public List<ReviewerTrendRecord> listReviewerTrend(long reviewerId, LocalDateTime startAt) {
    return jdbcTemplate.query(
        """
        SELECT
          DATE(hr.created_at) AS review_date,
          SUM(CASE WHEN LOWER(hr.decision) IN ('approve', 'revise') THEN 1 ELSE 0 END) AS approve_count,
          SUM(CASE WHEN LOWER(hr.decision) = 'return' THEN 1 ELSE 0 END) AS return_count,
          SUM(CASE WHEN LOWER(hr.decision) = 'escalate' THEN 1 ELSE 0 END) AS dispute_count
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE hr.reviewer_id = ?
          AND hr.created_at >= ?
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        GROUP BY DATE(hr.created_at)
        ORDER BY review_date ASC
        """,
        (rs, rowNum) -> new ReviewerTrendRecord(
            rs.getDate("review_date").toLocalDate(),
            rs.getLong("approve_count"),
            rs.getLong("return_count"),
            rs.getLong("dispute_count")),
        reviewerId,
        Timestamp.valueOf(startAt));
  }

  public ReviewerAiConsistencyCounts countReviewerAiConsistency(long reviewerId, LocalDateTime startAt) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE
            WHEN aj.decision = 'PASS' AND LOWER(hr.decision) IN ('approve', 'revise') THEN 1
            WHEN aj.decision = 'REJECT' AND LOWER(hr.decision) IN ('return', 'escalate') THEN 1
            ELSE 0
          END) AS consistent_count
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        WHERE hr.reviewer_id = ?
          AND hr.created_at >= ?
          AND aj.decision IN ('PASS', 'REJECT')
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        """,
        (rs, rowNum) -> new ReviewerAiConsistencyCounts(
            rs.getLong("consistent_count"),
            rs.getLong("total_count")),
        reviewerId,
        Timestamp.valueOf(startAt));
  }

  public ReviewerSamplingCoverageCounts countReviewerSamplingCoverage(long reviewerId, LocalDateTime startAt) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          COUNT(DISTINCT an.id) AS total_pass_count,
          COUNT(DISTINCT CASE WHEN EXISTS (
            SELECT 1
            FROM human_reviews hr_done
            WHERE hr_done.annotation_id = an.id
              AND hr_done.reviewer_id = ?
              AND hr_done.created_at >= ?
          ) THEN an.id END) AS sampled_pass_count
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        WHERE aj.decision = 'PASS'
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
          AND """ + reviewerAssignmentFilter(reviewerId) + """
        """,
        (rs, rowNum) -> new ReviewerSamplingCoverageCounts(
            rs.getLong("sampled_pass_count"),
            rs.getLong("total_pass_count")),
        reviewerId,
        Timestamp.valueOf(startAt));
  }

  public List<ReviewerReviewDetailRecord> listReviewerReviewDetails(
      long reviewerId,
      LocalDateTime startAt,
      Long taskId,
      String decision) {
    List<Object> args = new ArrayList<>();
    args.add(reviewerId);
    args.add(Timestamp.valueOf(startAt));
    String taskFilter = "";
    if (taskId != null) {
      taskFilter = "AND a.task_id = ?\n";
      args.add(taskId);
    }
    String decisionFilter = "";
    if (decision != null && !decision.isBlank()) {
      decisionFilter = "AND LOWER(hr.decision) = ?\n";
      args.add(decision.toLowerCase());
    }
    String sql = """
        SELECT
          hr.created_at AS reviewed_at,
          a.task_id,
          t.title AS task_title,
          a.item_id,
          an.id AS annotation_id,
          an.revision_no,
          hr.decision,
          hr.reason,
          aj.decision AS ai_decision,
          aj.total_score AS ai_total_score,
          labeler.name AS labeler_name,
          reviewer.name AS reviewer_name
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN users labeler ON labeler.id = a.labeler_id
        JOIN users reviewer ON reviewer.id = hr.reviewer_id
        LEFT JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        WHERE hr.reviewer_id = ?
          AND hr.created_at >= ?
          AND an.status <> 'voided'
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        """ + taskFilter + decisionFilter + """
        ORDER BY hr.created_at DESC, hr.id DESC
        """;
    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new ReviewerReviewDetailRecord(
            toLocalDateTime(rs.getTimestamp("reviewed_at")),
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getLong("item_id"),
            rs.getLong("annotation_id"),
            rs.getInt("revision_no"),
            rs.getString("decision"),
            rs.getString("reason"),
            rs.getString("ai_decision"),
            toDouble(rs.getObject("ai_total_score")),
            rs.getString("labeler_name"),
            rs.getString("reviewer_name")),
        args.toArray());
  }

  public List<ReviewBatchRecord> listBatches(long reviewerId, String status, String keyword, int limit, int offset) {
    String having = "";
    if (status != null && !status.isBlank()) {
      having = switch (status) {
        case "pending" -> "HAVING pending > 0 AND reviewed = 0\n";
        case "in_review" -> "HAVING pending > 0 AND reviewed > 0\n";
        case "completed" -> "HAVING pending = 0 AND reviewed > 0\n";
        default -> "";
      };
    }
    String keywordFilter = keyword == null || keyword.isBlank()
        ? ""
        : "AND (t.title LIKE ? OR CAST(t.id AS CHAR) LIKE ?)\n";
    String sql = """
        SELECT
          t.id AS task_id,
          t.title AS task_title,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          SUM(CASE WHEN an.status IN ('ai_reviewing', 'reviewing') THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN an.status IN ('accepted', 'returned', 'exported') THEN 1 ELSE 0 END) AS reviewed,
          SUM(CASE WHEN aj.decision IN ('REJECT', 'NEED_HUMAN_REVIEW') THEN 1 ELSE 0 END) AS need_human_review,
          t.deadline,
          MAX(an.updated_at) AS updated_at
        FROM tasks t
        JOIN assignments a ON a.task_id = t.id
        JOIN annotations an ON an.assignment_id = a.id
        LEFT JOIN ai_review_jobs aj ON aj.annotation_id = an.id
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
          aj.decision AS ai_decision,
          CAST(aj.scores_json AS CHAR) AS ai_scores_json,
          aj.total_score AS ai_total_score,
          aj.comment AS ai_comment,
          CAST(aj.risk_flags_json AS CHAR) AS ai_risk_flags_json,
          CAST(aj.evidence_json AS CHAR) AS ai_evidence_json,
          CAST(aj.response_json AS CHAR) AS ai_response_json,
          aj.model_name AS ai_model_name,
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
          SUM(CASE WHEN aj.decision = 'PASS' THEN 1 ELSE 0 END) AS pass_count,
          SUM(CASE WHEN aj.decision = 'NEED_HUMAN_REVIEW' THEN 1 ELSE 0 END) AS need_human_count,
          SUM(CASE WHEN aj.decision = 'REJECT' THEN 1 ELSE 0 END) AS reject_count,
        """ + selectMetricsClause + """
          MAX(COALESCE(aj.result_created_at, aj.finished_at, an.updated_at)) AS updated_at
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
            AND latest_job.decision IS NOT NULL
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
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
            WHERE latest_job.annotation_id = an.id
              AND latest_job.status = 'succeeded'
              AND latest_job.decision IS NOT NULL
            ORDER BY latest_job.finished_at DESC, latest_job.id DESC
            LIMIT 1
          )
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
          aj.decision AS ai_decision,
          CAST(aj.scores_json AS CHAR) AS ai_scores_json,
          aj.total_score AS ai_total_score,
          aj.comment AS ai_comment,
          CAST(aj.risk_flags_json AS CHAR) AS ai_risk_flags_json,
          CAST(aj.evidence_json AS CHAR) AS ai_evidence_json,
          CAST(aj.response_json AS CHAR) AS ai_response_json,
          aj.model_name AS ai_model_name,
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
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
            AND latest_job.decision IS NOT NULL
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
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
          WHERE latest_job.annotation_id = an.id
            AND latest_job.status = 'succeeded'
            AND latest_job.decision IS NOT NULL
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
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
          aj.decision AS ai_decision,
          CAST(aj.scores_json AS CHAR) AS ai_scores_json,
          aj.total_score AS ai_total_score,
          aj.comment AS ai_comment,
          CAST(aj.risk_flags_json AS CHAR) AS ai_risk_flags_json,
          CAST(aj.evidence_json AS CHAR) AS ai_evidence_json,
          CAST(aj.response_json AS CHAR) AS ai_response_json,
          aj.model_name AS ai_model_name,
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
          a.item_id,
          t.deadline AS task_deadline
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
            rs.getString("assignment_status"),
            toLocalDateTime(rs.getTimestamp("task_deadline"))),
        annotationId)
        .stream()
        .findFirst();
  }

  public List<ReviewTimelineEventRecord> listAssignmentReviewTimeline(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT
          timeline.annotation_id,
          timeline.revision_no,
          timeline.event_stage,
          timeline.ai_finished_at,
          timeline.ai_decision,
          timeline.ai_total_score,
          timeline.ai_comment,
          timeline.human_decision,
          timeline.human_reason,
          timeline.human_reviewed_at,
          timeline.human_reviewer_name
        FROM (
          SELECT
            an.id AS annotation_id,
            an.revision_no,
            'ai_review' AS event_stage,
            aj.finished_at AS ai_finished_at,
            aj.decision AS ai_decision,
            aj.total_score AS ai_total_score,
            aj.comment AS ai_comment,
            NULL AS human_decision,
            NULL AS human_reason,
            NULL AS human_reviewed_at,
            NULL AS human_reviewer_name,
            0 AS event_order,
            NULL AS human_round_no,
            NULL AS human_review_id
          FROM annotations an
          LEFT JOIN ai_review_jobs aj ON aj.id = (
            SELECT latest_job.id
            FROM ai_review_jobs latest_job
            WHERE latest_job.annotation_id = an.id
              AND latest_job.status = 'succeeded'
            ORDER BY latest_job.finished_at DESC, latest_job.id DESC
            LIMIT 1
          )
          WHERE an.assignment_id = ?
            AND an.status <> 'voided'

          UNION ALL

          SELECT
            an.id AS annotation_id,
            an.revision_no,
            'human_review' AS event_stage,
            NULL AS ai_finished_at,
            NULL AS ai_decision,
            NULL AS ai_total_score,
            NULL AS ai_comment,
            hr.decision AS human_decision,
            hr.reason AS human_reason,
            hr.created_at AS human_reviewed_at,
            reviewer.name AS human_reviewer_name,
            1 AS event_order,
            hr.round_no AS human_round_no,
            hr.id AS human_review_id
          FROM annotations an
          JOIN human_reviews hr ON hr.annotation_id = an.id
          LEFT JOIN users reviewer ON reviewer.id = hr.reviewer_id
          WHERE an.assignment_id = ?
            AND an.status <> 'voided'

          UNION ALL

          SELECT
            an.id AS annotation_id,
            an.revision_no,
            'human_review' AS event_stage,
            NULL AS ai_finished_at,
            NULL AS ai_decision,
            NULL AS ai_total_score,
            NULL AS ai_comment,
            NULL AS human_decision,
            NULL AS human_reason,
            NULL AS human_reviewed_at,
            NULL AS human_reviewer_name,
            1 AS event_order,
            NULL AS human_round_no,
            NULL AS human_review_id
          FROM annotations an
          WHERE an.assignment_id = ?
            AND an.status <> 'voided'
            AND NOT EXISTS (
              SELECT 1
              FROM human_reviews pending_hr
              WHERE pending_hr.annotation_id = an.id
            )
        ) timeline
        ORDER BY
          timeline.revision_no ASC,
          timeline.annotation_id ASC,
          timeline.event_order ASC,
          timeline.human_reviewed_at ASC,
          timeline.human_round_no ASC,
          timeline.human_review_id ASC
        """,
        (rs, rowNum) -> new ReviewTimelineEventRecord(
            rs.getLong("annotation_id"),
            rs.getInt("revision_no"),
            rs.getString("event_stage"),
            toLocalDateTime(rs.getTimestamp("ai_finished_at")),
            rs.getString("ai_decision"),
            toDouble(rs.getObject("ai_total_score")),
            rs.getString("ai_comment"),
            rs.getString("human_decision"),
            rs.getString("human_reason"),
            toLocalDateTime(rs.getTimestamp("human_reviewed_at")),
            rs.getString("human_reviewer_name")),
        assignmentId,
        assignmentId,
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
          an.revision_no,
          a.task_id,
          t.title AS task_title,
          hr.reason,
          hr.reviewer_id AS raised_by_id,
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
            rs.getInt("revision_no"),
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getString("reason"),
            rs.getLong("raised_by_id"),
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
          an.revision_no,
          a.task_id,
          t.title AS task_title,
          hr.reason,
          hr.reviewer_id AS raised_by_id,
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
            rs.getInt("revision_no"),
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getString("reason"),
            rs.getLong("raised_by_id"),
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
      filters.append("  AND aj.decision = ?\n");
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
            FROM task_items ti_any
            WHERE ti_any.task_id = a.task_id
              AND ti_any.reviewer_id IS NOT NULL
          )
          OR EXISTS (
            SELECT 1
            FROM task_items ti
            WHERE ti.task_id = a.task_id
              AND ti.item_id = a.item_id
              AND ti.reviewer_id = """ + reviewerId + """
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

  public record ReviewerDecisionCounts(
      long approve,
      long returnCount,
      long dispute) {}

  public record ReviewerTrendRecord(
      LocalDate date,
      long approve,
      long returnCount,
      long dispute) {}

  public record ReviewerAiConsistencyCounts(
      long consistent,
      long total) {}

  public record ReviewerSamplingCoverageCounts(
      long sampled,
      long total) {}

  public record ReviewerReviewDetailRecord(
      LocalDateTime reviewedAt,
      long taskId,
      String taskTitle,
      long itemId,
      long annotationId,
      int revisionNo,
      String decision,
      String reason,
      String aiDecision,
      Double aiTotalScore,
      String labelerName,
      String reviewerName) {}

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
      String eventStage,
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
      String assignmentStatus,
      LocalDateTime taskDeadline) {}

  public record DisputeRecord(
      long disputeId,
      long annotationId,
      int revisionNo,
      long taskId,
      String taskTitle,
      String reason,
      long raisedById,
      String raisedBy,
      LocalDateTime raisedAt,
      String status,
      int rounds) {}
}
