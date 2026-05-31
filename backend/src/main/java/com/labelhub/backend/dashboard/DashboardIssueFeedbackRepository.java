package com.labelhub.backend.dashboard;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DashboardIssueFeedbackRepository {

  private final JdbcTemplate jdbcTemplate;

  public DashboardIssueFeedbackRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countIssueFeedback(long ownerId, String status) {
    List<Object> args = new ArrayList<>();
    args.add(ownerId);
    String sql = """
        SELECT COUNT(*)
        FROM issues iss
        JOIN tasks t ON t.id = iss.task_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
        """ + statusFilter(status, args);
    Long count = jdbcTemplate.queryForObject(sql, Long.class, args.toArray());
    return count == null ? 0 : count;
  }

  public List<IssueFeedbackRecord> listIssueFeedback(
      long ownerId,
      String status,
      int limit,
      int offset) {
    List<Object> args = new ArrayList<>();
    args.add(ownerId);
    String sql = """
        SELECT
          iss.id AS issue_id,
          iss.assignment_id,
          iss.task_id,
          t.title AS task_title,
          iss.item_id,
          iss.labeler_id,
          u.name AS labeler_name,
          iss.category,
          iss.description,
          iss.status,
          iss.created_at
        FROM issues iss
        JOIN tasks t ON t.id = iss.task_id
        JOIN users u ON u.id = iss.labeler_id
        WHERE t.owner_id = ?
          AND t.deleted_at IS NULL
        """ + statusFilter(status, args) + """
        ORDER BY iss.created_at DESC, iss.id DESC
        LIMIT ? OFFSET ?
        """;
    args.add(limit);
    args.add(offset);
    return jdbcTemplate.query(sql, (rs, rowNum) -> new IssueFeedbackRecord(
        rs.getLong("issue_id"),
        rs.getLong("assignment_id"),
        rs.getLong("task_id"),
        rs.getString("task_title"),
        rs.getLong("item_id"),
        rs.getLong("labeler_id"),
        rs.getString("labeler_name"),
        rs.getString("category"),
        rs.getString("description"),
        rs.getString("status"),
        toLocalDateTime(rs.getTimestamp("created_at"))), args.toArray());
  }

  private String statusFilter(String status, List<Object> args) {
    if (status == null || status.isBlank() || "all".equals(status)) {
      return "";
    }
    args.add(status);
    return " AND iss.status = ?";
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  public record IssueFeedbackRecord(
      long issueId,
      long assignmentId,
      long taskId,
      String taskTitle,
      long itemId,
      long labelerId,
      String labelerName,
      String category,
      String description,
      String status,
      LocalDateTime createdAt) {}
}
