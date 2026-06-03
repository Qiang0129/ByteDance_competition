package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class TaskRepository {

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public TaskRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public long createTask(
      long ownerId,
      String title,
      String description,
      String status,
      Integer quota,
      LocalDateTime deadline,
      TaskMetadata metadata,
      int schemaVersion) {
    String metadataJson = writeMetadata(metadata);
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO tasks (title, description, status, owner_id, quota, deadline, reward_rule, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, title);
      statement.setString(2, description);
      statement.setString(3, status);
      statement.setLong(4, ownerId);
      if (quota == null) {
        statement.setNull(5, Types.INTEGER);
      } else {
        statement.setInt(5, quota);
      }
      if (deadline == null) {
        statement.setNull(6, Types.TIMESTAMP);
      } else {
        statement.setTimestamp(6, Timestamp.valueOf(deadline));
      }
      statement.setString(7, metadataJson);
      if ("published".equals(status)) {
        statement.setTimestamp(8, Timestamp.valueOf(LocalDateTime.now()));
      } else {
        statement.setNull(8, Types.TIMESTAMP);
      }
      return statement;
    }, keyHolder);

    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create task");
    }

    long taskId = key.longValue();
    if (metadata.schemaVersionId() == null && metadata.schema() != null && !metadata.schema().isBlank()) {
      createSchemaVersion(taskId, schemaVersion, metadata.schema(), ownerId, status);
    }
    return taskId;
  }

  public int updateTask(
      long ownerId,
      long taskId,
      String title,
      String description,
      String status,
      Integer quota,
      LocalDateTime deadline,
      TaskMetadata metadata) {
    String metadataJson = writeMetadata(metadata);
    return jdbcTemplate.update(
        """
        UPDATE tasks
        SET title = ?,
            description = ?,
            status = ?,
            quota = ?,
            deadline = ?,
            reward_rule = ?,
            published_at = CASE
              WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE published_at
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
        """,
        title,
        description,
        status,
        quota,
        deadline == null ? null : Timestamp.valueOf(deadline),
        metadataJson,
        status,
        taskId,
        ownerId);
  }

  public Optional<TaskRecord> findTask(long taskId) {
    List<TaskRecord> records = queryTasks(
        """
        WHERE t.id = ?
        """,
        List.of(taskId),
        "");
    return records.stream().findFirst();
  }

  public List<TaskRecord> listOwnerTasks(long ownerId) {
    return queryTasks(
        """
        WHERE t.owner_id = ? AND t.deleted_at IS NULL
        """,
        List.of(ownerId),
        "ORDER BY t.created_at DESC");
  }

  public List<TaskRecord> listTasksToSettle(LocalDateTime now) {
    return queryTasks(
        """
        WHERE t.deleted_at IS NULL
          AND t.status IN ('published', 'paused')
          AND t.deadline IS NOT NULL
          AND t.deadline <= ?
        """,
        List.of(Timestamp.valueOf(now)),
        "ORDER BY t.deadline ASC, t.id ASC");
  }

  public int deleteTask(long ownerId, long taskId) {
    return jdbcTemplate.update(
        """
        UPDATE tasks
        SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
            status = 'ended',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
        """,
        taskId,
        ownerId);
  }

  public long countMarketTasks(
      String keyword,
      String normalizedTaskType,
      String normalizedStrategy,
      String normalizedMediaType,
      String normalizedAiReview) {
    QueryParts query = buildMarketWhere(
        keyword,
        normalizedTaskType,
        normalizedStrategy,
        normalizedMediaType,
        normalizedAiReview);
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tasks t " + query.whereClause(),
        Long.class,
        query.args().toArray());
    return count == null ? 0L : count;
  }

  public List<TaskRecord> listMarketTasks(
      String keyword,
      String normalizedTaskType,
      String normalizedStrategy,
      String normalizedMediaType,
      String normalizedAiReview,
      String orderBy,
      int offset,
      int pageSize) {
    QueryParts query = buildMarketWhere(
        keyword,
        normalizedTaskType,
        normalizedStrategy,
        normalizedMediaType,
        normalizedAiReview);
    List<Object> args = new ArrayList<>(query.args());
    args.add(pageSize);
    args.add(offset);
    return queryTasks(
        query.whereClause(),
        args,
        orderBy + " LIMIT ? OFFSET ?");
  }

  public boolean lockTask(long taskId) {
    List<Long> ids = jdbcTemplate.query(
        "SELECT id FROM tasks WHERE id = ? FOR UPDATE",
        (rs, rowNum) -> rs.getLong("id"),
        taskId);
    return !ids.isEmpty();
  }

  public Optional<AssignmentRecord> findAssignmentForLabelerTask(long taskId, long labelerId) {
    return queryAssignments(
        """
        WHERE a.task_id = ? AND a.labeler_id = ? AND a.status <> 'voided'
        """,
        List.of(taskId, labelerId),
        """
        ORDER BY
          CASE WHEN a.status IN ('claimed', 'returned') THEN 0 ELSE 1 END,
          a.id ASC
        LIMIT 1
        """).stream().findFirst();
  }

  public Optional<AssignmentRecord> findAssignment(long assignmentId) {
    return queryAssignments(
        """
        WHERE a.id = ?
        """,
        List.of(assignmentId),
        "").stream().findFirst();
  }

  public List<AssignmentRecord> listLabelerAssignments(long labelerId, String status) {
    List<Object> args = new ArrayList<>();
    args.add(labelerId);
    String where = """
        WHERE a.labeler_id = ? AND a.status <> 'voided' AND t.deleted_at IS NULL
        """;
    if (status != null && !status.isBlank()) {
      where += " AND a.status = ?";
      args.add(status);
    }
    return queryAssignments(where, args, "ORDER BY a.updated_at DESC, a.created_at DESC");
  }

  public boolean hasTaskAssignment(long taskId, long labelerId) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM assignments
        WHERE task_id = ? AND labeler_id = ? AND status <> 'voided'
        """,
        Integer.class,
        taskId,
        labelerId);
    return count != null && count > 0;
  }

  public long countTaskAssignments(long taskId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM assignments WHERE task_id = ? AND status <> 'voided'",
        Long.class,
        taskId);
    return count == null ? 0L : count;
  }

  public long countLabelerTaskAssignments(long taskId, long labelerId) {
    Long count = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM assignments
        WHERE task_id = ? AND labeler_id = ? AND status <> 'voided'
        """,
        Long.class,
        taskId,
        labelerId);
    return count == null ? 0L : count;
  }

  public boolean hasTaskWork(long taskId) {
    Integer count = jdbcTemplate.queryForObject(
        """
        SELECT
          (SELECT COUNT(*) FROM assignments WHERE task_id = ? AND status <> 'voided')
          +
          (SELECT COUNT(*)
           FROM annotations an
           JOIN assignments a ON a.id = an.assignment_id
           WHERE a.task_id = ? AND an.status <> 'voided')
        """,
        Integer.class,
        taskId,
        taskId);
    return count != null && count > 0;
  }

  public boolean hasTaskItemSnapshot(long taskId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM task_items WHERE task_id = ?",
        Integer.class,
        taskId);
    return count != null && count > 0;
  }

  public List<Long> listTaskItemIds(long taskId) {
    if (hasTaskItemSnapshot(taskId)) {
      return jdbcTemplate.query(
          """
          SELECT item_id
          FROM task_items
          WHERE task_id = ?
          ORDER BY position_no ASC, id ASC
          """,
          (rs, rowNum) -> rs.getLong("item_id"),
          taskId);
    }
    return jdbcTemplate.query(
        """
        SELECT id
        FROM items
        WHERE task_id = ?
        ORDER BY id ASC
        """,
        (rs, rowNum) -> rs.getLong("id"),
        taskId);
  }

  public void replaceTaskItems(long taskId, List<Long> itemIds) {
    jdbcTemplate.update("DELETE FROM task_items WHERE task_id = ?", taskId);
    if (itemIds == null || itemIds.isEmpty()) {
      return;
    }
    jdbcTemplate.batchUpdate(
        """
        INSERT INTO task_items (task_id, item_id, position_no)
        VALUES (?, ?, ?)
        """,
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(java.sql.PreparedStatement ps, int i) throws java.sql.SQLException {
            ps.setLong(1, taskId);
            ps.setLong(2, itemIds.get(i));
            ps.setInt(3, i + 1);
          }

          @Override
          public int getBatchSize() {
            return itemIds.size();
          }
        });
  }

  public void replaceLabelerAllocations(long taskId, List<UserAllocationRecord> allocations) {
    replaceUserAllocations(taskId, allocations, "task_labeler_allocations", "labeler_id");
  }

  public void replaceReviewerAllocations(long taskId, List<UserAllocationRecord> allocations) {
    replaceUserAllocations(taskId, allocations, "task_reviewer_allocations", "reviewer_id");
  }

  public void replaceTaskReviewItems(long taskId, List<ItemReviewerRecord> records) {
    jdbcTemplate.update("DELETE FROM task_review_items WHERE task_id = ?", taskId);
    if (records == null || records.isEmpty()) {
      return;
    }
    jdbcTemplate.batchUpdate(
        """
        INSERT INTO task_review_items (task_id, item_id, reviewer_id)
        VALUES (?, ?, ?)
        """,
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(java.sql.PreparedStatement ps, int i) throws java.sql.SQLException {
            ItemReviewerRecord record = records.get(i);
            ps.setLong(1, taskId);
            ps.setLong(2, record.itemId());
            ps.setLong(3, record.reviewerId());
          }

          @Override
          public int getBatchSize() {
            return records.size();
          }
        });
  }

  public List<UserAllocationRecord> listLabelerAllocations(long taskId) {
    return listUserAllocations(taskId, "task_labeler_allocations", "labeler_id");
  }

  public List<UserAllocationRecord> listReviewerAllocations(long taskId) {
    return listUserAllocations(taskId, "task_reviewer_allocations", "reviewer_id");
  }

  public long countClaimableItems(long taskId) {
    Long count;
    if (hasTaskItemSnapshot(taskId)) {
      count = jdbcTemplate.queryForObject(
          """
          SELECT COUNT(*)
          FROM task_items ti
          WHERE ti.task_id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM assignments a
              WHERE a.item_id = ti.item_id
                AND a.task_id = ?
                AND a.status <> 'voided'
            )
          """,
          Long.class,
          taskId,
          taskId);
    } else {
      count = jdbcTemplate.queryForObject(
          """
          SELECT COUNT(*)
          FROM items i
          WHERE i.task_id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM assignments a
              WHERE a.item_id = i.id
                AND a.task_id = ?
                AND a.status <> 'voided'
            )
          """,
          Long.class,
          taskId,
          taskId);
    }
    return count == null ? 0L : count;
  }

  public Optional<Long> findFirstClaimableItem(long taskId) {
    return findClaimableItems(taskId, 1).stream().findFirst();
  }

  public List<Long> findClaimableItems(long taskId, int limit) {
    if (limit <= 0) {
      return List.of();
    }
    if (hasTaskItemSnapshot(taskId)) {
      return jdbcTemplate.query(
          """
          SELECT ti.item_id
          FROM task_items ti
          WHERE ti.task_id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM assignments a
              WHERE a.item_id = ti.item_id
                AND a.task_id = ?
                AND a.status <> 'voided'
          )
          ORDER BY ti.position_no ASC, ti.id ASC
          LIMIT ?
          FOR UPDATE
          """,
          (rs, rowNum) -> rs.getLong("item_id"),
          taskId,
          taskId,
          limit);
    }
    return jdbcTemplate.query(
        """
        SELECT i.id
        FROM items i
        WHERE i.task_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM assignments a
            WHERE a.item_id = i.id
              AND a.task_id = ?
              AND a.status <> 'voided'
        )
        ORDER BY i.id ASC
        LIMIT ?
        FOR UPDATE
        """,
        (rs, rowNum) -> rs.getLong("id"),
        taskId,
        taskId,
        limit);
  }

  public long createAssignment(
      long taskId,
      long itemId,
      long labelerId,
      LocalDateTime lockedUntil) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    try {
      jdbcTemplate.update(connection -> {
        var statement = connection.prepareStatement(
            """
            INSERT INTO assignments (task_id, item_id, labeler_id, status, locked_until)
            VALUES (?, ?, ?, 'claimed', ?)
            """,
            Statement.RETURN_GENERATED_KEYS);
        statement.setLong(1, taskId);
        statement.setLong(2, itemId);
        statement.setLong(3, labelerId);
        if (lockedUntil == null) {
          statement.setNull(4, Types.TIMESTAMP);
        } else {
          statement.setTimestamp(4, Timestamp.valueOf(lockedUntil));
        }
        return statement;
      }, keyHolder);
    } catch (DuplicateKeyException exception) {
      throw new DuplicateAssignmentException(taskId, itemId, labelerId, exception);
    }
    jdbcTemplate.update(
        "UPDATE items SET item_status = 'claimed' WHERE id = ?",
        itemId);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create assignment");
    }
    return key.longValue();
  }

  public List<TaskAssignmentStateRecord> listTaskAssignmentStates(long taskId) {
    return jdbcTemplate.query(
        """
        SELECT id, status, item_id, labeler_id
        FROM assignments
        WHERE task_id = ? AND status <> 'voided'
        ORDER BY id ASC
        """,
        (rs, rowNum) -> new TaskAssignmentStateRecord(
            rs.getLong("id"),
            rs.getString("status"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id")),
        taskId);
  }

  public List<TaskAnnotationStateRecord> listTaskAnnotationStates(long taskId) {
    return jdbcTemplate.query(
        """
        SELECT an.id, an.status, an.assignment_id
        FROM annotations an
        JOIN assignments a ON a.id = an.assignment_id
        WHERE a.task_id = ? AND an.status <> 'voided'
        ORDER BY an.id ASC
        """,
        (rs, rowNum) -> new TaskAnnotationStateRecord(
            rs.getLong("id"),
            rs.getString("status"),
            rs.getLong("assignment_id")),
        taskId);
  }

  public int voidTaskAssignments(long taskId) {
    return jdbcTemplate.update(
        """
        UPDATE assignments
        SET status = 'voided',
            updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ? AND status <> 'voided'
        """,
        taskId);
  }

  public int voidTaskAnnotations(long taskId) {
    return jdbcTemplate.update(
        """
        UPDATE annotations an
        JOIN assignments a ON a.id = an.assignment_id
        SET an.status = 'voided',
            an.updated_at = CURRENT_TIMESTAMP
        WHERE a.task_id = ? AND an.status <> 'voided'
        """,
        taskId);
  }

  public int deleteTaskDrafts(long taskId) {
    return jdbcTemplate.update(
        """
        DELETE d
        FROM drafts d
        JOIN assignments a ON a.id = d.assignment_id
        WHERE a.task_id = ?
        """,
        taskId);
  }

  public List<String> listTaskMediaTypes(long taskId) {
    if (hasTaskItemSnapshot(taskId)) {
      return jdbcTemplate.query(
          """
          SELECT DISTINCT COALESCE(NULLIF(i.media_type, ''), 'text') AS media_type
          FROM task_items ti
          JOIN items i ON i.id = ti.item_id
          WHERE ti.task_id = ?
          ORDER BY media_type ASC
          """,
          (rs, rowNum) -> rs.getString("media_type"),
          taskId);
    }
    return jdbcTemplate.query(
        """
        SELECT DISTINCT COALESCE(NULLIF(media_type, ''), 'text') AS media_type
        FROM items
        WHERE task_id = ?
        ORDER BY media_type ASC
        """,
        (rs, rowNum) -> rs.getString("media_type"),
        taskId);
  }

  public int updateTaskState(long ownerId, long taskId, String state) {
    return jdbcTemplate.update(
        """
        UPDATE tasks
        SET status = ?,
            published_at = CASE
              WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE published_at
            END
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
        """,
        state,
        state,
        taskId,
        ownerId);
  }

  public int updateTaskStateSystem(long taskId, String state) {
    return jdbcTemplate.update(
        """
        UPDATE tasks
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        """,
        state,
        taskId);
  }

  public void updateLatestSchemaState(long taskId, String state) {
    jdbcTemplate.update(
        """
        UPDATE task_schema_versions
        SET status = ?,
            published_at = CASE
              WHEN ? = 'published' AND published_at IS NULL THEN CURRENT_TIMESTAMP
              ELSE published_at
            END
        WHERE task_id = ?
          AND EXISTS (
            SELECT 1
            FROM tasks t
            WHERE t.id = task_schema_versions.task_id
              AND t.deleted_at IS NULL
          )
        ORDER BY version DESC
        LIMIT 1
        """,
        state,
        state,
        taskId);
  }

  private void replaceUserAllocations(
      long taskId,
      List<UserAllocationRecord> allocations,
      String table,
      String userColumn) {
    jdbcTemplate.update("DELETE FROM " + table + " WHERE task_id = ?", taskId);
    if (allocations == null || allocations.isEmpty()) {
      return;
    }
    jdbcTemplate.batchUpdate(
        "INSERT INTO " + table + " (task_id, " + userColumn + ", item_count) VALUES (?, ?, ?)",
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(java.sql.PreparedStatement ps, int i) throws java.sql.SQLException {
            UserAllocationRecord allocation = allocations.get(i);
            ps.setLong(1, taskId);
            ps.setLong(2, allocation.userId());
            ps.setInt(3, allocation.itemCount());
          }

          @Override
          public int getBatchSize() {
            return allocations.size();
          }
        });
  }

  private List<UserAllocationRecord> listUserAllocations(long taskId, String table, String userColumn) {
    return jdbcTemplate.query(
        """
        SELECT a.%s AS user_id, u.username, u.name AS display_name, a.item_count
        FROM %s a
        JOIN users u ON u.id = a.%s
        WHERE a.task_id = ?
        ORDER BY u.name ASC, u.username ASC
        """.formatted(userColumn, table, userColumn),
        (rs, rowNum) -> new UserAllocationRecord(
            rs.getLong("user_id"),
            rs.getString("username"),
            rs.getString("display_name"),
            rs.getInt("item_count")),
        taskId);
  }

  private void createSchemaVersion(
      long taskId,
      int version,
      String schemaLabel,
      long ownerId,
      String status) {
    String schemaJson = writeSchema(schemaLabel);
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO task_schema_versions
            (task_id, version, schema_json, status, created_by, published_at)
          VALUES (?, ?, ?, ?, ?, ?)
          """);
      statement.setLong(1, taskId);
      statement.setInt(2, version);
      statement.setString(3, schemaJson);
      statement.setString(4, status);
      statement.setLong(5, ownerId);
      if ("published".equals(status)) {
        statement.setTimestamp(6, Timestamp.valueOf(LocalDateTime.now()));
      } else {
        statement.setNull(6, Types.TIMESTAMP);
      }
      return statement;
    });
  }

  private List<TaskRecord> queryTasks(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.owner_id,
          u.name AS owner_name,
          ds.id AS dataset_id,
          t.quota,
          COALESCE(ac.quota_used, 0) AS quota_used,
          COALESCE(ap.annotated_item_count, 0) AS annotated_item_count,
          CASE
            WHEN COALESCE(ti.task_item_total, 0) > 0 THEN ti.task_item_total
            WHEN COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.strategy')), ''), 'first-come') = 'assigned'
              THEN COALESCE(NULLIF(ai.assignment_item_total, 0), NULLIF(ic.published_item_total, 0), t.quota, 0)
            ELSE COALESCE(t.quota, NULLIF(ic.published_item_total, 0), NULLIF(ai.assignment_item_total, 0), 0)
          END AS published_item_total,
          CASE
            WHEN COALESCE(rm.human_pending_count, 0) > 0 AND COALESCE(rm.max_next_round, 1) >= 3 THEN 'human_final_review'
            WHEN COALESCE(rm.human_pending_count, 0) > 0 AND COALESCE(rm.max_next_round, 1) = 2 THEN 'human_second_review'
            WHEN COALESCE(rm.human_pending_count, 0) > 0 THEN 'human_first_review'
            WHEN COALESCE(rm.ai_reviewing_count, 0) > 0 THEN 'ai_prereviewing'
            WHEN COALESCE(rm.completed_count, 0) > 0 THEN 'completed'
            ELSE 'not_started'
          END AS review_status,
          CASE
            WHEN COALESCE(rm.human_pending_count, 0) > 0 THEN COALESCE(NULLIF(rm.max_next_round, 0), 1)
            ELSE NULL
          END AS review_round,
          t.deadline,
          CAST(t.reward_rule AS CHAR) AS reward_rule_json,
          t.created_at,
          t.published_at,
          t.deleted_at,
          tsv.id AS schema_version_id,
          tsv.version AS schema_version
        FROM tasks t
        JOIN users u ON u.id = t.owner_id
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS quota_used
          FROM assignments
          WHERE status <> 'voided'
          GROUP BY task_id
        ) ac ON ac.task_id = t.id
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS task_item_total
          FROM task_items
          GROUP BY task_id
        ) ti ON ti.task_id = t.id
        LEFT JOIN (
          SELECT task_id, COUNT(DISTINCT item_id) AS assignment_item_total
          FROM assignments
          WHERE status <> 'voided'
          GROUP BY task_id
        ) ai ON ai.task_id = t.id
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS published_item_total
          FROM items
          WHERE task_id IS NOT NULL
          GROUP BY task_id
        ) ic ON ic.task_id = t.id
        LEFT JOIN (
          SELECT a.task_id, COUNT(DISTINCT a.item_id) AS annotated_item_count
          FROM assignments a
          WHERE a.status <> 'voided'
            AND (
              EXISTS (
                SELECT 1
                FROM drafts d
                WHERE d.assignment_id = a.id
                  AND JSON_TYPE(d.answer_json) IN ('OBJECT', 'ARRAY')
                  AND JSON_LENGTH(d.answer_json) > 0
              )
              OR EXISTS (
                SELECT 1
                FROM annotations an
                WHERE an.assignment_id = a.id
                  AND an.status <> 'voided'
              )
            )
          GROUP BY a.task_id
        ) ap ON ap.task_id = t.id
        LEFT JOIN (
          SELECT
            a.task_id,
            COUNT(DISTINCT CASE
              WHEN an.status = 'ai_reviewing'
              THEN an.id END) AS ai_reviewing_count,
            COUNT(DISTINCT CASE
              WHEN an.status IN ('submitted', 'reviewing')
              THEN an.id END) AS human_pending_count,
            MAX(CASE
              WHEN an.status IN ('submitted', 'reviewing')
              THEN COALESCE((
                SELECT MAX(hr.round_no)
                FROM human_reviews hr
                WHERE hr.annotation_id = an.id
              ), 0) + 1
              ELSE 0
            END) AS max_next_round,
            COUNT(DISTINCT CASE
              WHEN an.status IN ('accepted', 'returned', 'revised', 'exported')
                OR a.status IN ('accepted', 'exported', 'returned')
              THEN an.id END) AS completed_count
          FROM assignments a
          JOIN annotations an ON an.assignment_id = a.id
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
        ) rm ON rm.task_id = t.id
        LEFT JOIN datasets ds ON ds.id = (
          SELECT latest_ds.id
          FROM datasets latest_ds
          WHERE latest_ds.task_id = t.id
          ORDER BY latest_ds.updated_at DESC, latest_ds.id DESC
          LIMIT 1
        )
        LEFT JOIN task_schema_versions tsv ON tsv.id = COALESCE(
          CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.schemaVersionId')), '') AS UNSIGNED),
          (
            SELECT latest_tsv.id
            FROM task_schema_versions latest_tsv
            WHERE latest_tsv.task_id = t.id
            ORDER BY latest_tsv.version DESC
            LIMIT 1
          )
        )
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new TaskRecord(
            rs.getLong("id"),
            rs.getString("title"),
            rs.getString("description"),
            rs.getString("status"),
            rs.getLong("owner_id"),
            rs.getString("owner_name"),
            toLong(rs.getObject("dataset_id")),
            toInteger(rs.getObject("quota")),
            rs.getInt("quota_used"),
            rs.getInt("annotated_item_count"),
            rs.getInt("published_item_total"),
            rs.getString("review_status"),
            toInteger(rs.getObject("review_round")),
            toLocalDateTime(rs.getTimestamp("deadline")),
            rs.getString("reward_rule_json"),
            toLocalDateTime(rs.getTimestamp("created_at")),
            toLocalDateTime(rs.getTimestamp("published_at")),
            toLocalDateTime(rs.getTimestamp("deleted_at")),
            toLong(rs.getObject("schema_version_id")),
            toInteger(rs.getObject("schema_version"))),
        args.toArray());
  }

  private List<AssignmentRecord> queryAssignments(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          a.id,
          a.task_id,
          a.item_id,
          a.labeler_id,
          a.status,
          a.locked_until,
          a.claimed_at,
          a.submitted_at,
          a.updated_at,
          tsv.id AS schema_version_id,
          t.title AS task_title,
          u.name AS owner_name,
          t.quota AS task_quota,
          COALESCE(ac.quota_used, 0) AS task_quota_used,
          EXISTS (
            SELECT 1
            FROM drafts d
            WHERE d.assignment_id = a.id
          ) AS has_draft,
          EXISTS (
            SELECT 1
            FROM annotations an
            WHERE an.assignment_id = a.id
              AND an.status <> 'voided'
          ) AS has_submitted_annotation,
          t.created_at AS task_created_at,
          t.deadline AS task_deadline,
          t.published_at AS task_published_at,
          CAST(t.reward_rule AS CHAR) AS reward_rule_json
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN users u ON u.id = t.owner_id
        LEFT JOIN (
          SELECT task_id, COUNT(*) AS quota_used
          FROM assignments
          WHERE status <> 'voided'
          GROUP BY task_id
        ) ac ON ac.task_id = t.id
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
        (rs, rowNum) -> new AssignmentRecord(
            rs.getLong("id"),
            rs.getLong("task_id"),
            rs.getLong("item_id"),
            rs.getLong("labeler_id"),
            rs.getString("status"),
            toLocalDateTime(rs.getTimestamp("locked_until")),
            toLocalDateTime(rs.getTimestamp("claimed_at")),
            toLocalDateTime(rs.getTimestamp("submitted_at")),
            toLocalDateTime(rs.getTimestamp("updated_at")),
            toLong(rs.getObject("schema_version_id")),
            rs.getString("task_title"),
            rs.getString("owner_name"),
            toInteger(rs.getObject("task_quota")),
            rs.getInt("task_quota_used"),
            rs.getBoolean("has_draft"),
            rs.getBoolean("has_submitted_annotation"),
            toLocalDateTime(rs.getTimestamp("task_created_at")),
            toLocalDateTime(rs.getTimestamp("task_deadline")),
            toLocalDateTime(rs.getTimestamp("task_published_at")),
            rs.getString("reward_rule_json")),
        args.toArray());
  }

  private QueryParts buildMarketWhere(
      String keyword,
      String normalizedTaskType,
      String normalizedStrategy,
      String normalizedMediaType,
      String normalizedAiReview) {
    List<String> clauses = new ArrayList<>();
    List<Object> args = new ArrayList<>();
    clauses.add("t.deleted_at IS NULL");
    clauses.add(
        """
        (
          t.status = 'published'
          OR (
            t.status = 'ended'
            AND t.deadline IS NOT NULL
            AND t.deadline <= CURRENT_TIMESTAMP
            AND EXISTS (
              SELECT 1
              FROM audit_logs al
              WHERE al.entity_type = 'task'
                AND al.entity_id = t.id
                AND al.action = 'task.settle_by_deadline'
            )
          )
        )
        """);

    if (keyword != null && !keyword.isBlank()) {
      clauses.add("(t.title LIKE ? OR t.description LIKE ?)");
      String likeKeyword = "%" + keyword.trim() + "%";
      args.add(likeKeyword);
      args.add(likeKeyword);
    }

    if (normalizedTaskType != null && !normalizedTaskType.isBlank()) {
      clauses.add(
          "LOWER(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.taskType')), ' ', '_')) = ?");
      args.add(normalizedTaskType);
    }

    if (normalizedStrategy != null && !normalizedStrategy.isBlank()) {
      clauses.add(
          "COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.strategy')), ''), 'first-come') = ?");
      args.add(normalizedStrategy);
    }

    if (normalizedMediaType != null && !normalizedMediaType.isBlank()) {
      clauses.add(
          """
          EXISTS (
            SELECT 1
            FROM items mi
            WHERE (
              (
                EXISTS (SELECT 1 FROM task_items ti_probe WHERE ti_probe.task_id = t.id)
                AND EXISTS (
                  SELECT 1
                  FROM task_items ti_media
                  WHERE ti_media.task_id = t.id
                    AND ti_media.item_id = mi.id
                )
              )
              OR (
                NOT EXISTS (SELECT 1 FROM task_items ti_probe WHERE ti_probe.task_id = t.id)
                AND mi.task_id = t.id
              )
            )
              AND COALESCE(NULLIF(mi.media_type, ''), 'text') = ?
          )
          """);
      args.add(normalizedMediaType);
    }

    if (normalizedAiReview != null && !normalizedAiReview.isBlank()) {
      clauses.add(
          "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.aiReviewEnabled')), 'true') = ?");
      args.add(normalizedAiReview);
    }

    return new QueryParts("WHERE " + String.join(" AND ", clauses), args);
  }

  private String writeMetadata(TaskMetadata metadata) {
    try {
      return objectMapper.writeValueAsString(metadata);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize task metadata", exception);
    }
  }

  private String writeSchema(String schemaLabel) {
    try {
      var root = objectMapper.createObjectNode();
      root.put("name", schemaLabel == null || schemaLabel.isBlank() ? "任务默认模板" : schemaLabel);
      root.put("description", "任务创建时自动生成的占位模板,可在模板搭建页继续编辑。");
      root.set("fields", objectMapper.createArrayNode());
      return objectMapper.writeValueAsString(root);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize schema snapshot", exception);
    }
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

  private record QueryParts(String whereClause, List<Object> args) {}

  public record TaskAssignmentStateRecord(
      long assignmentId,
      String status,
      long itemId,
      long labelerId) {}

  public record TaskAnnotationStateRecord(
      long annotationId,
      String status,
      long assignmentId) {}

  public record UserAllocationRecord(
      long userId,
      String username,
      String displayName,
      int itemCount) {}

  public record ItemReviewerRecord(
      long itemId,
      long reviewerId) {}

  public static class DuplicateAssignmentException extends RuntimeException {
    private final long taskId;
    private final long itemId;
    private final long labelerId;

    public DuplicateAssignmentException(
        long taskId,
        long itemId,
        long labelerId,
        Throwable cause) {
      super("assignment already exists", cause);
      this.taskId = taskId;
      this.itemId = itemId;
      this.labelerId = labelerId;
    }

    public long taskId() {
      return taskId;
    }

    public long itemId() {
      return itemId;
    }

    public long labelerId() {
      return labelerId;
    }
  }

}
