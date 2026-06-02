package com.labelhub.backend.labeler;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LabelerReturnedItemsRepository {

  private final JdbcTemplate jdbcTemplate;

  public LabelerReturnedItemsRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countReturnedItems(long labelerId, String source) {
    List<Object> args = new ArrayList<>();
    String sql = switch (source) {
      case "human_return", "reworked", "reviewed" -> humanReworkCountSql(labelerId, source, args);
      case "ai_pre_reject" -> aiPreRejectCountSql(labelerId, args);
      default -> allReturnedCountSql(labelerId, args);
    };
    Long count = jdbcTemplate.queryForObject(sql, Long.class, args.toArray());
    return count == null ? 0 : count;
  }

  public List<ReturnedItemRecord> listReturnedItems(
      long labelerId,
      String source,
      int limit,
      int offset) {
    return queryRecords(labelerId, source, limit, offset);
  }

  private List<ReturnedItemRecord> queryRecords(
      long labelerId,
      String source,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    String sql = switch (source) {
      case "human_return", "reworked", "reviewed" -> humanReworkSql(labelerId, source, args);
      case "ai_pre_reject" -> aiPreRejectSql(labelerId, args);
      default -> allReturnedSql(labelerId, args);
    };
    args.add(limit);
    args.add(offset);
    return jdbcTemplate.query(sql, this::mapRecord, args.toArray());
  }

  private String allReturnedSql(long labelerId, List<Object> args) {
    args.add(labelerId);
    args.add(labelerId);
    return """
        SELECT *
        FROM (
        """ + baseHumanReworkSelect() + """
          UNION ALL
        """ + baseAiPreRejectSelect() + """
        ) returned_items
        ORDER BY updated_at DESC, annotation_id DESC
        LIMIT ? OFFSET ?
        """;
  }

  private String humanReworkSql(long labelerId, String source, List<Object> args) {
    args.add(labelerId);
    return """
        SELECT *
        FROM (
        """ + baseHumanReworkSelect() + """
        ) returned_items
        """ + humanReworkFilter(source) + """
        ORDER BY updated_at DESC, annotation_id DESC
        LIMIT ? OFFSET ?
        """;
  }

  private String aiPreRejectSql(long labelerId, List<Object> args) {
    args.add(labelerId);
    return """
        SELECT *
        FROM (
        """ + baseAiPreRejectSelect() + """
        ) returned_items
        ORDER BY updated_at DESC, annotation_id DESC
        LIMIT ? OFFSET ?
        """;
  }

  private String allReturnedCountSql(long labelerId, List<Object> args) {
    args.add(labelerId);
    args.add(labelerId);
    return """
        SELECT COUNT(*)
        FROM (
        """ + baseHumanReworkSelect() + """
          UNION ALL
        """ + baseAiPreRejectSelect() + """
        ) returned_items
        """;
  }

  private String humanReworkCountSql(long labelerId, String source, List<Object> args) {
    args.add(labelerId);
    return """
        SELECT COUNT(*)
        FROM (
        """ + baseHumanReworkSelect() + """
        ) returned_items
        """ + humanReworkFilter(source) + """
        """;
  }

  private String aiPreRejectCountSql(long labelerId, List<Object> args) {
    args.add(labelerId);
    return """
        SELECT COUNT(*)
        FROM (
        """ + baseAiPreRejectSelect() + """
        ) returned_items
        """;
  }

  private String humanReworkFilter(String source) {
    return switch (source) {
      case "human_return" -> "WHERE rework_status = 'RETURNED'\n";
      case "reworked" -> "WHERE rework_status = 'REWORK_SUBMITTED'\n";
      case "reviewed" -> "WHERE rework_status IN ('REVIEW_APPROVED', 'REVIEW_REVISED', 'REVIEW_ESCALATED')\n";
      default -> "";
    };
  }

  private String baseHumanReworkSelect() {
    return """
          SELECT
            'HUMAN_REVIEW_RETURN' AS source,
            a.id AS assignment_id,
            COALESCE(rework_an.id, returned_an.id) AS annotation_id,
            a.task_id,
            a.item_id,
            a.resubmit_deadline,
            t.title AS task_title,
            JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
            COALESCE(rework_an.schema_version_id, returned_an.schema_version_id) AS schema_version_id,
            COALESCE(rework_an.revision_no, returned_an.revision_no) AS revision_no,
            CASE
              WHEN rework_an.id IS NULL THEN COALESCE(return_hr.updated_at, return_hr.created_at, a.updated_at)
              WHEN review_hr.id IS NULL THEN COALESCE(rework_an.submitted_at, rework_an.updated_at, a.updated_at)
              ELSE COALESCE(review_hr.updated_at, review_hr.created_at, rework_an.updated_at, a.updated_at)
            END AS updated_at,
            COALESCE(review_reviewer.name, return_reviewer.name) AS reviewer_name,
            COALESCE(review_hr.round_no, return_hr.round_no) AS review_round_no,
            return_hr.reason AS human_reason,
            air.decision AS ai_decision,
            air.comment AS ai_comment,
            air.total_score AS ai_total_score,
            CAST(air.risk_flags_json AS CHAR) AS ai_risk_flags_json,
            CAST(air.evidence_json AS CHAR) AS ai_evidence_json,
            (
              SELECT COUNT(*)
              FROM assignments ranked
              WHERE ranked.task_id = a.task_id
                AND ranked.labeler_id = a.labeler_id
                AND ranked.status <> 'voided'
                AND ranked.id <= a.id
            ) AS item_index,
            CASE
              WHEN rework_an.id IS NULL THEN 'RETURNED'
              WHEN review_hr.id IS NULL THEN 'REWORK_SUBMITTED'
              WHEN LOWER(review_hr.decision) IN ('approve', 'approved') THEN 'REVIEW_APPROVED'
              WHEN LOWER(review_hr.decision) IN ('revise', 'revised') THEN 'REVIEW_REVISED'
              WHEN LOWER(review_hr.decision) = 'escalate' THEN 'REVIEW_ESCALATED'
              ELSE 'REWORK_SUBMITTED'
            END AS rework_status,
            COALESCE(review_hr.decision, return_hr.decision) AS review_decision,
            CASE
              WHEN rework_an.id IS NULL THEN return_hr.reason
              ELSE review_hr.reason
            END AS review_result_reason,
            CASE
              WHEN rework_an.id IS NULL THEN return_hr.created_at
              ELSE review_hr.created_at
            END AS reviewed_at,
            rework_an.submitted_at AS rework_submitted_at,
            return_counts.return_count
          FROM assignments a
          JOIN tasks t ON t.id = a.task_id
          JOIN annotations returned_an ON returned_an.id = (
            SELECT an_ret.id
            FROM annotations an_ret
            JOIN human_reviews hr_ret ON hr_ret.annotation_id = an_ret.id
            WHERE an_ret.assignment_id = a.id
              AND an_ret.status <> 'voided'
              AND LOWER(hr_ret.decision) IN ('return', 'returned', 'reject', 'rejected')
            ORDER BY an_ret.revision_no DESC, hr_ret.created_at DESC, hr_ret.id DESC
            LIMIT 1
          )
          JOIN human_reviews return_hr ON return_hr.id = (
            SELECT latest_return_hr.id
            FROM human_reviews latest_return_hr
            WHERE latest_return_hr.annotation_id = returned_an.id
              AND LOWER(latest_return_hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            ORDER BY latest_return_hr.round_no DESC, latest_return_hr.id DESC
            LIMIT 1
          )
          JOIN users return_reviewer ON return_reviewer.id = return_hr.reviewer_id
          LEFT JOIN annotations rework_an ON rework_an.id = (
            SELECT next_an.id
            FROM annotations next_an
            WHERE next_an.assignment_id = a.id
              AND next_an.status <> 'voided'
              AND next_an.revision_no > returned_an.revision_no
            ORDER BY next_an.revision_no ASC, next_an.id ASC
            LIMIT 1
          )
          LEFT JOIN human_reviews review_hr ON review_hr.id = (
            SELECT latest_review_hr.id
            FROM human_reviews latest_review_hr
            WHERE latest_review_hr.annotation_id = rework_an.id
            ORDER BY latest_review_hr.round_no DESC, latest_review_hr.id DESC
            LIMIT 1
          )
          LEFT JOIN users review_reviewer ON review_reviewer.id = review_hr.reviewer_id
          JOIN (
            SELECT counted_an.assignment_id, COUNT(*) AS return_count
            FROM annotations counted_an
            JOIN human_reviews counted_hr ON counted_hr.annotation_id = counted_an.id
            WHERE counted_an.status <> 'voided'
              AND LOWER(counted_hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            GROUP BY counted_an.assignment_id
          ) return_counts ON return_counts.assignment_id = a.id
          LEFT JOIN ai_review_results air ON air.id = (
            SELECT latest_air.id
            FROM ai_review_results latest_air
            JOIN ai_review_jobs latest_aj ON latest_aj.id = latest_air.job_id
            WHERE latest_aj.annotation_id = COALESCE(rework_an.id, returned_an.id)
            ORDER BY latest_air.created_at DESC, latest_air.id DESC
            LIMIT 1
          )
          WHERE a.labeler_id = ?
            AND a.status <> 'voided'
            AND t.deleted_at IS NULL
        """;
  }

  private String baseAiPreRejectSelect() {
    return """
          SELECT
            'AI_PRE_REJECT' AS source,
            a.id AS assignment_id,
            an.id AS annotation_id,
            a.task_id,
            a.item_id,
            NULL AS resubmit_deadline,
            t.title AS task_title,
            JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
            an.schema_version_id,
            an.revision_no,
            COALESCE(air.created_at, an.updated_at, a.updated_at) AS updated_at,
            NULL AS reviewer_name,
            NULL AS review_round_no,
            NULL AS human_reason,
            air.decision AS ai_decision,
            air.comment AS ai_comment,
            air.total_score AS ai_total_score,
            CAST(air.risk_flags_json AS CHAR) AS ai_risk_flags_json,
            CAST(air.evidence_json AS CHAR) AS ai_evidence_json,
            (
              SELECT COUNT(*)
              FROM assignments ranked
              WHERE ranked.task_id = a.task_id
                AND ranked.labeler_id = a.labeler_id
                AND ranked.status <> 'voided'
                AND ranked.id <= a.id
            ) AS item_index,
            'AI_PRE_REJECT' AS rework_status,
            NULL AS review_decision,
            NULL AS review_result_reason,
            NULL AS reviewed_at,
            NULL AS rework_submitted_at,
            0 AS return_count
          FROM assignments a
          JOIN tasks t ON t.id = a.task_id
          JOIN annotations an ON an.id = (
            SELECT latest_an.id
            FROM annotations latest_an
            WHERE latest_an.assignment_id = a.id
              AND latest_an.status <> 'voided'
            ORDER BY latest_an.revision_no DESC, latest_an.id DESC
            LIMIT 1
          )
          JOIN ai_review_results air ON air.id = (
            SELECT latest_air.id
            FROM ai_review_results latest_air
            JOIN ai_review_jobs latest_aj ON latest_aj.id = latest_air.job_id
            WHERE latest_aj.annotation_id = an.id
            ORDER BY latest_air.created_at DESC, latest_air.id DESC
            LIMIT 1
          )
          WHERE a.labeler_id = ?
            AND a.status NOT IN ('returned', 'accepted', 'voided')
            AND an.status = 'reviewing'
            AND air.decision = 'REJECT'
            AND t.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM human_reviews hr_done
              WHERE hr_done.annotation_id = an.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM annotations returned_history_an
              JOIN human_reviews returned_history_hr ON returned_history_hr.annotation_id = returned_history_an.id
              WHERE returned_history_an.assignment_id = a.id
                AND LOWER(returned_history_hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            )
        """;
  }

  private ReturnedItemRecord mapRecord(ResultSet rs, int rowNum) throws SQLException {
    return new ReturnedItemRecord(
        rs.getString("source"),
        rs.getLong("assignment_id"),
        rs.getLong("annotation_id"),
        rs.getLong("task_id"),
        rs.getLong("item_id"),
        toLocalDateTime(rs.getTimestamp("resubmit_deadline")),
        rs.getString("task_title"),
        rs.getString("task_type"),
        rs.getLong("schema_version_id"),
        rs.getInt("revision_no"),
        toLocalDateTime(rs.getTimestamp("updated_at")),
        rs.getString("reviewer_name"),
        toInteger(rs.getObject("review_round_no")),
        rs.getString("human_reason"),
        rs.getString("ai_decision"),
        rs.getString("ai_comment"),
        toDouble(rs.getObject("ai_total_score")),
        rs.getString("ai_risk_flags_json"),
        rs.getString("ai_evidence_json"),
        rs.getInt("item_index"),
        rs.getString("rework_status"),
        rs.getString("review_decision"),
        rs.getString("review_result_reason"),
        toLocalDateTime(rs.getTimestamp("reviewed_at")),
        toLocalDateTime(rs.getTimestamp("rework_submitted_at")),
        rs.getInt("return_count"));
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Integer toInteger(Object value) {
    return value == null ? null : ((Number) value).intValue();
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

  public record ReturnedItemRecord(
      String source,
      long assignmentId,
      long annotationId,
      long taskId,
      long itemId,
      LocalDateTime resubmitDeadline,
      String taskTitle,
      String taskType,
      long schemaVersionId,
      int revisionNo,
      LocalDateTime updatedAt,
      String reviewerName,
      Integer reviewRoundNo,
      String humanReason,
      String aiDecision,
      String aiComment,
      Double aiTotalScore,
      String aiRiskFlagsJson,
      String aiEvidenceJson,
      int itemIndex,
      String reworkStatus,
      String reviewDecision,
      String reviewResultReason,
      LocalDateTime reviewedAt,
      LocalDateTime reworkSubmittedAt,
      int returnCount) {}
}
