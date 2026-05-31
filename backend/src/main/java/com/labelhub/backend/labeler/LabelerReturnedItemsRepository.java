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
      case "human_return" -> humanReturnedCountSql(labelerId, args);
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
      case "human_return" -> humanReturnedSql(labelerId, args);
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
        """ + baseHumanReturnedSelect() + """
          UNION ALL
        """ + baseAiPreRejectSelect() + """
        ) returned_items
        ORDER BY updated_at DESC, annotation_id DESC
        LIMIT ? OFFSET ?
        """;
  }

  private String humanReturnedSql(long labelerId, List<Object> args) {
    args.add(labelerId);
    return """
        SELECT *
        FROM (
        """ + baseHumanReturnedSelect() + """
        ) returned_items
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
        """ + baseHumanReturnedSelect() + """
          UNION ALL
        """ + baseAiPreRejectSelect() + """
        ) returned_items
        """;
  }

  private String humanReturnedCountSql(long labelerId, List<Object> args) {
    args.add(labelerId);
    return """
        SELECT COUNT(*)
        FROM (
        """ + baseHumanReturnedSelect() + """
        ) returned_items
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

  private String baseHumanReturnedSelect() {
    return """
          SELECT
            'HUMAN_REVIEW_RETURN' AS source,
            a.id AS assignment_id,
            an.id AS annotation_id,
            a.task_id,
            a.item_id,
            t.title AS task_title,
            JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
            an.schema_version_id,
            an.revision_no,
            COALESCE(hr.updated_at, hr.created_at, a.updated_at) AS updated_at,
            reviewer.name AS reviewer_name,
            hr.round_no AS review_round_no,
            hr.reason AS human_reason,
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
            ) AS item_index
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
          JOIN human_reviews hr ON hr.id = (
            SELECT latest_hr.id
            FROM human_reviews latest_hr
            WHERE latest_hr.annotation_id = an.id
            ORDER BY latest_hr.round_no DESC, latest_hr.id DESC
            LIMIT 1
          )
          JOIN users reviewer ON reviewer.id = hr.reviewer_id
          LEFT JOIN ai_review_results air ON air.id = (
            SELECT latest_air.id
            FROM ai_review_results latest_air
            JOIN ai_review_jobs latest_aj ON latest_aj.id = latest_air.job_id
            WHERE latest_aj.annotation_id = an.id
            ORDER BY latest_air.created_at DESC, latest_air.id DESC
            LIMIT 1
          )
          WHERE a.labeler_id = ?
            AND a.status = 'returned'
            AND t.deleted_at IS NULL
            AND LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected')
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
            ) AS item_index
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
        """;
  }

  private ReturnedItemRecord mapRecord(ResultSet rs, int rowNum) throws SQLException {
    return new ReturnedItemRecord(
        rs.getString("source"),
        rs.getLong("assignment_id"),
        rs.getLong("annotation_id"),
        rs.getLong("task_id"),
        rs.getLong("item_id"),
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
        rs.getInt("item_index"));
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
      int itemIndex) {}
}
