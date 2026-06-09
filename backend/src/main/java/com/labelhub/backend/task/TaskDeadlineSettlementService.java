package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.labelhub.backend.ai.AiReviewRepository;
import com.labelhub.backend.ai.AiReviewService;
import com.labelhub.backend.annotation.AnnotationRepository;
import com.labelhub.backend.annotation.AnnotationRepository.AssignmentItemRecord;
import com.labelhub.backend.annotation.AnnotationRepository.DraftRecord;
import com.labelhub.backend.annotation.AnnotationRepository.SchemaSnapshotRecord;
import com.labelhub.backend.annotation.AnswerValidationService;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.schema.SchemaFieldTree;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TaskDeadlineSettlementService {

  private final TaskRepository taskRepository;
  private final AnnotationRepository annotationRepository;
  private final AiReviewService aiReviewService;
  private final AnswerValidationService answerValidationService;
  private final StateMachineService stateMachineService;
  private final TransactionTemplate transactionTemplate;
  private final ObjectMapper objectMapper;

  public TaskDeadlineSettlementService(
      TaskRepository taskRepository,
      AnnotationRepository annotationRepository,
      AiReviewService aiReviewService,
      AnswerValidationService answerValidationService,
      StateMachineService stateMachineService,
      TransactionTemplate transactionTemplate,
      ObjectMapper objectMapper) {
    this.taskRepository = taskRepository;
    this.annotationRepository = annotationRepository;
    this.aiReviewService = aiReviewService;
    this.answerValidationService = answerValidationService;
    this.stateMachineService = stateMachineService;
    this.transactionTemplate = transactionTemplate;
    this.objectMapper = objectMapper;
  }

  @Scheduled(fixedDelay = 60_000L, initialDelay = 15_000L)
  public void settleExpiredTasksOnSchedule() {
    settleExpiredTasks();
  }

  public void settleExpiredTasks() {
    LocalDateTime now = LocalDateTime.now();
    List<TaskRecord> tasks = taskRepository.listTasksToSettle(now);
    for (TaskRecord task : tasks) {
      transactionTemplate.executeWithoutResult(status -> settleTaskInTransaction(task.id()));
    }
  }

  @Transactional
  public void settleTask(long taskId) {
    settleTaskInTransaction(taskId);
  }

  private void settleTaskInTransaction(long taskId) {
    TaskRecord task = taskRepository.findTask(taskId).orElse(null);
    if (task == null
        || task.deletedAt() != null
        || task.deadline() == null
        || task.deadline().isAfter(LocalDateTime.now())
        || !List.of("published", "paused").contains(normalize(task.status()))) {
      return;
    }

    List<AssignmentItemRecord> assignments = annotationRepository.lockUnfinishedTaskAssignments(taskId);
    int autoSubmitted = 0;
    int released = 0;
    int protectedReworks = 0;
    for (AssignmentItemRecord assignment : assignments) {
      if (isReturnedAssignment(assignment)) {
        protectedReworks += 1;
        continue;
      }
      DraftRecord draft = annotationRepository.findDraft(assignment.assignmentId()).orElse(null);
      if (draft == null) {
        releaseAssignment(assignment, "no draft at task deadline");
        released += 1;
        continue;
      }
      try {
        autoSubmitDraft(assignment, draft);
        autoSubmitted += 1;
      } catch (ApiException exception) {
        if (!answerValidationService.isValidationError(exception)) {
          throw exception;
        }
        releaseAssignment(assignment, "draft validation failed: " + exception.getMessage());
        released += 1;
      }
    }

    String beforeStatus = task.status();
    taskRepository.updateTaskStateSystem(taskId, "ended");
    taskRepository.updateLatestSchemaState(taskId, "ended");
    stateMachineService.audit(
        WorkflowEntityType.TASK,
        taskId,
        null,
        "system_agent",
        "task.settle_by_deadline",
        beforeStatus,
        "ended",
        "task deadline reached",
        Map.of("taskId", taskId, "status", beforeStatus),
        Map.of("taskId", taskId, "status", "ended"),
        Map.of(
            "deadline", task.deadline(),
            "autoSubmitted", autoSubmitted,
            "released", released,
            "protectedReworks", protectedReworks));
  }

  private void autoSubmitDraft(AssignmentItemRecord assignment, DraftRecord draft) {
    SchemaContext schema = resolveSchema(assignment);
    JsonNode answerJson = answerValidationService.requireAnswerObject(readJson(draft.answerJson()));
    JsonNode visibleAnswerJson = answerValidationService.filterVisibleAnswer(answerJson, schema.fields());
    answerValidationService.validateAnswer(visibleAnswerJson, schema.fields());

    String assignmentBeforeStatus = assignment.assignmentStatus();
    int revisionNo = annotationRepository.nextRevisionNo(assignment.assignmentId());
    boolean resubmit = revisionNo > 1 || "returned".equalsIgnoreCase(assignmentBeforeStatus);
    long annotationId = annotationRepository.createAnnotation(
        assignment.assignmentId(),
        schema.id(),
        schema.schemaJson(),
        writeJson(visibleAnswerJson),
        revisionNo,
        "submitted");
    annotationRepository.markSubmitted(assignment.assignmentId(), assignment.itemId());
    annotationRepository.deleteDraft(assignment.assignmentId());
    Long aiReviewJobId = enqueueAiReviewIfEnabled(assignment, annotationId, schema);

    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        assignment.assignmentId(),
        null,
        "system_agent",
        "annotation.auto_submit_by_deadline",
        assignmentBeforeStatus,
        "submitted",
        "valid draft auto submitted at task deadline",
        Map.of("assignmentId", assignment.assignmentId(), "status", assignmentBeforeStatus),
        Map.of("assignmentId", assignment.assignmentId(), "status", "submitted"),
        Map.of(
            "taskId", assignment.taskId(),
            "itemId", assignment.itemId(),
            "annotationId", annotationId,
            "schemaVersionId", schema.id(),
            "revisionNo", revisionNo,
            "resubmit", resubmit));
    stateMachineService.auditCreation(
        WorkflowEntityType.ANNOTATION,
        annotationId,
        null,
        "system_agent",
        "annotation.auto_submit_by_deadline",
        "submitted",
        "valid draft auto submitted at task deadline",
        Map.of(
            "annotationId", annotationId,
            "assignmentId", assignment.assignmentId(),
            "schemaVersionId", schema.id(),
            "revisionNo", revisionNo,
            "answerJson", visibleAnswerJson),
        null);
    auditReviewStart(annotationId, schema.id(), aiReviewJobId);
  }

  private void releaseAssignment(AssignmentItemRecord assignment, String reason) {
    String beforeStatus = assignment.assignmentStatus();
    annotationRepository.deleteDraft(assignment.assignmentId());
    annotationRepository.releaseAssignment(assignment.assignmentId(), assignment.itemId());
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        assignment.assignmentId(),
        null,
        "system_agent",
        "assignment.release_by_deadline",
        beforeStatus,
        "voided",
        reason,
        Map.of(
            "assignmentId", assignment.assignmentId(),
            "taskId", assignment.taskId(),
            "itemId", assignment.itemId(),
            "status", beforeStatus),
        Map.of(
            "assignmentId", assignment.assignmentId(),
            "taskId", assignment.taskId(),
            "itemId", assignment.itemId(),
            "status", "voided",
            "itemStatus", "pending"),
        null);
  }

  private boolean isReturnedAssignment(AssignmentItemRecord assignment) {
    return "returned".equals(normalize(assignment.assignmentStatus()));
  }

  private Long enqueueAiReviewIfEnabled(
      AssignmentItemRecord assignment,
      long annotationId,
      SchemaContext schema) {
    if (!readMetadataAiReviewEnabled(assignment.rewardRuleJson())) {
      annotationRepository.updateAnnotationStatus(annotationId, "reviewing");
      return null;
    }
    Long ruleId = readMetadataAiReviewRuleId(assignment.rewardRuleJson());
    AiReviewRepository.AiReviewRuleRecord rule =
        aiReviewService.resolveEnabledRule(ruleId, assignment.taskId());
    String ruleSnapshot = aiReviewService.writeRuleSnapshot(rule);
    long aiReviewJobId = annotationRepository.createAiReviewJob(
        annotationId,
        schema.id(),
        rule.id(),
        ruleSnapshot);
    annotationRepository.updateAnnotationStatus(annotationId, "ai_reviewing");
    return aiReviewJobId;
  }

  private void auditReviewStart(long annotationId, long schemaVersionId, Long aiReviewJobId) {
    if (aiReviewJobId == null) {
      stateMachineService.audit(
          WorkflowEntityType.ANNOTATION,
          annotationId,
          null,
          "system_agent",
          "annotation.submit",
          "submitted",
          "reviewing",
          "ai review disabled, send to human review",
          Map.of("annotationId", annotationId, "status", "submitted"),
          Map.of("annotationId", annotationId, "status", "reviewing"),
          null);
      return;
    }
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        annotationId,
        null,
        "system_agent",
        "ai_review.start",
        "submitted",
        "ai_reviewing",
        "ai review job queued",
        Map.of("annotationId", annotationId, "status", "submitted"),
        Map.of("annotationId", annotationId, "status", "ai_reviewing"),
        null);
    stateMachineService.auditCreation(
        WorkflowEntityType.AI_REVIEW_JOB,
        aiReviewJobId,
        null,
        "system_agent",
        "ai_review.start",
        "pending",
        "ai review job created",
        Map.of("annotationId", annotationId, "schemaVersionId", schemaVersionId),
        null);
  }

  private SchemaContext resolveSchema(AssignmentItemRecord assignment) {
    Long schemaId = readMetadataSchemaVersionId(assignment.rewardRuleJson());
    SchemaSnapshotRecord schema;
    if (schemaId == null) {
      if (assignment.fallbackSchemaVersionId() == null || assignment.fallbackSchemaJson() == null) {
        throw new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found");
      }
      schema = new SchemaSnapshotRecord(
          assignment.fallbackSchemaVersionId(),
          assignment.fallbackSchemaVersion() == null ? 1 : assignment.fallbackSchemaVersion(),
          assignment.fallbackSchemaJson(),
          assignment.fallbackSchemaStatus(),
          assignment.fallbackSchemaDeletedAt());
    } else {
      schema = annotationRepository.findSchema(schemaId)
          .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
    }
    if (!"published".equals(normalize(schema.status())) && schema.deletedAt() == null) {
      throw new ApiException(HttpStatus.CONFLICT, "SCHEMA_WITHDRAWN", "task schema has been withdrawn");
    }
    ArrayNode fields = normalizeRuntimeFields(readJson(schema.schemaJson()).path("fields"));
    return new SchemaContext(schema.id(), schema.schemaJson(), fields);
  }

  private ArrayNode normalizeRuntimeFields(JsonNode fields) {
    if (!fields.isArray()) {
      return objectMapper.createArrayNode();
    }
    return SchemaFieldTree.flattenFields(objectMapper, fields);
  }

  private Long readMetadataSchemaVersionId(String rewardRuleJson) {
    JsonNode root = readJsonOrNull(rewardRuleJson);
    if (root == null) {
      return null;
    }
    JsonNode value = root.path("schemaVersionId");
    if (value.isMissingNode() || value.isNull()) {
      return null;
    }
    if (value.isNumber()) {
      return value.longValue();
    }
    String text = value.asText("");
    if (text.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(text);
    } catch (NumberFormatException exception) {
      return null;
    }
  }

  private boolean readMetadataAiReviewEnabled(String rewardRuleJson) {
    JsonNode root = readJsonOrNull(rewardRuleJson);
    if (root == null) {
      return true;
    }
    JsonNode value = root.path("aiReviewEnabled");
    return value.isMissingNode() || value.isNull() || value.asBoolean(true);
  }

  private Long readMetadataAiReviewRuleId(String rewardRuleJson) {
    JsonNode root = readJsonOrNull(rewardRuleJson);
    if (root == null) {
      return null;
    }
    JsonNode value = root.path("aiReviewRuleId");
    if (value.isMissingNode() || value.isNull()) {
      return null;
    }
    if (value.isNumber()) {
      return value.longValue();
    }
    String text = value.asText("");
    if (text.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(text);
    } catch (NumberFormatException exception) {
      return null;
    }
  }

  private JsonNode readJsonOrNull(String json) {
    if (json == null || json.isBlank()) {
      return null;
    }
    return readJson(json);
  }

  private JsonNode readJson(String json) {
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "stored json is invalid");
    }
  }

  private String writeJson(JsonNode node) {
    try {
      return objectMapper.writeValueAsString(node);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "json cannot be serialized");
    }
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase();
  }

  private record SchemaContext(long id, String schemaJson, ArrayNode fields) {}
}
