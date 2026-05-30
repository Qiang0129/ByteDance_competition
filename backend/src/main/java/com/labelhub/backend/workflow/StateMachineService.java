package com.labelhub.backend.workflow;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class StateMachineService {

  private static final Map<WorkflowEntityType, Map<String, Set<String>>> TRANSITIONS = Map.of(
      WorkflowEntityType.TASK, Map.of(
          "draft", Set.of("published", "ended"),
          "published", Set.of("paused", "ended"),
          "paused", Set.of("published", "ended"),
          "ended", Set.of()),
      WorkflowEntityType.ASSIGNMENT, Map.of(
          "claimed", Set.of("submitted", "voided"),
          "submitted", Set.of("returned", "accepted", "voided"),
          "returned", Set.of("submitted", "accepted", "voided"),
          "accepted", Set.of("voided"),
          "voided", Set.of()),
      WorkflowEntityType.ANNOTATION, Map.of(
          "submitted", Set.of("ai_reviewing", "reviewing", "accepted", "voided"),
          "ai_reviewing", Set.of("reviewing", "accepted", "voided"),
          "reviewing", Set.of("reviewing", "returned", "accepted", "submitted", "voided"),
          "returned", Set.of("submitted", "voided"),
          "accepted", Set.of("exported", "voided"),
          "exported", Set.of("voided"),
          "voided", Set.of()),
      WorkflowEntityType.AI_REVIEW_JOB, Map.of(
          "pending", Set.of("running", "failed"),
          "running", Set.of("succeeded", "failed", "pending"),
          "failed", Set.of("pending"),
          "succeeded", Set.of()),
      WorkflowEntityType.EXPORT_JOB, Map.of(
          "pending", Set.of("running", "failed"),
          "running", Set.of("succeeded", "failed"),
          "failed", Set.of(),
          "succeeded", Set.of()));

  private static final Map<WorkflowEntityType, Set<String>> INITIAL_STATES = Map.of(
      WorkflowEntityType.TASK, Set.of("draft", "published"),
      WorkflowEntityType.ASSIGNMENT, Set.of("claimed"),
      WorkflowEntityType.ANNOTATION, Set.of("submitted"),
      WorkflowEntityType.AI_REVIEW_JOB, Set.of("pending"),
      WorkflowEntityType.EXPORT_JOB, Set.of("pending"));

  private final AuditLogRepository auditLogRepository;
  private final ObjectMapper objectMapper;

  public StateMachineService(AuditLogRepository auditLogRepository, ObjectMapper objectMapper) {
    this.auditLogRepository = auditLogRepository;
    this.objectMapper = objectMapper;
  }

  public String normalize(WorkflowEntityType entityType, String state) {
    String normalized = state == null || state.isBlank()
        ? ""
        : state.trim().toLowerCase(Locale.ROOT);
    if (!knownStates(entityType).contains(normalized)) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_STATE",
          "unsupported " + entityType.value() + " state");
    }
    return normalized;
  }

  public void validate(
      WorkflowEntityType entityType,
      String fromState,
      String toState,
      String operatorRole) {
    String from = normalize(entityType, fromState);
    String to = normalize(entityType, toState);
    if (from.equals(to)) {
      return;
    }
    Set<String> allowed = TRANSITIONS.getOrDefault(entityType, Map.of())
        .getOrDefault(from, Set.of());
    if (!allowed.contains(to)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "INVALID_STATE_TRANSITION",
          "cannot transition " + entityType.value() + " from " + from + " to " + to);
    }
    if (!allowedRoles(entityType, from, to).contains(normalizeRole(operatorRole))) {
      throw new ApiException(
          HttpStatus.FORBIDDEN,
          "FORBIDDEN_STATE_TRANSITION",
          "current role cannot perform this state transition");
    }
  }

  public void audit(
      WorkflowEntityType entityType,
      long entityId,
      AuthenticatedUser operator,
      String operatorRole,
      String action,
      String fromState,
      String toState,
      String reason,
      Object before,
      Object after,
      Object snapshot) {
    String role = normalizeRole(operatorRole);
    if (fromState != null && toState != null) {
      validate(entityType, fromState, toState, role);
    }
    auditLogRepository.insert(
        entityType,
        entityId,
        operator == null ? null : operator.id(),
        role,
        action,
        normalizeNullable(entityType, fromState),
        normalizeNullable(entityType, toState),
        blankToNull(reason),
        writeNullableJson(before),
        writeNullableJson(after),
        writeSnapshot(entityType, entityId, action, role, reason, snapshot));
  }

  public void auditCreation(
      WorkflowEntityType entityType,
      long entityId,
      AuthenticatedUser operator,
      String operatorRole,
      String action,
      String toState,
      String reason,
      Object after,
      Object snapshot) {
    String to = normalize(entityType, toState);
    if (!INITIAL_STATES.getOrDefault(entityType, Set.of()).contains(to)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "INVALID_INITIAL_STATE",
          "invalid initial " + entityType.value() + " state");
    }
    auditLogRepository.insert(
        entityType,
        entityId,
        operator == null ? null : operator.id(),
        normalizeRole(operatorRole),
        action,
        null,
        to,
        blankToNull(reason),
        null,
        writeNullableJson(after),
        writeSnapshot(entityType, entityId, action, normalizeRole(operatorRole), reason, snapshot));
  }

  private Set<String> knownStates(WorkflowEntityType entityType) {
    return TRANSITIONS.getOrDefault(entityType, Map.of()).keySet();
  }

  private Set<String> allowedRoles(WorkflowEntityType entityType, String from, String to) {
    if (entityType == WorkflowEntityType.TASK || entityType == WorkflowEntityType.EXPORT_JOB) {
      return Set.of("owner");
    }
    if (entityType == WorkflowEntityType.AI_REVIEW_JOB) {
      return Set.of("system_agent", "ai_reviewer", "reviewer", "owner");
    }
    if (entityType == WorkflowEntityType.ASSIGNMENT) {
      if ("voided".equals(to)) {
        return Set.of("owner");
      }
      if ("claimed".equals(from) && "submitted".equals(to)) {
        return Set.of("labeler");
      }
      if ("returned".equals(from) && "submitted".equals(to)) {
        return Set.of("labeler");
      }
      return Set.of("reviewer", "owner");
    }
    if (entityType == WorkflowEntityType.ANNOTATION) {
      if ("voided".equals(to)) {
        return Set.of("owner");
      }
      if (List.of("submitted", "returned", "reviewing").contains(from)
          && ("submitted".equals(to) || "ai_reviewing".equals(to))) {
        return Set.of("labeler", "system_agent");
      }
      if ("submitted".equals(from) && "reviewing".equals(to)) {
        return Set.of("system_agent", "reviewer", "owner");
      }
      if ("ai_reviewing".equals(from) && List.of("reviewing", "accepted").contains(to)) {
        return Set.of("system_agent", "ai_reviewer", "reviewer", "owner");
      }
      if ("accepted".equals(from) && "exported".equals(to)) {
        return Set.of("owner");
      }
      return Set.of("reviewer", "owner");
    }
    return Set.of();
  }

  private String normalizeRole(String role) {
    return role == null || role.isBlank()
        ? "system_agent"
        : role.trim().toLowerCase(Locale.ROOT);
  }

  private String normalizeNullable(WorkflowEntityType entityType, String state) {
    return state == null || state.isBlank() ? null : normalize(entityType, state);
  }

  private String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private String writeSnapshot(
      WorkflowEntityType entityType,
      long entityId,
      String action,
      String operatorRole,
      String reason,
      Object snapshot) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("entityType", entityType.value());
    root.put("entityId", entityId);
    root.put("action", action);
    root.put("operatorRole", operatorRole);
    if (reason != null && !reason.isBlank()) {
      root.put("reason", reason.trim());
    }
    if (snapshot != null) {
      root.set("snapshot", objectMapper.valueToTree(snapshot));
    }
    return writeJson(root);
  }

  private String writeNullableJson(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof String text) {
      return text.isBlank() ? null : text;
    }
    if (value instanceof JsonNode node) {
      return writeJson(node);
    }
    return writeJson(objectMapper.valueToTree(value));
  }

  private String writeJson(JsonNode node) {
    try {
      return objectMapper.writeValueAsString(node);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize audit json", exception);
    }
  }
}
