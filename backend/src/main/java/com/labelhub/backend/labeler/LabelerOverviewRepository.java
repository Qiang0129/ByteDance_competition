package com.labelhub.backend.labeler;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LabelerOverviewRepository {

  private final JdbcTemplate jdbcTemplate;

  public LabelerOverviewRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countActiveTasks(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT a.task_id)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status IN ('claimed', 'submitted', 'returned')
          AND t.deleted_at IS NULL
        """,
        labelerId);
  }

  public long countSubmittedToday(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
          AND COALESCE(an.submitted_at, an.created_at) >= CURRENT_DATE()
          AND COALESCE(an.submitted_at, an.created_at) < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
        """,
        labelerId);
  }

  public long countReturnedItems(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status = 'returned'
          AND t.deleted_at IS NULL
        """,
        labelerId);
  }

  public long averageDurationSec(long labelerId) {
    return queryLong(
        """
        SELECT COALESCE(ROUND(AVG(TIMESTAMPDIFF(SECOND, a.claimed_at, a.submitted_at))), 0)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND a.claimed_at IS NOT NULL
          AND a.submitted_at IS NOT NULL
          AND t.deleted_at IS NULL
        """,
        labelerId);
  }

  public long averageDurationTodaySec(long labelerId) {
    return queryLong(
        """
        SELECT COALESCE(ROUND(AVG(TIMESTAMPDIFF(SECOND, a.claimed_at, a.submitted_at))), 0)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND a.claimed_at IS NOT NULL
          AND a.submitted_at IS NOT NULL
          AND a.submitted_at >= CURRENT_DATE()
          AND a.submitted_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
          AND t.deleted_at IS NULL
        """,
        labelerId);
  }

  public long countWeeklySubmitted(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(*)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
          AND COALESCE(an.submitted_at, an.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY)
        """,
        labelerId);
  }

  public long countSubmittedAssignments(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT a.id)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM annotations an
            WHERE an.assignment_id = a.id
              AND an.status <> 'voided'
          )
        """,
        labelerId);
  }

  public long countAcceptedAssignments(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT a.id)
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status = 'accepted'
          AND t.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM annotations an
            WHERE an.assignment_id = a.id
              AND an.status <> 'voided'
          )
        """,
        labelerId);
  }

  public double sumMonthlyRewardEstimate(long labelerId) {
    return sumAcceptedRewardEstimate(
        labelerId,
        """
        accepted_rewards.accepted_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
          AND accepted_rewards.accepted_at < DATE_ADD(DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
        """);
  }

  public double sumTodayRewardEstimate(long labelerId) {
    return sumAcceptedRewardEstimate(
        labelerId,
        """
        accepted_rewards.accepted_at >= CURRENT_DATE()
          AND accepted_rewards.accepted_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
        """);
  }

  private double sumAcceptedRewardEstimate(long labelerId, String acceptedAtFilter) {
    return queryDouble(
        """
        SELECT COALESCE(SUM(accepted_rewards.reward_per_item), 0)
        FROM (
          SELECT
            COALESCE(a.reward_amount, 0) AS reward_per_item,
            COALESCE(accepted_audit.created_at, accepted_hr.created_at, an.updated_at) AS accepted_at
          FROM assignments a
          JOIN tasks t ON t.id = a.task_id
          JOIN annotations an ON an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = a.id
              AND latest.status <> 'voided'
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
          LEFT JOIN audit_logs accepted_audit ON accepted_audit.id = (
            SELECT al.id
            FROM audit_logs al
            WHERE al.entity_type = 'annotation'
              AND al.entity_id = an.id
              AND al.action IN ('human_review.approve', 'human_review.revise.accept')
              AND al.to_state = 'accepted'
            ORDER BY al.created_at ASC, al.id ASC
            LIMIT 1
          )
          LEFT JOIN human_reviews accepted_hr ON accepted_hr.id = (
            SELECT hr.id
            FROM human_reviews hr
            WHERE hr.annotation_id = an.id
              AND LOWER(hr.decision) IN ('approve', 'approved', 'revise')
            ORDER BY hr.created_at ASC, hr.id ASC
            LIMIT 1
          )
          WHERE a.labeler_id = ?
            AND a.status IN ('accepted', 'exported')
            AND an.status IN ('accepted', 'exported')
            AND t.deleted_at IS NULL
        ) accepted_rewards
        WHERE
        """
            + acceptedAtFilter,
        labelerId);
  }

  public List<RewardDetailRecord> listMonthlyRewardDetails(long labelerId) {
    return jdbcTemplate.query(
        """
        SELECT *
        FROM (
          SELECT
            t.id AS task_id,
            a.id AS assignment_id,
            an.id AS annotation_id,
            t.title AS task_title,
            a.item_id,
            (
              SELECT COUNT(*)
              FROM assignments ranked
              WHERE ranked.task_id = a.task_id
                AND ranked.labeler_id = a.labeler_id
                AND ranked.status <> 'voided'
                AND ranked.id <= a.id
            ) AS item_index,
            COALESCE(a.reward_amount, 0) AS reward_per_item,
            COALESCE(accepted_audit.created_at, accepted_hr.created_at, an.updated_at) AS accepted_at
          FROM assignments a
          JOIN tasks t ON t.id = a.task_id
          JOIN annotations an ON an.id = (
            SELECT latest.id
            FROM annotations latest
            WHERE latest.assignment_id = a.id
              AND latest.status <> 'voided'
            ORDER BY latest.revision_no DESC, latest.id DESC
            LIMIT 1
          )
          LEFT JOIN audit_logs accepted_audit ON accepted_audit.id = (
            SELECT al.id
            FROM audit_logs al
            WHERE al.entity_type = 'annotation'
              AND al.entity_id = an.id
              AND al.action IN ('human_review.approve', 'human_review.revise.accept')
              AND al.to_state = 'accepted'
            ORDER BY al.created_at ASC, al.id ASC
            LIMIT 1
          )
          LEFT JOIN human_reviews accepted_hr ON accepted_hr.id = (
            SELECT hr.id
            FROM human_reviews hr
            WHERE hr.annotation_id = an.id
              AND LOWER(hr.decision) IN ('approve', 'approved', 'revise')
            ORDER BY hr.created_at ASC, hr.id ASC
            LIMIT 1
          )
          WHERE a.labeler_id = ?
            AND a.status IN ('accepted', 'exported')
            AND an.status IN ('accepted', 'exported')
            AND t.deleted_at IS NULL
        ) accepted_rewards
        WHERE accepted_rewards.accepted_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
          AND accepted_rewards.accepted_at < DATE_ADD(DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
        ORDER BY accepted_rewards.accepted_at DESC, accepted_rewards.annotation_id DESC
        """,
        (rs, rowNum) -> new RewardDetailRecord(
            rs.getLong("task_id"),
            rs.getLong("assignment_id"),
            rs.getLong("annotation_id"),
            rs.getString("task_title"),
            rs.getLong("item_id"),
            rs.getInt("item_index"),
            toDouble(rs.getObject("reward_per_item")),
            toLocalDateTime(rs.getTimestamp("accepted_at"))),
        labelerId);
  }

  public long countAiPassedToday(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT an.id)
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN ai_review_jobs aj ON aj.annotation_id = an.id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
          AND aj.decision = 'PASS'
          AND COALESCE(an.submitted_at, an.created_at) >= CURRENT_DATE()
          AND COALESCE(an.submitted_at, an.created_at) < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
        """,
        labelerId);
  }

  public long countHumanConfirmedToday(long labelerId) {
    return queryLong(
        """
        SELECT COUNT(DISTINCT an.id)
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
          AND LOWER(hr.decision) IN ('approve', 'approved')
          AND hr.created_at >= CURRENT_DATE()
          AND hr.created_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)
        """,
        labelerId);
  }

  public LabelerOverviewResponse.ReviewDistribution getReviewDistribution(long labelerId) {
    AiDecisionCounts aiCounts = jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE WHEN aj.decision = 'PASS' THEN 1 ELSE 0 END) AS ai_pass,
          SUM(CASE WHEN aj.decision = 'NEED_HUMAN_REVIEW' THEN 1 ELSE 0 END) AS ai_need_human,
          SUM(CASE WHEN aj.decision = 'REJECT' THEN 1 ELSE 0 END) AS ai_reject
        FROM ai_review_jobs aj
        JOIN annotations an ON an.id = aj.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
          AND aj.result_created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)
        """,
        (rs, rowNum) -> new AiDecisionCounts(
            rs.getLong("ai_pass"),
            rs.getLong("ai_need_human"),
            rs.getLong("ai_reject")),
        labelerId);

    HumanDecisionCounts humanCounts = jdbcTemplate.queryForObject(
        """
        SELECT
          SUM(CASE WHEN LOWER(hr.decision) IN ('approve', 'approved') THEN 1 ELSE 0 END) AS human_pass,
          SUM(CASE WHEN LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected') THEN 1 ELSE 0 END) AS human_returned
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        JOIN assignments a ON a.id = an.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND an.status <> 'voided'
          AND t.deleted_at IS NULL
          AND hr.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)
        """,
        (rs, rowNum) -> new HumanDecisionCounts(
            rs.getLong("human_pass"),
            rs.getLong("human_returned")),
        labelerId);

    AiDecisionCounts safeAi = aiCounts == null ? new AiDecisionCounts(0, 0, 0) : aiCounts;
    HumanDecisionCounts safeHuman = humanCounts == null ? new HumanDecisionCounts(0, 0) : humanCounts;
    return new LabelerOverviewResponse.ReviewDistribution(
        safeAi.aiPass(),
        safeAi.aiNeedHuman(),
        safeAi.aiReject(),
        safeHuman.humanPass(),
        safeHuman.humanReturned());
  }

  public List<RecentBatchRecord> listRecentBatches(long labelerId, int limit) {
    return jdbcTemplate.query(
        """
        SELECT
          t.id AS task_id,
          entry.id AS assignment_id,
          t.title,
          t.description,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          COALESCE(t.quota, item_counts.total_items, 0) AS total_quota,
          COALESCE(assignment_counts.quota_used, 0) AS quota_used,
          t.deadline,
          COALESCE(entry.reward_amount, 0) AS reward_per_item,
          recent.latest_updated
        FROM (
          SELECT a.task_id, MAX(a.updated_at) AS latest_updated
          FROM assignments a
          JOIN tasks t ON t.id = a.task_id
          WHERE a.labeler_id = ?
            AND a.status <> 'voided'
            AND t.deleted_at IS NULL
          GROUP BY a.task_id
          ORDER BY latest_updated DESC
          LIMIT ?
        ) recent
        JOIN tasks t ON t.id = recent.task_id
        JOIN assignments entry ON entry.id = (
          SELECT chosen.id
          FROM assignments chosen
          WHERE chosen.task_id = recent.task_id
            AND chosen.labeler_id = ?
            AND chosen.status <> 'voided'
          ORDER BY
            CASE WHEN chosen.status IN ('returned', 'claimed') THEN 0 ELSE 1 END,
            chosen.updated_at DESC,
            chosen.id ASC
          LIMIT 1
        )
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS quota_used
          FROM assignments
          WHERE status <> 'voided'
          GROUP BY task_id
        ) assignment_counts ON assignment_counts.task_id = t.id
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS total_items
          FROM items
          GROUP BY task_id
        ) item_counts ON item_counts.task_id = t.id
        ORDER BY recent.latest_updated DESC
        """,
        (rs, rowNum) -> new RecentBatchRecord(
            rs.getLong("task_id"),
            rs.getLong("assignment_id"),
            rs.getString("title"),
            rs.getString("description"),
            rs.getString("task_type"),
            rs.getInt("total_quota"),
            rs.getInt("quota_used"),
            toLocalDateTime(rs.getTimestamp("deadline")),
            toDouble(rs.getObject("reward_per_item")),
            toLocalDateTime(rs.getTimestamp("latest_updated"))),
        labelerId,
        limit,
        labelerId);
  }

  public List<String> listSupportedMediaTypes(long labelerId) {
    return jdbcTemplate.query(
        """
        SELECT DISTINCT COALESCE(NULLIF(i.media_type, ''), 'text') AS media_type
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        ORDER BY media_type ASC
        """,
        (rs, rowNum) -> rs.getString("media_type"),
        labelerId);
  }

  public List<PendingTypeRecord> listPendingTypeDistribution(long labelerId) {
    return jdbcTemplate.query(
        """
        SELECT
          COALESCE(NULLIF(i.media_type, ''), 'text') AS media_type,
          COUNT(*) AS item_count
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        WHERE a.labeler_id = ?
          AND a.status IN ('claimed', 'returned')
          AND t.deleted_at IS NULL
        GROUP BY COALESCE(NULLIF(i.media_type, ''), 'text')
        ORDER BY item_count DESC, media_type ASC
        """,
        (rs, rowNum) -> new PendingTypeRecord(
            rs.getString("media_type"),
            rs.getLong("item_count")),
        labelerId);
  }

  private long queryLong(String sql, Object... args) {
    Number value = jdbcTemplate.queryForObject(sql, Number.class, args);
    return value == null ? 0L : value.longValue();
  }

  private double queryDouble(String sql, Object... args) {
    Number value = jdbcTemplate.queryForObject(sql, Number.class, args);
    return value == null ? 0D : value.doubleValue();
  }

  private Double toDouble(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof BigDecimal decimal) {
      return decimal.doubleValue();
    }
    return ((Number) value).doubleValue();
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private record AiDecisionCounts(
      long aiPass,
      long aiNeedHuman,
      long aiReject) {}

  private record HumanDecisionCounts(
      long humanPass,
      long humanReturned) {}

  public record RecentBatchRecord(
      long taskId,
      long assignmentId,
      String title,
      String description,
      String taskType,
      int totalQuota,
      int quotaUsed,
      LocalDateTime deadline,
      Double rewardPerItem,
      LocalDateTime updatedAt) {}

  public record PendingTypeRecord(
      String mediaType,
      long count) {}

  public record RewardDetailRecord(
      long taskId,
      long assignmentId,
      long annotationId,
      String taskTitle,
      long itemId,
      int itemIndex,
      Double rewardPerItem,
      LocalDateTime acceptedAt) {}
}
