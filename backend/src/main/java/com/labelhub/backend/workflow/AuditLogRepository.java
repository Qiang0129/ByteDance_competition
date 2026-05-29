package com.labelhub.backend.workflow;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AuditLogRepository {

  private final JdbcTemplate jdbcTemplate;

  public AuditLogRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public void insert(
      WorkflowEntityType entityType,
      long entityId,
      Long operatorId,
      String operatorRole,
      String action,
      String fromState,
      String toState,
      String reason,
      String beforeJson,
      String afterJson,
      String snapshotJson) {
    jdbcTemplate.update(
        """
        INSERT INTO audit_logs
          (entity_type, entity_id, operator_id, operator_role, action,
           from_state, to_state, reason, before_json, after_json, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        entityType.value(),
        entityId,
        operatorId,
        operatorRole,
        action,
        fromState,
        toState,
        reason,
        beforeJson,
        afterJson,
        snapshotJson);
  }
}
