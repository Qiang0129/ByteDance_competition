package com.labelhub.backend.annotation;

import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AnnotationRepository {

  private final JdbcTemplate jdbcTemplate;

  public AnnotationRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<AssignmentItemRecord> findAssignmentForLabeler(long assignmentId, long labelerId) {
    return queryAssignment(
        "WHERE a.id = ? AND a.labeler_id = ?",
        List.of(assignmentId, labelerId),
        "").stream().findFirst();
  }

  public Optional<AssignmentItemRecord> lockAssignmentForLabeler(long assignmentId, long labelerId) {
    return queryAssignment(
        "WHERE a.id = ? AND a.labeler_id = ?",
        List.of(assignmentId, labelerId),
        "FOR UPDATE").stream().findFirst();
  }

  public List<AssignmentItemRecord> lockTaskAssignmentsForLabeler(long taskId, long labelerId) {
    return queryAssignment(
        "WHERE a.task_id = ? AND a.labeler_id = ? AND a.status <> 'voided'",
        List.of(taskId, labelerId),
        "ORDER BY a.id ASC FOR UPDATE");
  }

  public List<AssignmentItemRecord> lockUnfinishedTaskAssignments(long taskId) {
    return queryAssignment(
        """
        WHERE a.task_id = ?
          AND a.status IN ('claimed', 'returned')
        """,
        List.of(taskId),
        "ORDER BY a.id ASC FOR UPDATE");
  }

  public Optional<SchemaSnapshotRecord> findSchema(long schemaVersionId) {
    return jdbcTemplate.query(
        """
        SELECT id, version, CAST(schema_json AS CHAR) AS schema_json, status, deleted_at
        FROM task_schema_versions
        WHERE id = ?
        """,
        (rs, rowNum) -> new SchemaSnapshotRecord(
            rs.getLong("id"),
            rs.getInt("version"),
            rs.getString("schema_json"),
            rs.getString("status"),
            toLocalDateTime(rs.getTimestamp("deleted_at"))),
        schemaVersionId)
        .stream()
        .findFirst();
  }

  public Optional<DraftRecord> findDraft(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT assignment_id, CAST(answer_json AS CHAR) AS answer_json, updated_at
        FROM drafts
        WHERE assignment_id = ?
        """,
        (rs, rowNum) -> new DraftRecord(
            rs.getLong("assignment_id"),
            rs.getString("answer_json"),
            toLocalDateTime(rs.getTimestamp("updated_at"))),
        assignmentId)
        .stream()
        .findFirst();
  }

  public long countDraftsForLabeler(long labelerId) {
    Long total = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM drafts d
        JOIN assignments a ON a.id = d.assignment_id
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        """,
        Long.class,
        labelerId);
    return total == null ? 0L : total;
  }

  public List<LabelerDraftRecord> listDraftsForLabeler(long labelerId, int limit, int offset) {
    return jdbcTemplate.query(
        """
        SELECT
          a.id AS assignment_id,
          a.task_id,
          a.item_id,
          a.labeler_id,
          a.status AS assignment_status,
          a.resubmit_deadline,
          t.title AS task_title,
          t.status AS task_status,
          t.deadline AS task_deadline,
          t.deleted_at AS task_deleted_at,
          JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')) AS task_type,
          tsv.id AS schema_version_id,
          tsv.version AS schema_version,
          d.updated_at AS draft_updated_at,
          (
            SELECT COUNT(*)
            FROM assignments ranked
            WHERE ranked.task_id = a.task_id
              AND ranked.labeler_id = a.labeler_id
              AND ranked.status <> 'voided'
              AND ranked.id <= a.id
          ) AS item_index
        FROM drafts d
        JOIN assignments a ON a.id = d.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        LEFT JOIN task_schema_versions tsv ON tsv.id = COALESCE(
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.schemaVersionId')), '') AS UNSIGNED),
          (
            SELECT latest_tsv.id
            FROM task_schema_versions latest_tsv
            WHERE latest_tsv.task_id = a.task_id
            ORDER BY latest_tsv.version DESC
            LIMIT 1
          )
        )
        WHERE a.labeler_id = ?
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        ORDER BY d.updated_at DESC, d.id DESC
        LIMIT ? OFFSET ?
        """,
        (rs, rowNum) -> new LabelerDraftRecord(
            rs.getLong("assignment_id"),
            rs.getLong("task_id"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id"),
            rs.getString("assignment_status"),
            toLocalDateTime(rs.getTimestamp("resubmit_deadline")),
            rs.getString("task_title"),
            rs.getString("task_status"),
            toLocalDateTime(rs.getTimestamp("task_deadline")),
            toLocalDateTime(rs.getTimestamp("task_deleted_at")),
            rs.getString("task_type"),
            toLong(rs.getObject("schema_version_id")),
            toInteger(rs.getObject("schema_version")),
            toLocalDateTime(rs.getTimestamp("draft_updated_at")),
            rs.getInt("item_index")),
        labelerId,
        limit,
        offset);
  }

  public Optional<AnnotationRecord> findLatestAnnotation(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT
          id,
          assignment_id,
          schema_version_id,
          CAST(schema_snapshot_json AS CHAR) AS schema_snapshot_json,
          CAST(answer_json AS CHAR) AS answer_json,
          status,
          revision_no
        FROM annotations
        WHERE assignment_id = ?
        ORDER BY revision_no DESC, id DESC
        LIMIT 1
        """,
        (rs, rowNum) -> new AnnotationRecord(
            rs.getLong("id"),
            rs.getLong("assignment_id"),
            rs.getLong("schema_version_id"),
            rs.getString("schema_snapshot_json"),
            rs.getString("answer_json"),
            rs.getString("status"),
            rs.getInt("revision_no")),
        assignmentId)
        .stream()
        .findFirst();
  }

  public DraftRecord upsertDraft(long assignmentId, String answerJson) {
    jdbcTemplate.update(
        """
        INSERT INTO drafts (assignment_id, answer_json)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          answer_json = VALUES(answer_json),
          updated_at = CURRENT_TIMESTAMP
        """,
        assignmentId,
        answerJson);
    return findDraft(assignmentId)
        .orElseThrow(() -> new IllegalStateException("failed to load saved draft"));
  }

  public List<Long> listAssignmentIdsForPosition(long taskId, long labelerId) {
    return jdbcTemplate.query(
        """
        SELECT id
        FROM assignments
        WHERE task_id = ? AND labeler_id = ? AND status <> 'voided'
        ORDER BY id ASC
        """,
        (rs, rowNum) -> rs.getLong("id"),
        taskId,
        labelerId);
  }

  /**
   * 批量拉取某任务下当前标注员全部作业项的状态与草稿答案,
   * 用于答题页进度条逐题着色(已完成/必填缺失/未作答),按 id 升序与题序对齐。
   * 一次 LEFT JOIN 取回草稿,避免逐题查询。
   */
  public List<AssignmentProgressRecord> listAssignmentProgress(long taskId, long labelerId) {
    return jdbcTemplate.query(
        """
        SELECT a.id AS assignment_id,
               a.status AS assignment_status,
               CAST(d.answer_json AS CHAR) AS answer_json
        FROM assignments a
        LEFT JOIN drafts d ON d.assignment_id = a.id
        WHERE a.task_id = ? AND a.labeler_id = ? AND a.status <> 'voided'
        ORDER BY a.id ASC
        """,
        (rs, rowNum) -> new AssignmentProgressRecord(
            rs.getLong("assignment_id"),
            rs.getString("assignment_status"),
            rs.getString("answer_json")),
        taskId,
        labelerId);
  }

  public Optional<String> findLatestReturnReason(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT hr.reason
        FROM human_reviews hr
        JOIN annotations an ON an.id = hr.annotation_id
        WHERE an.assignment_id = ?
          AND LOWER(hr.decision) IN ('return', 'returned', 'reject', 'rejected')
          AND hr.reason IS NOT NULL
          AND hr.reason <> ''
        ORDER BY hr.created_at DESC, hr.id DESC
        LIMIT 1
        """,
        (rs, rowNum) -> rs.getString("reason"),
        assignmentId)
        .stream()
        .findFirst();
  }

  public LabelerContributionRecord getLabelerContribution(long labelerId, long taskId) {
    LabelerContributionRecord record = jdbcTemplate.queryForObject(
        """
        SELECT
          COUNT(DISTINCT CASE
            WHEN EXISTS (
              SELECT 1
              FROM annotations submitted_an
              WHERE submitted_an.assignment_id = a.id
                AND submitted_an.status <> 'voided'
            ) THEN a.id
          END) AS submitted_count,
          COUNT(DISTINCT CASE
            WHEN a.status IN ('accepted', 'exported')
              OR LOWER(COALESCE((
                SELECT latest_hr.decision
                FROM annotations latest_an
                JOIN human_reviews latest_hr ON latest_hr.annotation_id = latest_an.id
                WHERE latest_an.assignment_id = a.id
                  AND latest_an.status <> 'voided'
                ORDER BY latest_an.revision_no DESC, latest_hr.created_at DESC, latest_hr.id DESC
                LIMIT 1
              ), '')) IN ('approve', 'approved', 'revise', 'revised') THEN a.id
          END) AS approved_count,
          COUNT(DISTINCT CASE
            WHEN EXISTS (
              SELECT 1
              FROM annotations returned_an
              JOIN human_reviews returned_hr ON returned_hr.annotation_id = returned_an.id
              WHERE returned_an.assignment_id = a.id
                AND returned_an.status <> 'voided'
                AND LOWER(returned_hr.decision) IN ('return', 'returned', 'reject', 'rejected')
            ) THEN a.id
          END) AS returned_count
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.labeler_id = ?
          AND a.task_id = ?
          AND a.status <> 'voided'
          AND t.deleted_at IS NULL
        """,
        (rs, rowNum) -> new LabelerContributionRecord(
            rs.getLong("submitted_count"),
            rs.getLong("approved_count"),
            rs.getLong("returned_count")),
        labelerId,
        taskId);
    return record == null ? new LabelerContributionRecord(0, 0, 0) : record;
  }

  public List<LabelerItemHistoryRecord> listLabelerItemHistory(long assignmentId) {
    return jdbcTemplate.query(
        """
        SELECT
          history.annotation_id,
          history.revision_no,
          history.event_type,
          history.submitted_at,
          history.ai_finished_at,
          history.ai_decision,
          history.ai_total_score,
          history.ai_comment,
          history.human_decision,
          history.human_reason,
          history.human_reviewed_at,
          history.human_reviewer_name
        FROM (
          SELECT
            an.id AS annotation_id,
            an.revision_no,
            'submit' AS event_type,
            COALESCE(an.submitted_at, an.created_at) AS submitted_at,
            NULL AS ai_finished_at,
            NULL AS ai_decision,
            NULL AS ai_total_score,
            NULL AS ai_comment,
            NULL AS human_decision,
            NULL AS human_reason,
            NULL AS human_reviewed_at,
            NULL AS human_reviewer_name,
            0 AS event_order,
            NULL AS human_round_no,
            NULL AS human_review_id
          FROM annotations an
          WHERE an.assignment_id = ?
            AND an.status <> 'voided'

          UNION ALL

          SELECT
            an.id AS annotation_id,
            an.revision_no,
            'ai_review' AS event_type,
            NULL AS submitted_at,
            aj.finished_at AS ai_finished_at,
            air.decision AS ai_decision,
            air.total_score AS ai_total_score,
            air.comment AS ai_comment,
            NULL AS human_decision,
            NULL AS human_reason,
            NULL AS human_reviewed_at,
            NULL AS human_reviewer_name,
            1 AS event_order,
            NULL AS human_round_no,
            NULL AS human_review_id
          FROM annotations an
          LEFT JOIN ai_review_jobs aj ON aj.id = (
            SELECT latest_job.id
            FROM ai_review_jobs latest_job
            WHERE latest_job.annotation_id = an.id
            ORDER BY COALESCE(latest_job.finished_at, latest_job.started_at, latest_job.created_at) DESC,
              latest_job.id DESC
            LIMIT 1
          )
          LEFT JOIN ai_review_results air ON air.job_id = aj.id
          WHERE an.assignment_id = ?
            AND an.status <> 'voided'
            AND aj.id IS NOT NULL

          UNION ALL

          SELECT
            an.id AS annotation_id,
            an.revision_no,
            'human_review' AS event_type,
            NULL AS submitted_at,
            NULL AS ai_finished_at,
            NULL AS ai_decision,
            NULL AS ai_total_score,
            NULL AS ai_comment,
            hr.decision AS human_decision,
            hr.reason AS human_reason,
            hr.created_at AS human_reviewed_at,
            reviewer.name AS human_reviewer_name,
            2 AS event_order,
            hr.round_no AS human_round_no,
            hr.id AS human_review_id
          FROM annotations an
          JOIN human_reviews hr ON hr.annotation_id = an.id
          LEFT JOIN users reviewer ON reviewer.id = hr.reviewer_id
          WHERE an.assignment_id = ?
            AND an.status <> 'voided'
        ) history
        ORDER BY
          history.revision_no ASC,
          history.annotation_id ASC,
          history.event_order ASC,
          history.submitted_at ASC,
          history.ai_finished_at ASC,
          history.human_reviewed_at ASC,
          history.human_round_no ASC,
          history.human_review_id ASC
        """,
        (rs, rowNum) -> new LabelerItemHistoryRecord(
            rs.getLong("annotation_id"),
            rs.getInt("revision_no"),
            rs.getString("event_type"),
            toLocalDateTime(rs.getTimestamp("submitted_at")),
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

  public int nextRevisionNo(long assignmentId) {
    Integer next = jdbcTemplate.queryForObject(
        """
        SELECT COALESCE(MAX(revision_no), 0) + 1
        FROM annotations
        WHERE assignment_id = ?
        """,
        Integer.class,
        assignmentId);
    return next == null ? 1 : next;
  }

  public long createAnnotation(
      long assignmentId,
      long schemaVersionId,
      String schemaSnapshotJson,
      String answerJson,
      int revisionNo,
      String status) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO annotations
            (assignment_id, schema_version_id, schema_snapshot_json, answer_json, status, revision_no, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          """,
          Statement.RETURN_GENERATED_KEYS);
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

  public void markSubmitted(long assignmentId, long itemId) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = 'submitted',
            submitted_at = CURRENT_TIMESTAMP,
            resubmit_deadline = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        assignmentId);
    jdbcTemplate.update(
        """
        UPDATE items
        SET item_status = 'submitted',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        itemId);
  }

  public void updateAssignmentStatus(long assignmentId, String status) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = ?,
            submitted_at = CASE
              WHEN ? = 'submitted' THEN CURRENT_TIMESTAMP
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

  public void updateItemStatus(long itemId, String status) {
    jdbcTemplate.update(
        """
        UPDATE items
        SET item_status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        status,
        itemId);
  }

  public void releaseAssignment(long assignmentId, long itemId) {
    jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = 'voided',
            resubmit_deadline = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        assignmentId);
    jdbcTemplate.update(
        """
        UPDATE items
        SET item_status = 'pending',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        itemId);
  }

  public void updateAnnotationStatus(long annotationId, String status) {
    jdbcTemplate.update(
        """
        UPDATE annotations
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        status,
        annotationId);
  }

  public int deleteDraft(long assignmentId) {
    return jdbcTemplate.update("DELETE FROM drafts WHERE assignment_id = ?", assignmentId);
  }

  public IssueRecord createIssue(
      long assignmentId,
      long taskId,
      long itemId,
      long labelerId,
      String category,
      String description) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO issues
            (assignment_id, task_id, item_id, labeler_id, category, description, status)
          VALUES (?, ?, ?, ?, ?, ?, 'open')
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, assignmentId);
      statement.setLong(2, taskId);
      statement.setLong(3, itemId);
      statement.setLong(4, labelerId);
      statement.setString(5, category);
      statement.setString(6, description);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create issue");
    }
    return findIssue(key.longValue())
        .orElseThrow(() -> new IllegalStateException("failed to load created issue"));
  }

  public Optional<IssueRecord> findIssue(long issueId) {
    return jdbcTemplate.query(
        """
        SELECT id, assignment_id, task_id, item_id, labeler_id, category, description, status, created_at
        FROM issues
        WHERE id = ?
        """,
        (rs, rowNum) -> new IssueRecord(
            rs.getLong("id"),
            rs.getLong("assignment_id"),
            rs.getLong("task_id"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id"),
            rs.getString("category"),
            rs.getString("description"),
            rs.getString("status"),
            toLocalDateTime(rs.getTimestamp("created_at"))),
        issueId)
        .stream()
        .findFirst();
  }

  public long createAiReviewJob(
      long annotationId,
      long schemaVersionId,
      long ruleId,
      String ruleSnapshotJson) {
    String jobKey = "annotation:%d:schema:%d:rule:%d"
        .formatted(annotationId, schemaVersionId, ruleId);
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO ai_review_jobs
            (annotation_id, job_key, rule_id, rule_snapshot_json, status, retry_count, available_at)
          VALUES (?, ?, ?, CAST(? AS JSON), 'pending', 0, CURRENT_TIMESTAMP)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setLong(1, annotationId);
      statement.setString(2, jobKey);
      statement.setLong(3, ruleId);
      statement.setString(4, ruleSnapshotJson);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create ai review job");
    }
    return key.longValue();
  }

  private List<AssignmentItemRecord> queryAssignment(
      String whereClause,
      List<Object> args,
      String suffix) {
    String sql = """
        SELECT
          a.id AS assignment_id,
          a.task_id,
          a.item_id,
          a.labeler_id,
          a.status AS assignment_status,
          a.resubmit_deadline,
          t.title AS task_title,
          t.status AS task_status,
          t.deadline AS task_deadline,
          t.deleted_at AS task_deleted_at,
          CAST(t.reward_rule AS CHAR) AS reward_rule_json,
          i.item_status,
          CAST(i.raw_payload AS CHAR) AS raw_payload_json,
          i.media_type,
          i.media_url,
          i.content_markdown,
          tsv.id AS fallback_schema_version_id,
          tsv.version AS fallback_schema_version,
          CAST(tsv.schema_json AS CHAR) AS fallback_schema_json,
          tsv.status AS fallback_schema_status,
          tsv.deleted_at AS fallback_schema_deleted_at
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN items i ON i.id = a.item_id
        LEFT JOIN task_schema_versions tsv ON tsv.id = COALESCE(
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.schemaVersionId')), '') AS UNSIGNED),
          (
            SELECT latest_tsv.id
            FROM task_schema_versions latest_tsv
            WHERE latest_tsv.task_id = a.task_id
            ORDER BY latest_tsv.version DESC
            LIMIT 1
          )
        )
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new AssignmentItemRecord(
            rs.getLong("assignment_id"),
            rs.getLong("task_id"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id"),
            rs.getString("assignment_status"),
            toLocalDateTime(rs.getTimestamp("resubmit_deadline")),
            rs.getString("task_title"),
            rs.getString("task_status"),
            toLocalDateTime(rs.getTimestamp("task_deadline")),
            toLocalDateTime(rs.getTimestamp("task_deleted_at")),
            rs.getString("reward_rule_json"),
            rs.getString("item_status"),
            rs.getString("raw_payload_json"),
            rs.getString("media_type"),
            rs.getString("media_url"),
            rs.getString("content_markdown"),
            toLong(rs.getObject("fallback_schema_version_id")),
            toInteger(rs.getObject("fallback_schema_version")),
            rs.getString("fallback_schema_json"),
            rs.getString("fallback_schema_status"),
            toLocalDateTime(rs.getTimestamp("fallback_schema_deleted_at"))),
        args.toArray());
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Integer toInteger(Object value) {
    return value == null ? null : ((Number) value).intValue();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private Double toDouble(Object value) {
    return value == null ? null : ((Number) value).doubleValue();
  }

  public record AssignmentItemRecord(
      long assignmentId,
      long taskId,
      long itemId,
      long labelerId,
      String assignmentStatus,
      LocalDateTime resubmitDeadline,
      String taskTitle,
      String taskStatus,
      LocalDateTime taskDeadline,
      LocalDateTime taskDeletedAt,
      String rewardRuleJson,
      String itemStatus,
      String rawPayloadJson,
      String mediaType,
      String mediaUrl,
      String contentMarkdown,
      Long fallbackSchemaVersionId,
      Integer fallbackSchemaVersion,
      String fallbackSchemaJson,
      String fallbackSchemaStatus,
      LocalDateTime fallbackSchemaDeletedAt) {}

  public record SchemaSnapshotRecord(
      long id,
      int version,
      String schemaJson,
      String status,
      LocalDateTime deletedAt) {}

  public record DraftRecord(
      long assignmentId,
      String answerJson,
      LocalDateTime updatedAt) {}

  public record LabelerDraftRecord(
      long assignmentId,
      long taskId,
      long itemId,
      long labelerId,
      String assignmentStatus,
      LocalDateTime resubmitDeadline,
      String taskTitle,
      String taskStatus,
      LocalDateTime taskDeadline,
      LocalDateTime taskDeletedAt,
      String taskType,
      Long schemaVersionId,
      Integer schemaVersion,
      LocalDateTime draftUpdatedAt,
      int itemIndex) {}

  public record LabelerContributionRecord(
      long submittedCount,
      long approvedCount,
      long returnedCount) {}

  public record LabelerItemHistoryRecord(
      long annotationId,
      int revisionNo,
      String eventType,
      LocalDateTime submittedAt,
      LocalDateTime aiFinishedAt,
      String aiDecision,
      Double aiTotalScore,
      String aiComment,
      String humanDecision,
      String humanReason,
      LocalDateTime humanReviewedAt,
      String humanReviewerName) {}

  /** 进度条逐题状态判定用:作业项状态 + 草稿答案(可空) */
  public record AssignmentProgressRecord(
      long assignmentId,
      String assignmentStatus,
      String answerJson) {}

  public record IssueRecord(
      long id,
      long assignmentId,
      long taskId,
      long itemId,
      long labelerId,
      String category,
      String description,
      String status,
      LocalDateTime createdAt) {}

  public record AnnotationRecord(
      long id,
      long assignmentId,
      long schemaVersionId,
      String schemaSnapshotJson,
      String answerJson,
      String status,
      int revisionNo) {}
}
