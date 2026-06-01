package com.labelhub.backend.dashboard;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DashboardRepository {

  private final JdbcTemplate jdbcTemplate;

  public DashboardRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countActiveTasks(long ownerId) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM tasks t
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND t.status IN ('published', 'paused')
        """,
        ownerId);
  }

  public long countActiveLabelers(long ownerId, LocalDateTime start, LocalDateTime end) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT a.labeler_id)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND a.updated_at >= ?
          AND a.updated_at < ?
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public long countPendingReview(long ownerId) {
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

  public AiDecisionCounts countAiDecisions(long ownerId, LocalDateTime start, LocalDateTime end) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE WHEN air.decision = 'PASS' THEN 1 ELSE 0 END) AS ai_pass,
          SUM(CASE WHEN air.decision = 'NEED_HUMAN_REVIEW' THEN 1 ELSE 0 END) AS ai_need_human,
          SUM(CASE WHEN air.decision = 'REJECT' THEN 1 ELSE 0 END) AS ai_reject,
          COUNT(*) AS total
        FROM ai_review_results air
        JOIN ai_review_jobs aj ON aj.id = air.job_id
        JOIN annotations an ON an.id = aj.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND air.created_at >= ?
          AND air.created_at < ?
        """,
        (rs, rowNum) -> new AiDecisionCounts(
            rs.getLong("ai_pass"),
            rs.getLong("ai_need_human"),
            rs.getLong("ai_reject"),
            rs.getLong("total")),
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public long averageDurationSec(long ownerId, LocalDateTime start, LocalDateTime end) {
    return queryLong(
        """
        SELECT COALESCE(ROUND(AVG(TIMESTAMPDIFF(SECOND, a.claimed_at, a.submitted_at))), 0)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND a.claimed_at IS NOT NULL
          AND a.submitted_at IS NOT NULL
          AND a.submitted_at >= ?
          AND a.submitted_at < ?
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public List<TaskProgressRecord> listTaskProgress(long ownerId, int limit) {
    return jdbcTemplate.query(
        """
        SELECT
          t.id AS task_id,
          t.title,
          COALESCE(item_counts.total_items, t.quota, assignment_counts.total_assignments, 0) AS total,
          COALESCE(assignment_counts.approved, 0) AS approved,
          COALESCE(assignment_counts.returned, 0) AS returned
        FROM tasks t
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS total_items
          FROM items
          GROUP BY task_id
        ) item_counts ON item_counts.task_id = t.id
        LEFT JOIN (
          SELECT
            task_id,
            COUNT(*) AS total_assignments,
            SUM(CASE WHEN status IN ('accepted', 'exported') THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
            MAX(updated_at) AS latest_assignment_at
          FROM assignments
          WHERE status <> 'voided'
          GROUP BY task_id
        ) assignment_counts ON assignment_counts.task_id = t.id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
        ORDER BY COALESCE(assignment_counts.latest_assignment_at, t.updated_at) DESC, t.id DESC
        LIMIT ?
        """,
        (rs, rowNum) -> new TaskProgressRecord(
            rs.getLong("task_id"),
            rs.getString("title"),
            rs.getLong("total"),
            rs.getLong("approved"),
            rs.getLong("returned")),
        ownerId,
        limit);
  }

  public HumanDecisionCounts countHumanDecisions(long ownerId, LocalDateTime start, LocalDateTime end) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE WHEN LOWER(hr.decision) IN ('approve', 'approved', 'revise', 'revised') THEN 1 ELSE 0 END) AS human_pass,
          SUM(CASE WHEN LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected') THEN 1 ELSE 0 END) AS human_returned
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND hr.created_at >= ?
          AND hr.created_at < ?
        """,
        (rs, rowNum) -> new HumanDecisionCounts(
            rs.getLong("human_pass"),
            rs.getLong("human_returned")),
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  public List<LabelerPerformanceRecord> listLabelerPerformance(
      long ownerId,
      LocalDateTime start,
      LocalDateTime end,
      int limit) {
    return jdbcTemplate.query(
        """
        SELECT
          u.id AS labeler_id,
          u.name AS labeler_name,
          COALESCE(NULLIF(role_choice.task_type, ''), '通用标注') AS labeler_role,
          COUNT(DISTINCT an.id) AS submitted,
          COUNT(DISTINCT CASE WHEN a.status IN ('accepted', 'exported') THEN a.id END) AS approved,
          COUNT(DISTINCT CASE WHEN a.status = 'returned' THEN a.id END) AS returned,
          COALESCE(ROUND(AVG(
            CASE
              WHEN a.claimed_at IS NOT NULL AND a.submitted_at IS NOT NULL
              THEN TIMESTAMPDIFF(SECOND, a.claimed_at, a.submitted_at)
              ELSE NULL
            END
          )), 0) AS avg_duration_sec
        FROM assignments a
        JOIN users u ON u.id = a.labeler_id
        JOIN tasks t ON t.id = a.task_id
        JOIN annotations an ON an.assignment_id = a.id
        LEFT JOIN (
          SELECT ranked.labeler_id, ranked.task_type
          FROM (
            SELECT
              a2.labeler_id,
              COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t2.reward_rule, '$.taskType')), ''), '通用标注') AS task_type,
              COUNT(*) AS cnt,
              ROW_NUMBER() OVER (
                PARTITION BY a2.labeler_id
                ORDER BY COUNT(*) DESC, MAX(a2.updated_at) DESC
              ) AS rn
            FROM assignments a2
            JOIN tasks t2 ON t2.id = a2.task_id
            WHERE t2.owner_id = ?
              AND t2.deleted_at IS NULL
              AND a2.status <> 'voided'
            GROUP BY a2.labeler_id, task_type
          ) ranked
          WHERE ranked.rn = 1
        ) role_choice ON role_choice.labeler_id = a.labeler_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND COALESCE(an.submitted_at, an.created_at) >= ?
          AND COALESCE(an.submitted_at, an.created_at) < ?
        GROUP BY u.id, u.name, labeler_role
        ORDER BY submitted DESC, approved DESC, u.id ASC
        LIMIT ?
        """,
        (rs, rowNum) -> new LabelerPerformanceRecord(
            rs.getLong("labeler_id"),
            rs.getString("labeler_name"),
            rs.getString("labeler_role"),
            rs.getLong("submitted"),
            rs.getLong("approved"),
            rs.getLong("returned"),
            rs.getLong("avg_duration_sec")),
        ownerId,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end),
        limit);
  }

  public List<SubmissionTimelineRecord> listSubmissionTimeline(long ownerId, int year) {
    return jdbcTemplate.query(
        """
        SELECT
          months.month_no,
          SUM(CASE
            WHEN a.submitted_at IS NOT NULL
             AND YEAR(a.submitted_at) = ?
             AND MONTH(a.submitted_at) = months.month_no
             AND (t.deadline IS NULL OR a.submitted_at <= t.deadline)
            THEN 1 ELSE 0 END) AS on_time,
          SUM(CASE
            WHEN a.submitted_at IS NOT NULL
             AND YEAR(a.submitted_at) = ?
             AND MONTH(a.submitted_at) = months.month_no
             AND t.deadline IS NOT NULL
             AND a.submitted_at > t.deadline
            THEN 1 ELSE 0 END) AS late,
          SUM(CASE
            WHEN a.id IS NOT NULL
             AND a.submitted_at IS NULL
             AND t.deadline IS NOT NULL
             AND t.deadline < CURRENT_TIMESTAMP
             AND YEAR(t.deadline) = ?
             AND MONTH(t.deadline) = months.month_no
            THEN 1 ELSE 0 END) AS absent
        FROM (
          SELECT 1 AS month_no UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
          UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
          UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
        ) months
        LEFT JOIN tasks t ON t.owner_id = ?
          AND t.deleted_at IS NULL
        LEFT JOIN assignments a ON a.task_id = t.id
          AND a.status <> 'voided'
        GROUP BY months.month_no
        ORDER BY months.month_no
        """,
        (rs, rowNum) -> new SubmissionTimelineRecord(
            rs.getInt("month_no"),
            rs.getLong("on_time"),
            rs.getLong("late"),
            rs.getLong("absent")),
        year,
        year,
        year,
        ownerId);
  }

  public List<RecentActivityRecord> listRecentActivities(long ownerId, int limit) {
    return jdbcTemplate.query(
        """
        SELECT
          t.id AS task_id,
          t.title AS task_title,
          owner.name AS owner_name,
          al.action,
          al.to_state,
          al.created_at
        FROM audit_logs al
        JOIN tasks t ON (
          (al.entity_type = 'task' AND al.entity_id = t.id)
          OR (
            al.entity_type = 'assignment'
            AND EXISTS (
              SELECT 1
              FROM assignments a
              WHERE a.id = al.entity_id
                AND a.task_id = t.id
            )
          )
          OR (
            al.entity_type = 'annotation'
            AND EXISTS (
              SELECT 1
              FROM annotations an
              JOIN assignments a ON a.id = an.assignment_id
              WHERE an.id = al.entity_id
                AND a.task_id = t.id
            )
          )
        )
        JOIN users owner ON owner.id = t.owner_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ?
        """,
        (rs, rowNum) -> new RecentActivityRecord(
            rs.getLong("task_id"),
            rs.getString("task_title"),
            rs.getString("owner_name"),
            rs.getString("action"),
            rs.getString("to_state"),
            toLocalDateTime(rs.getTimestamp("created_at"))),
        ownerId,
        limit);
  }

  public List<RoleBreakdownRecord> listRoleBreakdown(long ownerId) {
    return jdbcTemplate.query(
        """
        SELECT
          COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')), ''), '通用标注') AS role_name,
          COUNT(DISTINCT a.labeler_id) AS member_count
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
        GROUP BY role_name
        HAVING member_count > 0
        ORDER BY member_count DESC, role_name ASC
        LIMIT 8
        """,
        (rs, rowNum) -> new RoleBreakdownRecord(
            rs.getString("role_name"),
            rs.getLong("member_count")),
        ownerId);
  }

  public DisputeStatsRecord getDisputeStats(long ownerId, LocalDateTime start, LocalDateTime end) {
    long disputed = queryLong(
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
          AND LOWER(hr.decision) = 'escalate'
          AND hr.created_at >= ?
          AND hr.created_at < ?
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
    long resolved = queryLong(
        """
        SELECT COUNT(DISTINCT escalated.annotation_id)
        FROM (
          SELECT DISTINCT hr.annotation_id
          FROM human_reviews hr
          JOIN annotations an ON an.id = hr.annotation_id
          JOIN assignments a ON a.id = an.assignment_id
          JOIN tasks t ON t.id = a.task_id
          WHERE t.owner_id = ?
            AND t.deleted_at IS NULL
            AND a.status <> 'voided'
            AND an.status <> 'voided'
            AND LOWER(hr.decision) = 'escalate'
            AND hr.created_at >= ?
            AND hr.created_at < ?
        ) escalated
        JOIN human_reviews latest_hr ON latest_hr.id = (
          SELECT latest.id
          FROM human_reviews latest
          WHERE latest.annotation_id = escalated.annotation_id
          ORDER BY latest.round_no DESC, latest.id DESC
          LIMIT 1
        )
        WHERE LOWER(latest_hr.decision) IN ('approve', 'approved', 'return', 'returned', 'reject', 'rejected', 'revise', 'revised')
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
    long reviewedAnnotations = queryLong(
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
          AND hr.created_at >= ?
          AND hr.created_at < ?
        """,
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
    long submittedAnnotations = countSubmittedAnnotations(ownerId, start, end);
    ConsistencyCounts consistency = getConsistencyCounts(ownerId, start, end);
    return new DisputeStatsRecord(
        disputed,
        resolved,
        submittedAnnotations == 0 ? 0D : (double) reviewedAnnotations / submittedAnnotations,
        consistency.total() == 0 ? 0D : (double) consistency.matched() / consistency.total());
  }

  private ConsistencyCounts getConsistencyCounts(long ownerId, LocalDateTime start, LocalDateTime end) {
    return jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE
            WHEN air.decision = 'PASS'
             AND LOWER(hr.decision) IN ('approve', 'approved', 'revise', 'revised')
            THEN 1
            WHEN air.decision = 'REJECT'
             AND LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            THEN 1
            ELSE 0
          END) AS matched,
          COUNT(*) AS total
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        JOIN ai_review_results air ON air.job_id = aj.id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND air.decision IN ('PASS', 'REJECT')
          AND hr.id = (
            SELECT latest_hr.id
            FROM human_reviews latest_hr
            WHERE latest_hr.annotation_id = an.id
            ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
            LIMIT 1
          )
          AND hr.created_at >= ?
          AND hr.created_at < ?
        """,
        (rs, rowNum) -> new ConsistencyCounts(rs.getLong("matched"), rs.getLong("total")),
        ownerId,
        Timestamp.valueOf(start),
        Timestamp.valueOf(end));
  }

  private long queryLong(String sql, Object... args) {
    Number value = jdbcTemplate.queryForObject(sql, Number.class, args);
    return value == null ? 0L : value.longValue();
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  public record AiDecisionCounts(long aiPass, long aiNeedHuman, long aiReject, long total) {}

  public record HumanDecisionCounts(long humanPass, long humanReturned) {}

  public record TaskProgressRecord(
      long taskId,
      String title,
      long total,
      long approved,
      long returned) {}

  public record LabelerPerformanceRecord(
      long labelerId,
      String labelerName,
      String role,
      long submitted,
      long approved,
      long returned,
      long avgDurationSec) {}

  public record SubmissionTimelineRecord(int monthNo, long onTime, long late, long absent) {}

  public record RecentActivityRecord(
      long taskId,
      String taskTitle,
      String ownerName,
      String action,
      String toState,
      LocalDateTime createdAt) {}

  public record RoleBreakdownRecord(String role, long memberCount) {}

  public record DisputeStatsRecord(
      long disputed,
      long resolved,
      double samplingRatio,
      double consistencyRate) {}

  private record ConsistencyCounts(long matched, long total) {}
}
