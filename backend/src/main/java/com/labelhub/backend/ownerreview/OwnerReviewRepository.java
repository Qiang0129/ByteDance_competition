package com.labelhub.backend.ownerreview;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class OwnerReviewRepository {

  private static final String AUDIT_LOG_SELECT_FROM = """
        SELECT DISTINCT
          al.id AS log_id,
          al.entity_type,
          al.entity_id,
          t.id AS task_id,
          t.title AS task_title,
          context_assignment.id AS assignment_id,
          context_annotation.id AS annotation_id,
          context_assignment.item_id AS item_id,
          CASE
            WHEN context_assignment.id IS NULL THEN NULL
            ELSE (
              SELECT COUNT(*)
              FROM assignments ranked
              WHERE ranked.task_id = context_assignment.task_id
                AND ranked.labeler_id = context_assignment.labeler_id
                AND ranked.status <> 'voided'
                AND ranked.id <= context_assignment.id
            )
          END AS item_index,
          labeler.name AS labeler_name,
          COALESCE(operator_user.name, 'system') AS operator_name,
          COALESCE(al.operator_role, 'system_agent') AS operator_role,
          al.action,
          al.from_state,
          al.to_state,
          al.reason,
          al.created_at
        FROM audit_logs al
        LEFT JOIN assignments assignment_entity ON al.entity_type = 'assignment'
          AND assignment_entity.id = al.entity_id
        LEFT JOIN annotations annotation_entity ON al.entity_type = 'annotation'
          AND annotation_entity.id = al.entity_id
        LEFT JOIN ai_review_jobs job_entity ON al.entity_type = 'ai_review_job'
          AND job_entity.id = al.entity_id
        LEFT JOIN annotations job_annotation ON job_annotation.id = job_entity.annotation_id
        LEFT JOIN human_reviews human_entity ON al.entity_type = 'human_review'
          AND human_entity.id = al.entity_id
        LEFT JOIN annotations human_annotation ON human_annotation.id = human_entity.annotation_id
        LEFT JOIN assignments context_assignment ON context_assignment.id = COALESCE(
          assignment_entity.id,
          annotation_entity.assignment_id,
          job_annotation.assignment_id,
          human_annotation.assignment_id
        )
        LEFT JOIN annotations latest_context_annotation ON latest_context_annotation.id = (
          SELECT latest.id
          FROM annotations latest
          WHERE latest.assignment_id = context_assignment.id
            AND latest.status <> 'voided'
          ORDER BY latest.revision_no DESC, latest.id DESC
          LIMIT 1
        )
        LEFT JOIN annotations context_annotation ON context_annotation.id = COALESCE(
          annotation_entity.id,
          job_annotation.id,
          human_annotation.id,
          latest_context_annotation.id
        )
        JOIN tasks t ON (
          (al.entity_type = 'task' AND al.entity_id = t.id)
          OR context_assignment.task_id = t.id
        )
        LEFT JOIN users labeler ON labeler.id = context_assignment.labeler_id
        LEFT JOIN users operator_user ON operator_user.id = al.operator_id
        """;

  private final JdbcTemplate jdbcTemplate;

  public OwnerReviewRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countPendingAnnotations(long ownerId) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status IN ('submitted', 'ai_reviewing', 'reviewing')
          AND an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = an.assignment_id
              AND latest.status <> 'voided'
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
        """,
        ownerId);
  }

  public long countHumanReviews(long ownerId, LocalDateTime start, LocalDateTime end, List<String> decisions) {
    List<Object> args = new ArrayList<>();
    args.add(ownerId);
    args.add(Timestamp.valueOf(start));
    args.add(Timestamp.valueOf(end));
    String decisionFilter = "";
    if (!decisions.isEmpty()) {
      decisionFilter = "AND LOWER(hr.decision) IN (" + placeholders(decisions.size()) + ")";
      args.addAll(decisions.stream().map(value -> value.toLowerCase(Locale.ROOT)).toList());
    }
    return queryLong(
        """
        SELECT COUNT(*)
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
        """ + allocatedReviewerFilter("hr", "a") + """
          AND hr.created_at >= ?
          AND hr.created_at < ?
        """ + decisionFilter,
        args.toArray());
  }

  public long countOpenOrRecentDisputes(long ownerId, LocalDateTime start, LocalDateTime end) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT an.id)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN human_reviews latest_hr ON latest_hr.id = (
          SELECT latest.id
          FROM human_reviews latest
          WHERE latest.annotation_id = an.id
        """ + allocatedReviewerFilter("latest", "a") + """
          ORDER BY latest.round_no DESC, latest.id DESC
          LIMIT 1
        )
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND (
            LOWER(COALESCE(latest_hr.decision, '')) = 'escalate'
            OR EXISTS (
              SELECT 1
              FROM human_reviews recent_hr
              WHERE recent_hr.annotation_id = an.id
                AND LOWER(recent_hr.decision) = 'escalate'
        """ + allocatedReviewerFilter("recent_hr", "a") + """
                AND recent_hr.created_at >= ?
                AND recent_hr.created_at < ?
            )
          )
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public long countSubmittedAnnotations(long ownerId, LocalDateTime start, LocalDateTime end) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND COALESCE(an.submitted_at, an.created_at) >= ?
          AND COALESCE(an.submitted_at, an.created_at) < ?
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public long countHumanReviewedAnnotations(long ownerId, LocalDateTime start, LocalDateTime end) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT hr.annotation_id)
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
        """ + allocatedReviewerFilter("hr", "a") + """
          AND hr.created_at >= ?
          AND hr.created_at < ?
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public ConsistencyCounts countConsistency(long ownerId, LocalDateTime start, LocalDateTime end) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE
            WHEN aj.decision = 'PASS'
             AND LOWER(latest_hr.decision) IN ('approve', 'approved', 'revise', 'revised')
            THEN 1
            WHEN aj.decision = 'REJECT'
             AND LOWER(latest_hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            THEN 1
            ELSE 0
          END) AS matched,
          COUNT(*) AS total
        FROM human_reviews latest_hr
        JOIN annotations an ON an.id = latest_hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND aj.decision IN ('PASS', 'REJECT')
        """ + allocatedReviewerFilter("latest_hr", "a") + """
          AND latest_hr.id = (
            SELECT hr2.id
            FROM human_reviews hr2
            WHERE hr2.annotation_id = an.id
        """ + allocatedReviewerFilter("hr2", "a") + """
            ORDER BY hr2.round_no DESC, hr2.id DESC
            LIMIT 1
          )
          AND latest_hr.created_at >= ?
          AND latest_hr.created_at < ?
        """,
        (rs, rowNum) -> new ConsistencyCounts(rs.getLong("matched"), rs.getLong("total")),
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public List<ReviewerWorkloadRecord> listReviewerWorkloads(
      long ownerId,
      LocalDateTime start,
      LocalDateTime end,
      int limit) {
    return jdbcTemplate.query(
        """
        SELECT
          reviewer.id AS reviewer_id,
          reviewer.name AS reviewer_name,
          COUNT(*) AS reviewed_today,
          COALESCE(ROUND(AVG(
            CASE
              WHEN an.submitted_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, an.submitted_at, hr.created_at)
              ELSE NULL
            END
          )), 0) AS avg_duration_sec,
          SUM(CASE
            WHEN aj.decision = 'PASS'
             AND LOWER(hr.decision) IN ('approve', 'approved', 'revise', 'revised')
            THEN 1
            WHEN aj.decision = 'REJECT'
             AND LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            THEN 1
            ELSE 0
          END) AS consistency_matched,
          SUM(CASE WHEN aj.decision IN ('PASS', 'REJECT') THEN 1 ELSE 0 END) AS consistency_total
        FROM human_reviews hr
        JOIN users reviewer ON reviewer.id = hr.reviewer_id
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN ai_review_jobs aj ON aj.id = (
          SELECT latest_job.id
          FROM ai_review_jobs latest_job
          WHERE latest_job.annotation_id = an.id
          ORDER BY latest_job.finished_at DESC, latest_job.id DESC
          LIMIT 1
        )
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
        """ + allocatedReviewerFilter("hr", "a") + """
          AND hr.created_at >= ?
          AND hr.created_at < ?
        GROUP BY reviewer.id, reviewer.name
        ORDER BY reviewed_today DESC, reviewer.id ASC
        LIMIT ?
        """,
        (rs, rowNum) -> new ReviewerWorkloadRecord(
            rs.getLong("reviewer_id"),
            rs.getString("reviewer_name"),
            rs.getLong("reviewed_today"),
            rs.getLong("avg_duration_sec"),
            rs.getLong("consistency_matched"),
            rs.getLong("consistency_total")),
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end),
        limit);
  }

  public List<TaskRecord> listTasks(
      long ownerId,
      String status,
      String keyword,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    args.add(ownerId);
    String keywordFilter = "";
    if (keyword != null && !keyword.isBlank()) {
      String like = "%" + keyword.trim() + "%";
      keywordFilter = """
          AND (
            task_rows.task_title LIKE ?
            OR CAST(task_rows.task_id AS CHAR) LIKE ?
            OR task_rows.task_type LIKE ?
            OR EXISTS (
              SELECT 1
              FROM human_reviews keyword_hr
              JOIN annotations keyword_an ON keyword_an.id = keyword_hr.annotation_id
              JOIN assignments keyword_a ON keyword_a.id = keyword_an.assignment_id
              JOIN users keyword_reviewer ON keyword_reviewer.id = keyword_hr.reviewer_id
              WHERE keyword_a.task_id = task_rows.task_id
        """ + allocatedReviewerFilter("keyword_hr", "keyword_a") + """
                AND keyword_reviewer.name LIKE ?
            )
          )
          """;
      args.add(like);
      args.add(like);
      args.add(like);
      args.add(like);
    }
    String statusFilter = switch (status == null ? "" : status) {
      case "in_progress" -> "AND task_rows.in_progress > 0";
      case "completed" -> "AND task_rows.total_annotations > 0 AND task_rows.in_progress = 0";
      case "has_disputes" -> "AND task_rows.disputes > 0";
      default -> "";
    };
    args.add(limit);
    args.add(offset);
    return jdbcTemplate.query(
        """
        SELECT *
        FROM (
          SELECT
            t.id AS task_id,
            t.title AS task_title,
            COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')), ''), '通用标注') AS task_type,
            COALESCE(metrics.total_annotations, 0) AS total_annotations,
            COALESCE(metrics.approved_count, 0) AS approved_count,
            COALESCE(metrics.returned_count, 0) AS returned_count,
            COALESCE(metrics.in_progress, 0) AS in_progress,
            COALESCE(metrics.disputes, 0) AS disputes,
            COALESCE(metrics.human_reviewed_annotations, 0) AS human_reviewed_annotations,
            t.deadline,
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.aiReviewEnabled')), 'true') <> 'false' AS ai_review_enabled,
            COALESCE(metrics.updated_at, t.updated_at) AS updated_at
          FROM tasks t
          LEFT JOIN (
            SELECT
              a.task_id,
              COUNT(DISTINCT an.id) AS total_annotations,
              COUNT(DISTINCT CASE
                WHEN a.status IN ('accepted', 'exported') OR an.status IN ('accepted', 'exported')
                THEN an.id END) AS approved_count,
              COUNT(DISTINCT CASE
                WHEN a.status = 'returned' OR an.status = 'returned'
                THEN an.id END) AS returned_count,
              COUNT(DISTINCT CASE
                WHEN an.status IN ('submitted', 'ai_reviewing', 'reviewing')
                THEN an.id END) AS in_progress,
            COUNT(DISTINCT CASE
              WHEN LOWER(all_hr.decision) = 'escalate'
              THEN an.id END) AS disputes,
            COUNT(DISTINCT CASE
              WHEN all_hr.id IS NOT NULL
              THEN an.id END) AS human_reviewed_annotations,
            MAX(COALESCE(all_hr.created_at, an.updated_at, a.updated_at)) AS updated_at
          FROM assignments a
          JOIN annotations an ON an.assignment_id = a.id
            LEFT JOIN annotations assignment_an ON assignment_an.assignment_id = a.id
              AND assignment_an.status <> 'voided'
            LEFT JOIN human_reviews all_hr ON all_hr.annotation_id = assignment_an.id
        """ + allocatedReviewerOnClause("all_hr", "a") + """
            WHERE a.status <> 'voided'
              AND an.status <> 'voided'
              AND an.id = (
                SELECT latest.id
                FROM annotations latest
                WHERE latest.assignment_id = a.id
                  AND latest.status <> 'voided'
                ORDER BY latest.revision_no DESC, latest.id DESC
                LIMIT 1
              )
            GROUP BY a.task_id
          ) metrics ON metrics.task_id = t.id
          WHERE t.owner_id = ?
            AND t.deleted_at IS NULL
        ) task_rows
        WHERE 1 = 1
        """ + keywordFilter + "\n" + statusFilter + """
        ORDER BY task_rows.updated_at DESC, task_rows.task_id DESC
        LIMIT ? OFFSET ?
        """,
        this::mapTask,
        args.toArray());
  }

  public long countTasks(long ownerId, String status, String keyword) {
    return listTasks(ownerId, status, keyword, Integer.MAX_VALUE, 0).size();
  }

  public List<ReviewerRecord> listReviewers() {
    return jdbcTemplate.query(
        """
        SELECT u.id AS reviewer_id, u.name AS reviewer_name
        FROM users u
        WHERE JSON_CONTAINS(COALESCE(u.roles_json, JSON_ARRAY()), JSON_QUOTE('reviewer'))
          AND u.status = 'active'
          AND u.deleted_at IS NULL
        GROUP BY u.id, u.name
        ORDER BY u.name ASC, u.id ASC
        """,
        (rs, rowNum) -> new ReviewerRecord(
            rs.getLong("reviewer_id"),
            rs.getString("reviewer_name")));
  }

  public List<String> listTaskReviewerNames(long ownerId, long taskId) {
    return jdbcTemplate.query(
        """
        SELECT reviewer.name
        FROM human_reviews hr
        JOIN users reviewer ON reviewer.id = hr.reviewer_id
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
        """ + allocatedReviewerFilter("hr", "a") + """
        GROUP BY reviewer.id, reviewer.name
        ORDER BY MAX(hr.created_at) DESC, reviewer.id ASC
        LIMIT 5
        """,
        (rs, rowNum) -> rs.getString("name"),
        ownerId,
        taskId);
  }

  public boolean taskBelongsToOwner(long ownerId, long taskId) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM tasks
        WHERE owner_id = ?
          AND id = ?
          AND deleted_at IS NULL
        """,
        ownerId,
        taskId) > 0;
  }

  public List<AnnotationRecord> listTaskAnnotations(
      long ownerId,
      long taskId,
      String status,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    args.add(ownerId);
    args.add(taskId);
    String statusFilter = annotationStatusFilter(status);
    args.add(limit);
    args.add(offset);
    return jdbcTemplate.query(
        """
        SELECT *
        FROM (
          SELECT
            an.id AS annotation_id,
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
            COALESCE(an.submitted_at, an.created_at) AS submitted_at,
            an.status AS annotation_status,
            a.status AS assignment_status,
            an.updated_at,
            latest_assignment_hr.round_no AS human_round_no,
            latest_assignment_hr.decision AS human_decision,
            latest_assignment_hr.created_at AS human_reviewed_at,
            reviewer.name AS reviewer_name,
            COALESCE(hr_counts.review_count, 0) AS review_count,
            COALESCE(hr_counts.dispute_count, 0) AS dispute_count,
            aj.decision AS ai_decision
          FROM annotations an
          JOIN assignments a ON a.id = an.assignment_id
          JOIN tasks t ON t.id = a.task_id
          JOIN users labeler ON labeler.id = a.labeler_id
          LEFT JOIN human_reviews latest_assignment_hr ON latest_assignment_hr.id = (
            SELECT hr2.id
            FROM human_reviews hr2
            JOIN annotations hr_an ON hr_an.id = hr2.annotation_id
            WHERE hr_an.assignment_id = a.id
              AND hr_an.status <> 'voided'
        """ + allocatedReviewerFilter("hr2", "a") + """
            ORDER BY hr2.round_no DESC, hr2.id DESC
            LIMIT 1
          )
          LEFT JOIN users reviewer ON reviewer.id = latest_assignment_hr.reviewer_id
          LEFT JOIN (
            SELECT
              hr_an.assignment_id,
              COUNT(*) AS review_count,
              SUM(CASE WHEN LOWER(decision) = 'escalate' THEN 1 ELSE 0 END) AS dispute_count
            FROM human_reviews hr
            JOIN annotations hr_an ON hr_an.id = hr.annotation_id
            JOIN assignments hr_a ON hr_a.id = hr_an.assignment_id
            WHERE hr_an.status <> 'voided'
        """ + allocatedReviewerFilter("hr", "hr_a") + """
            GROUP BY hr_an.assignment_id
          ) hr_counts ON hr_counts.assignment_id = a.id
          LEFT JOIN ai_review_jobs aj ON aj.id = (
            SELECT latest_job.id
            FROM ai_review_jobs latest_job
            WHERE latest_job.annotation_id = an.id
            ORDER BY latest_job.finished_at DESC, latest_job.id DESC
            LIMIT 1
          )
          WHERE t.owner_id = ?
            AND t.id = ?
            AND t.deleted_at IS NULL
            AND a.status <> 'voided'
            AND an.status <> 'voided'
            AND an.id = (
              SELECT latest.id
              FROM annotations latest
              WHERE latest.assignment_id = a.id
                AND latest.status <> 'voided'
              ORDER BY latest.revision_no DESC, latest.id DESC
              LIMIT 1
            )
        ) annotation_rows
        WHERE 1 = 1
        """ + statusFilter + """
        ORDER BY annotation_rows.item_index ASC, annotation_rows.annotation_id ASC
        LIMIT ? OFFSET ?
        """,
        this::mapAnnotation,
        args.toArray());
  }

  public long countTaskAnnotations(long ownerId, long taskId, String status) {
    return listTaskAnnotations(ownerId, taskId, status, Integer.MAX_VALUE, 0).size();
  }

  public List<AuditLogRecord> listAuditLog(
      long ownerId,
      LocalDateTime start,
      LocalDateTime end,
      Long taskId,
      Long reviewerId,
      String operatorRole,
      String action,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    args.add(ownerId);
    args.add(Timestamp.valueOf(start));
    args.add(Timestamp.valueOf(end));
    String taskFilter = "";
    if (taskId != null) {
      taskFilter = "AND t.id = ?";
      args.add(taskId);
    }
    String reviewerFilter = "";
    if (reviewerId != null) {
      reviewerFilter = "AND al.operator_id = ?";
      args.add(reviewerId);
    }
    String roleFilter = "";
    if (operatorRole != null && !operatorRole.isBlank()) {
      roleFilter = "AND COALESCE(al.operator_role, '') = ?";
      args.add(operatorRole);
    }
    String actionFilter = "";
    if (action != null && !action.isBlank()) {
      actionFilter = "AND al.action LIKE ?";
      args.add("%" + action.trim() + "%");
    }
    args.add(limit);
    args.add(offset);
    return jdbcTemplate.query(
        AUDIT_LOG_SELECT_FROM + """
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND al.created_at >= ?
          AND al.created_at < ?
          AND COALESCE(al.operator_role, '') = 'reviewer'
        """ + taskFilter + "\n" + reviewerFilter + "\n" + roleFilter + "\n" + actionFilter + """
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ? OFFSET ?
        """,
        this::mapAuditLog,
        args.toArray());
  }

  public Optional<AuditLogRecord> findAuditLog(long ownerId, long logId) {
    return jdbcTemplate.query(
        AUDIT_LOG_SELECT_FROM + """
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND al.id = ?
        """,
        this::mapAuditLog,
        ownerId,
        logId)
        .stream()
        .findFirst();
  }

  public List<AuditLogRecord> listAuditLogItemTimeline(long ownerId, long assignmentId) {
    return jdbcTemplate.query(
        AUDIT_LOG_SELECT_FROM + """
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND context_assignment.id = ?
        ORDER BY al.created_at DESC, al.id DESC
        """,
        this::mapAuditLog,
        ownerId,
        assignmentId);
  }

  public long countAuditLog(
      long ownerId,
      LocalDateTime start,
      LocalDateTime end,
      Long taskId,
      Long reviewerId,
      String operatorRole,
      String action) {
    return listAuditLog(ownerId, start, end, taskId, reviewerId, operatorRole, action, Integer.MAX_VALUE, 0).size();
  }

  private String annotationStatusFilter(String status) {
    if (status == null || status.isBlank()) {
      return "";
    }
    return switch (status) {
      case "reviewing" -> """
          AND annotation_rows.annotation_status IN ('submitted', 'ai_reviewing', 'reviewing')
          AND LOWER(COALESCE(annotation_rows.human_decision, '')) <> 'escalate'
          """;
      case "approved" -> """
          AND (
            annotation_rows.annotation_status IN ('accepted', 'exported')
            OR annotation_rows.assignment_status IN ('accepted', 'exported')
            OR LOWER(COALESCE(annotation_rows.human_decision, '')) IN ('approve', 'approved')
          )
          """;
      case "returned" -> """
          AND (
            annotation_rows.annotation_status = 'returned'
            OR annotation_rows.assignment_status = 'returned'
            OR LOWER(COALESCE(annotation_rows.human_decision, '')) IN ('return', 'returned', 'reject', 'rejected')
          )
          """;
      case "revised" -> """
          AND (
            annotation_rows.annotation_status = 'revised'
            OR LOWER(COALESCE(annotation_rows.human_decision, '')) IN ('revise', 'revised')
          )
          """;
      case "disputed" -> "AND LOWER(COALESCE(annotation_rows.human_decision, '')) = 'escalate'";
      default -> "";
    };
  }

  private TaskRecord mapTask(ResultSet rs, int rowNum) throws SQLException {
    return new TaskRecord(
        rs.getLong("task_id"),
        rs.getString("task_title"),
        rs.getString("task_type"),
        rs.getLong("total_annotations"),
        rs.getLong("approved_count"),
        rs.getLong("returned_count"),
        rs.getLong("in_progress"),
        rs.getLong("disputes"),
        rs.getLong("human_reviewed_annotations"),
        toLocalDateTime(rs.getTimestamp("deadline")),
        rs.getBoolean("ai_review_enabled"),
        toLocalDateTime(rs.getTimestamp("updated_at")));
  }

  private AnnotationRecord mapAnnotation(ResultSet rs, int rowNum) throws SQLException {
    return new AnnotationRecord(
        rs.getLong("annotation_id"),
        rs.getLong("item_id"),
        rs.getInt("item_index"),
        rs.getString("labeler_name"),
        toLocalDateTime(rs.getTimestamp("submitted_at")),
        rs.getString("annotation_status"),
        rs.getString("assignment_status"),
        toLocalDateTime(rs.getTimestamp("updated_at")),
        rs.getInt("human_round_no"),
        rs.getString("human_decision"),
        rs.getString("reviewer_name"),
        rs.getLong("review_count"),
        rs.getLong("dispute_count"),
        rs.getString("ai_decision"));
  }

  private AuditLogRecord mapAuditLog(ResultSet rs, int rowNum) throws SQLException {
    return new AuditLogRecord(
        rs.getLong("log_id"),
        rs.getString("entity_type"),
        rs.getLong("entity_id"),
        rs.getLong("task_id"),
        rs.getString("task_title"),
        toLong(rs.getObject("assignment_id")),
        toLong(rs.getObject("annotation_id")),
        toLong(rs.getObject("item_id")),
        toInteger(rs.getObject("item_index")),
        rs.getString("labeler_name"),
        rs.getString("operator_name"),
        rs.getString("operator_role"),
        rs.getString("action"),
        rs.getString("from_state"),
        rs.getString("to_state"),
        rs.getString("reason"),
        toLocalDateTime(rs.getTimestamp("created_at")));
  }

  private String placeholders(int count) {
    return String.join(", ", java.util.Collections.nCopies(count, "?"));
  }

  private long queryLong(String sql, Object... args) {
    Number value = jdbcTemplate.queryForObject(sql, Number.class, args);
    return value == null ? 0L : value.longValue();
  }

  private String allocatedReviewerFilter(String reviewAlias, String assignmentAlias) {
    return """
          AND EXISTS (
            SELECT 1
            FROM task_user_allocations tua
            WHERE tua.task_id = %s.task_id
              AND tua.allocation_role = 'reviewer'
              AND tua.user_id = %s.reviewer_id
          )
          AND (
            NOT EXISTS (
              SELECT 1
              FROM task_items ti_any
              WHERE ti_any.task_id = %s.task_id
                AND ti_any.reviewer_id IS NOT NULL
            )
            OR EXISTS (
              SELECT 1
              FROM task_items ti
              WHERE ti.task_id = %s.task_id
                AND ti.item_id = %s.item_id
                AND ti.reviewer_id = %s.reviewer_id
            )
          )
        """.formatted(
        assignmentAlias,
        reviewAlias,
        assignmentAlias,
        assignmentAlias,
        assignmentAlias,
        reviewAlias);
  }

  private String allocatedReviewerOnClause(String reviewAlias, String assignmentAlias) {
    return allocatedReviewerFilter(reviewAlias, assignmentAlias).replace("AND EXISTS", "  AND EXISTS");
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

  public record ConsistencyCounts(long matched, long total) {}

  public record ReviewerWorkloadRecord(
      long reviewerId,
      String reviewerName,
      long reviewedToday,
      long avgDurationSec,
      long consistencyMatched,
      long consistencyTotal) {}

  public record ReviewerRecord(
      long reviewerId,
      String reviewerName) {}

  public record TaskRecord(
      long taskId,
      String taskTitle,
      String taskType,
      long totalAnnotations,
      long approvedCount,
      long returnedCount,
      long inProgress,
      long disputes,
      long humanReviewedAnnotations,
      LocalDateTime deadline,
      boolean aiReviewEnabled,
      LocalDateTime updatedAt) {}

  public record AnnotationRecord(
      long annotationId,
      long itemId,
      int itemIndex,
      String labelerName,
      LocalDateTime submittedAt,
      String annotationStatus,
      String assignmentStatus,
      LocalDateTime updatedAt,
      int humanRoundNo,
      String humanDecision,
      String reviewerName,
      long reviewCount,
      long disputeCount,
      String aiDecision) {}

  public record AuditLogRecord(
      long logId,
      String entityType,
      long entityId,
      long taskId,
      String taskTitle,
      Long assignmentId,
      Long annotationId,
      Long itemId,
      Integer itemIndex,
      String labelerName,
      String operatorName,
      String operatorRole,
      String action,
      String fromState,
      String toState,
      String reason,
      LocalDateTime occurredAt) {}
}
