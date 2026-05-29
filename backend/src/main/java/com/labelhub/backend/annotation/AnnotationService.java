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
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AnnotationService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final AnnotationRepository annotationRepository;
  private final TaskService taskService;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public AnnotationService(
      AnnotationRepository annotationRepository,
      TaskService taskService,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.annotationRepository = annotationRepository;
    this.taskService = taskService;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  public AssignmentItemResponse getAssignmentItem(Authentication authentication, long assignmentId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureAssignmentUsable(assignment);
    try {
      taskService.backfillAssignmentsForLabelerTask(labeler.id(), assignment.taskId());
    } catch (ApiException exception) {
      if (!"SCHEMA_WITHDRAWN".equals(exception.getCode())) {
        throw exception;
      }
    }
    assignment = loadAssignment(labeler.id(), assignmentId);
    ensureAssignmentUsable(assignment);
    SchemaContext schema = resolveSchema(assignment, false);
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
        schema.runtimeUsable() && isEditableAssignment(assignment),
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
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureAssignmentUsable(assignment);
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
    resolveSchema(assignment, true);
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
    SchemaContext schema = resolveSchema(assignment, true);
    long requestedSchemaId = parseSchemaVersionId(request == null ? null : request.schemaVersionId());
    if (requestedSchemaId != schema.id()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_VERSION_MISMATCH",
          "schema version does not match assignment");
    }
    JsonNode answerJson = requireAnswerObject(request.answerJson());
    validateAnswer(answerJson, schema.fields());

    String assignmentBeforeStatus = assignment.assignmentStatus();
    int revisionNo = annotationRepository.nextRevisionNo(assignment.assignmentId());
    boolean resubmit = revisionNo > 1 || "returned".equalsIgnoreCase(assignmentBeforeStatus);
    long annotationId = annotationRepository.createAnnotation(
        assignment.assignmentId(),
        schema.id(),
        writeJson(answerJson),
        revisionNo,
        "submitted");
    annotationRepository.markSubmitted(assignment.assignmentId(), assignment.itemId());
    annotationRepository.deleteDraft(assignment.assignmentId());
    long aiReviewJobId = annotationRepository.createAiReviewJob(annotationId, schema.id());
    annotationRepository.updateAnnotationStatus(annotationId, "ai_reviewing");
    auditSubmit(
        labeler,
        assignment,
        assignmentBeforeStatus,
        annotationId,
        aiReviewJobId,
        schema.id(),
        answerJson,
        revisionNo,
        resubmit);

    return new AnnotationResponse(
        Long.toString(annotationId),
        Long.toString(assignment.assignmentId()),
        Long.toString(schema.id()),
        answerJson,
        "AI_REVIEWING",
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

  private void ensureAssignmentUsable(AssignmentItemRecord assignment) {
    if (assignment.taskDeletedAt() != null) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_DELETED", "task has been deleted");
    }
    String status = assignment.assignmentStatus() == null
        ? ""
        : assignment.assignmentStatus().toLowerCase(Locale.ROOT);
    if ("voided".equals(status)) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_VOIDED", "assignment has been voided");
    }
  }

  private void ensureEditableAssignment(AssignmentItemRecord assignment) {
    ensureAssignmentUsable(assignment);
    String taskStatus = assignment.taskStatus() == null
        ? ""
        : assignment.taskStatus().toLowerCase(Locale.ROOT);
    if (!"published".equals(taskStatus)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "TASK_NOT_PUBLISHED",
          "task is not published");
    }
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
    if (assignment.taskDeletedAt() != null) {
      return false;
    }
    String taskStatus = assignment.taskStatus() == null
        ? ""
        : assignment.taskStatus().toLowerCase(Locale.ROOT);
    if (!"published".equals(taskStatus)) {
      return false;
    }
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
    ensureAssignmentUsable(assignment);
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

  private SchemaContext resolveSchema(AssignmentItemRecord assignment, boolean requirePublished) {
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
          assignment.fallbackSchemaStatus(),
          assignment.fallbackSchemaDeletedAt());
    } else {
      throw new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found");
    }

    boolean runtimeUsable = "published".equals(schema.status()) || schema.deletedAt() != null;
    if (requirePublished && !runtimeUsable) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_WITHDRAWN",
          "schema has been withdrawn");
    }
    JsonNode root = readJson(schema.schemaJson());
    JsonNode fields = root.path("fields");
    ArrayNode fieldArray = fields.isArray()
        ? fields.deepCopy()
        : objectMapper.createArrayNode();
    return new SchemaContext(schema.id(), fieldArray, runtimeUsable);
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
    Set<String> hiddenFields = resolveHiddenFields(fields, answerJson);
    Set<String> conditionalRequiredFields = resolveConditionalRequiredFields(fields, answerJson);
    for (JsonNode field : fields) {
      String kind = text(field, "kind", "");
      if ("show-item".equals(kind)) {
        continue;
      }
      String fieldName = text(field, "fieldName", "");
      if (fieldName.isBlank()) {
        continue;
      }
      if (hiddenFields.contains(fieldName)) {
        continue;
      }
      JsonNode value = answerJson.get(fieldName);
      String label = text(field, "label", fieldName);
      boolean required = field.path("required").asBoolean(false)
          || conditionalRequiredFields.contains(fieldName);
      if (required && isEmptyAnswer(value)) {
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
      validateChoiceValue(kind, field, value, label);
      validateStructuredValidators(field, value, label);
    }
  }

  private void validateChoiceValue(String kind, JsonNode field, JsonNode value, String label) {
    if (!List.of("single-choice", "multi-choice", "tags").contains(kind) || isEmptyAnswer(value)) {
      return;
    }
    Set<String> allowed = new HashSet<>();
    JsonNode options = field.path("options");
    if (options.isArray()) {
      for (JsonNode option : options) {
        String optionValue = text(option, "value", "");
        if (!optionValue.isBlank()) {
          allowed.add(optionValue);
        }
      }
    }
    if ("single-choice".equals(kind)) {
      if (!value.isTextual() || !allowed.contains(value.asText())) {
        throwAnswerValidation(label + " has invalid option");
      }
      return;
    }
    if (!value.isArray()) {
      throwAnswerValidation(label + " must be an array");
    }
    for (JsonNode item : value) {
      if (!item.isTextual() || !allowed.contains(item.asText())) {
        throwAnswerValidation(label + " has invalid option");
      }
    }
  }

  private void validateStructuredValidators(JsonNode field, JsonNode value, String label) {
    JsonNode validators = field.path("validators");
    if (validators.isArray()) {
      for (JsonNode validator : validators) {
        validateOneValidator(validator, value, label);
      }
    }
    String legacyRegex = field.path("validations").path("regex").asText("");
    if (!legacyRegex.isBlank()) {
      validateRegex(legacyRegex, value, label);
    }
    String customFn = field.path("validations").path("customFn").asText("");
    if ("noEmoji(value)".equals(customFn)) {
      validateNoEmoji(value, label);
    } else if ("isJsonObject(value)".equals(customFn)) {
      validateJsonObject(value, label);
    } else if (customFn.startsWith("lengthBetween")) {
      var matcher = Pattern.compile("lengthBetween\\(value,\\s*(\\d+),\\s*(\\d+)\\)").matcher(customFn);
      if (matcher.find()) {
        validateLengthBetween(value, label, Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)));
      }
    }
  }

  private void validateOneValidator(JsonNode validator, JsonNode value, String label) {
    String type = text(validator, "type", "");
    switch (type) {
      case "regex" -> validateRegex(text(validator, "pattern", ""), value, label);
      case "noEmoji" -> validateNoEmoji(value, label);
      case "jsonObject" -> validateJsonObject(value, label);
      case "lengthBetween" -> validateLengthBetween(
          value,
          label,
          validator.path("min").asInt(0),
          validator.path("max").asInt(Integer.MAX_VALUE));
      default -> throwAnswerValidation(label + " has unsupported validator");
    }
  }

  private void validateRegex(String pattern, JsonNode value, String label) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    try {
      if (!Pattern.compile(pattern).matcher(value.asText()).matches()) {
        throwAnswerValidation(label + " format is invalid");
      }
    } catch (PatternSyntaxException exception) {
      throwAnswerValidation(label + " validator regex is invalid");
    }
  }

  private void validateNoEmoji(JsonNode value, String label) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    if (Pattern.compile("[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]").matcher(value.asText()).find()) {
      throwAnswerValidation(label + " cannot contain emoji");
    }
  }

  private void validateJsonObject(JsonNode value, String label) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    try {
      JsonNode parsed = objectMapper.readTree(value.asText());
      if (!parsed.isObject()) {
        throwAnswerValidation(label + " must be a JSON object");
      }
    } catch (JsonProcessingException exception) {
      throwAnswerValidation(label + " is not valid JSON");
    }
  }

  private void validateLengthBetween(JsonNode value, String label, int min, int max) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    int length = value.asText().length();
    if (length < min || length > max) {
      throwAnswerValidation(label + " length must be between " + min + " and " + max);
    }
  }

  private Set<String> resolveHiddenFields(ArrayNode fields, JsonNode answerJson) {
    Set<String> hidden = new HashSet<>();
    applyReactionRules(fields, answerJson, hidden, null);
    return hidden;
  }

  private Set<String> resolveConditionalRequiredFields(ArrayNode fields, JsonNode answerJson) {
    Set<String> required = new HashSet<>();
    applyReactionRules(fields, answerJson, null, required);
    return required;
  }

  private void applyReactionRules(
      ArrayNode fields,
      JsonNode answerJson,
      Set<String> hidden,
      Set<String> required) {
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        if (!matchesReaction(reaction, answerJson.get(text(reaction, "sourceField", "")))) {
          continue;
        }
        String targetField = text(reaction, "targetField", "");
        String action = text(reaction, "action", "");
        if (hidden != null) {
          if ("hidden".equals(action)) {
            hidden.add(targetField);
          } else if ("visible".equals(action)) {
            hidden.remove(targetField);
          }
        }
        if (required != null) {
          if ("required".equals(action)) {
            required.add(targetField);
          } else if ("optional".equals(action)) {
            required.remove(targetField);
          }
        }
      }
    }
  }

  private boolean matchesReaction(JsonNode reaction, JsonNode value) {
    String operator = text(reaction, "operator", "");
    JsonNode expected = reaction.get("value");
    return switch (operator) {
      case "eq" -> value != null && expected != null && Objects.equals(value.asText(), expected.asText());
      case "ne" -> value == null || expected == null || !Objects.equals(value.asText(), expected.asText());
      case "empty" -> isEmptyAnswer(value);
      case "notEmpty" -> !isEmptyAnswer(value);
      case "includes" -> includesValue(value, expected);
      default -> false;
    };
  }

  private boolean includesValue(JsonNode value, JsonNode expected) {
    if (value == null || expected == null) {
      return false;
    }
    if (value.isArray()) {
      for (JsonNode item : value) {
        if (Objects.equals(item.asText(), expected.asText())) {
          return true;
        }
      }
      return false;
    }
    return value.asText().contains(expected.asText());
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

  private void auditSubmit(
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      String assignmentBeforeStatus,
      long annotationId,
      long aiReviewJobId,
      long schemaVersionId,
      JsonNode answerJson,
      int revisionNo,
      boolean resubmit) {
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        assignment.assignmentId(),
        labeler,
        "labeler",
        resubmit ? "annotation.resubmit" : "annotation.submit",
        assignmentBeforeStatus,
        "submitted",
        resubmit ? "annotation resubmitted" : "annotation submitted",
        java.util.Map.of("assignmentId", assignment.assignmentId(), "status", assignmentBeforeStatus),
        java.util.Map.of("assignmentId", assignment.assignmentId(), "status", "submitted"),
        null);
    stateMachineService.auditCreation(
        WorkflowEntityType.ANNOTATION,
        annotationId,
        labeler,
        "labeler",
        resubmit ? "annotation.resubmit" : "annotation.submit",
        "submitted",
        resubmit ? "annotation resubmitted" : "annotation submitted",
        java.util.Map.of(
            "annotationId", annotationId,
            "assignmentId", assignment.assignmentId(),
            "schemaVersionId", schemaVersionId,
            "revisionNo", revisionNo,
            "answerJson", answerJson),
        null);
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        annotationId,
        labeler,
        "labeler",
        "ai_review.start",
        "submitted",
        "ai_reviewing",
        "ai review job queued",
        java.util.Map.of("annotationId", annotationId, "status", "submitted"),
        java.util.Map.of("annotationId", annotationId, "status", "ai_reviewing"),
        null);
    stateMachineService.auditCreation(
        WorkflowEntityType.AI_REVIEW_JOB,
        aiReviewJobId,
        labeler,
        "system_agent",
        "ai_review.start",
        "pending",
        "ai review job created",
        java.util.Map.of("annotationId", annotationId, "schemaVersionId", schemaVersionId),
        null);
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

  private record SchemaContext(long id, ArrayNode fields, boolean runtimeUsable) {}
}
