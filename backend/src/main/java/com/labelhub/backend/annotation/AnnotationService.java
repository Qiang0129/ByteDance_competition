package com.labelhub.backend.annotation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.annotation.AnnotationRepository.AssignmentItemRecord;
import com.labelhub.backend.annotation.AnnotationRepository.AnnotationRecord;
import com.labelhub.backend.annotation.AnnotationRepository.DraftRecord;
import com.labelhub.backend.annotation.AnnotationRepository.SchemaSnapshotRecord;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.TaskService;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnnotationService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final AnnotationRepository annotationRepository;
  private final TaskService taskService;
  private final ObjectMapper objectMapper;

  public AnnotationService(
      AnnotationRepository annotationRepository,
      TaskService taskService,
      ObjectMapper objectMapper) {
    this.annotationRepository = annotationRepository;
    this.taskService = taskService;
    this.objectMapper = objectMapper;
  }

  public AssignmentItemResponse getAssignmentItem(Authentication authentication, long assignmentId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    taskService.backfillAssignmentsForLabelerTask(labeler.id(), assignment.taskId());
    assignment = loadAssignment(labeler.id(), assignmentId);
    SchemaContext schema = resolvePublishedSchema(assignment);
    DraftResponse draft = annotationRepository.findDraft(assignment.assignmentId())
        .map(this::toDraftResponse)
        .orElse(null);
    String returnReason = annotationRepository.findLatestReturnReason(assignment.assignmentId())
        .orElse(null);
    AnnotationResponse latestAnnotation = annotationRepository.findLatestAnnotation(assignment.assignmentId())
        .map(record -> toAnnotationResponse(record, returnReason))
        .orElse(null);
    return new AssignmentItemResponse(
        Long.toString(assignment.assignmentId()),
        Long.toString(assignment.taskId()),
        assignment.taskTitle(),
        Long.toString(assignment.itemId()),
        assignment.assignmentStatus(),
        isEditableAssignment(assignment),
        formatDateTime(assignment.taskDeadline()),
        Long.toString(schema.id()),
        buildRawPayload(assignment),
        schema.fields(),
        resolvePosition(assignment),
        returnReason,
        draft,
        latestAnnotation);
  }

  public DraftResponse getDraft(Authentication authentication, long assignmentId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    loadAssignment(labeler.id(), assignmentId);
    return annotationRepository.findDraft(assignmentId)
        .map(this::toDraftResponse)
        .orElse(null);
  }

  public DraftResponse saveDraft(
      Authentication authentication,
      long assignmentId,
      DraftRequest request) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureEditableAssignment(assignment);
    JsonNode answerJson = requireAnswerObject(request == null ? null : request.answerJson());
    DraftRecord saved = annotationRepository.upsertDraft(
        assignment.assignmentId(),
        writeJson(answerJson));
    return toDraftResponse(saved);
  }

  @Transactional
  public AnnotationResponse submit(
      Authentication authentication,
      long assignmentId,
      SubmitAnnotationRequest request) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    AssignmentItemRecord assignment = annotationRepository
        .lockAssignmentForLabeler(assignmentId, labeler.id())
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "ASSIGNMENT_NOT_FOUND",
            "assignment not found"));
    ensureEditableAssignment(assignment);
    ensurePublishedTask(assignment);
    SchemaContext schema = resolvePublishedSchema(assignment);
    long requestedSchemaId = parseSchemaVersionId(request == null ? null : request.schemaVersionId());
    if (requestedSchemaId != schema.id()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_VERSION_MISMATCH",
          "schema version does not match assignment");
    }
    JsonNode answerJson = requireAnswerObject(request.answerJson());
    validateAnswer(answerJson, schema.fields());

    int revisionNo = annotationRepository.nextRevisionNo(assignment.assignmentId());
    long annotationId = annotationRepository.createAnnotation(
        assignment.assignmentId(),
        schema.id(),
        writeJson(answerJson),
        revisionNo);
    annotationRepository.markSubmitted(assignment.assignmentId(), assignment.itemId());
    annotationRepository.deleteDraft(assignment.assignmentId());
    annotationRepository.createAiReviewJob(annotationId, schema.id());

    return new AnnotationResponse(
        Long.toString(annotationId),
        Long.toString(assignment.assignmentId()),
        Long.toString(schema.id()),
        answerJson,
        "SUBMITTED",
        revisionNo,
        null);
  }

  private AssignmentItemRecord loadAssignment(long labelerId, long assignmentId) {
    return annotationRepository.findAssignmentForLabeler(assignmentId, labelerId)
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "ASSIGNMENT_NOT_FOUND",
            "assignment not found"));
  }

  private void ensureEditableAssignment(AssignmentItemRecord assignment) {
    if (isEditableAssignment(assignment)) {
      return;
    }
    String status = assignment.assignmentStatus() == null
        ? ""
        : assignment.assignmentStatus().toLowerCase(Locale.ROOT);
    if (!List.of("claimed", "returned", "submitted").contains(status)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "ASSIGNMENT_NOT_EDITABLE",
          "assignment is not editable");
    }
    throw new ApiException(HttpStatus.CONFLICT, "TASK_EXPIRED", "task deadline has passed");
  }

  private boolean isEditableAssignment(AssignmentItemRecord assignment) {
    String status = assignment.assignmentStatus() == null
        ? ""
        : assignment.assignmentStatus().toLowerCase(Locale.ROOT);
    return List.of("claimed", "returned", "submitted").contains(status)
        && !isDeadlineExpired(assignment.taskDeadline());
  }

  private boolean isDeadlineExpired(LocalDateTime deadline) {
    return deadline != null && deadline.isBefore(LocalDateTime.now());
  }

  private void ensurePublishedTask(AssignmentItemRecord assignment) {
    String taskStatus = assignment.taskStatus() == null
        ? ""
        : assignment.taskStatus().toLowerCase(Locale.ROOT);
    if (!"published".equals(taskStatus)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "TASK_NOT_PUBLISHED",
          "task is not published");
    }
  }

  private SchemaContext resolvePublishedSchema(AssignmentItemRecord assignment) {
    Long metadataSchemaId = readMetadataSchemaVersionId(assignment.rewardRuleJson());
    SchemaSnapshotRecord schema;
    if (metadataSchemaId != null) {
      schema = annotationRepository.findSchema(metadataSchemaId)
          .orElseThrow(() -> new ApiException(
              HttpStatus.NOT_FOUND,
              "SCHEMA_NOT_FOUND",
              "schema not found"));
    } else if (assignment.fallbackSchemaVersionId() != null) {
      schema = new SchemaSnapshotRecord(
          assignment.fallbackSchemaVersionId(),
          assignment.fallbackSchemaVersion() == null ? 1 : assignment.fallbackSchemaVersion(),
          assignment.fallbackSchemaJson(),
          assignment.fallbackSchemaStatus());
    } else {
      throw new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found");
    }

    if (!"published".equals(schema.status())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_NOT_PUBLISHED",
          "schema is not published");
    }
    JsonNode root = readJson(schema.schemaJson());
    JsonNode fields = root.path("fields");
    ArrayNode fieldArray = fields.isArray()
        ? fields.deepCopy()
        : objectMapper.createArrayNode();
    return new SchemaContext(schema.id(), fieldArray);
  }

  private Long readMetadataSchemaVersionId(String rewardRuleJson) {
    if (rewardRuleJson == null || rewardRuleJson.isBlank()) {
      return null;
    }
    JsonNode root = readJson(rewardRuleJson);
    JsonNode value = root.path("schemaVersionId");
    if (value.isMissingNode() || value.isNull()) {
      return null;
    }
    if (value.isNumber()) {
      return value.longValue();
    }
    if (value.isTextual() && !value.asText().isBlank()) {
      try {
        return Long.parseLong(value.asText());
      } catch (NumberFormatException exception) {
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "INVALID_SCHEMA_VERSION_ID",
            "schema version id format is invalid");
      }
    }
    return null;
  }

  private ObjectNode buildRawPayload(AssignmentItemRecord assignment) {
    JsonNode parsed = readJson(assignment.rawPayloadJson());
    ObjectNode raw;
    if (parsed.isObject()) {
      raw = (ObjectNode) parsed.deepCopy();
    } else {
      raw = objectMapper.createObjectNode();
      raw.set("value", parsed);
    }
    raw.put("media_type", blankToDefault(assignment.mediaType(), text(raw, "media_type", "text")));
    putIfPresent(raw, "media_url", assignment.mediaUrl());
    putIfPresent(raw, "content_markdown", assignment.contentMarkdown());
    return raw;
  }

  private AssignmentPositionResponse resolvePosition(AssignmentItemRecord assignment) {
    List<Long> ids = annotationRepository.listAssignmentIdsForPosition(
        assignment.taskId(),
        assignment.labelerId());
    int zeroBased = ids.indexOf(assignment.assignmentId());
    if (zeroBased < 0) {
      return new AssignmentPositionResponse(1, 1, null, null);
    }
    String prev = zeroBased > 0 ? Long.toString(ids.get(zeroBased - 1)) : null;
    String next = zeroBased + 1 < ids.size() ? Long.toString(ids.get(zeroBased + 1)) : null;
    return new AssignmentPositionResponse(zeroBased + 1, ids.size(), prev, next);
  }

  private DraftResponse toDraftResponse(DraftRecord record) {
    return new DraftResponse(
        Long.toString(record.assignmentId()),
        readJson(record.answerJson()),
        formatDateTime(record.updatedAt()));
  }

  private AnnotationResponse toAnnotationResponse(AnnotationRecord record, String returnReason) {
    return new AnnotationResponse(
        Long.toString(record.id()),
        Long.toString(record.assignmentId()),
        Long.toString(record.schemaVersionId()),
        readJson(record.answerJson()),
        normalizeAnnotationStatus(record.status()),
        record.revisionNo(),
        returnReason);
  }

  private String normalizeAnnotationStatus(String status) {
    return status == null || status.isBlank()
        ? "SUBMITTED"
        : status.toUpperCase(Locale.ROOT);
  }

  private JsonNode requireAnswerObject(JsonNode answerJson) {
    if (answerJson == null || !answerJson.isObject()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_ANSWER_JSON",
          "answerJson must be an object");
    }
    return answerJson;
  }

  private void validateAnswer(JsonNode answerJson, ArrayNode fields) {
    for (JsonNode field : fields) {
      String kind = text(field, "kind", "");
      if ("show-item".equals(kind)) {
        continue;
      }
      String fieldName = text(field, "fieldName", "");
      if (fieldName.isBlank()) {
        continue;
      }
      JsonNode value = answerJson.get(fieldName);
      String label = text(field, "label", fieldName);
      if (field.path("required").asBoolean(false) && isEmptyAnswer(value)) {
        throwAnswerValidation(label + " is required");
      }
      int maxLength = field.path("maxLength").asInt(0);
      if (maxLength > 0 && value != null && value.isTextual() && value.asText().length() > maxLength) {
        throwAnswerValidation(label + " exceeds max length " + maxLength);
      }
      if ("json-editor".equals(kind) && value != null && value.isTextual() && !value.asText().isBlank()) {
        try {
          objectMapper.readTree(value.asText());
        } catch (JsonProcessingException exception) {
          throwAnswerValidation(label + " is not valid JSON");
        }
      }
    }
  }

  private boolean isEmptyAnswer(JsonNode value) {
    return value == null
        || value.isNull()
        || (value.isTextual() && value.asText().isBlank())
        || (value.isArray() && value.isEmpty());
  }

  private void throwAnswerValidation(String message) {
    throw new ApiException(HttpStatus.BAD_REQUEST, "ANSWER_VALIDATION_FAILED", message);
  }

  private long parseSchemaVersionId(String value) {
    if (value == null || value.isBlank()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_SCHEMA_VERSION_ID",
          "schemaVersionId is required");
    }
    try {
      return Long.parseLong(value);
    } catch (NumberFormatException exception) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_SCHEMA_VERSION_ID",
          "schema version id format is invalid");
    }
  }

  private JsonNode readJson(String json) {
    if (json == null || json.isBlank()) {
      return objectMapper.createObjectNode();
    }
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

  private String text(JsonNode node, String field, String fallback) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return fallback;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private void putIfPresent(ObjectNode node, String field, String value) {
    if (value != null && !value.isBlank()) {
      node.put(field, value);
    }
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private AuthenticatedUser requireLabeler(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("labeler")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "labeler role is required");
    }
    return principal;
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    return principal;
  }

  private record SchemaContext(long id, ArrayNode fields) {}
}
