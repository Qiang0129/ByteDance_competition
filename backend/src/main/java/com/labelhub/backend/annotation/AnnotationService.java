package com.labelhub.backend.annotation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.ai.AiReviewRepository;
import com.labelhub.backend.ai.AiReviewService;
import com.labelhub.backend.annotation.AnnotationRepository.AssignmentItemRecord;
import com.labelhub.backend.annotation.AnnotationRepository.AnnotationRecord;
import com.labelhub.backend.annotation.AnnotationRepository.DraftRecord;
import com.labelhub.backend.annotation.AnnotationRepository.IssueRecord;
import com.labelhub.backend.annotation.AnnotationRepository.LabelerContributionRecord;
import com.labelhub.backend.annotation.AnnotationRepository.LabelerDraftRecord;
import com.labelhub.backend.annotation.AnnotationRepository.LabelerItemHistoryRecord;
import com.labelhub.backend.annotation.AnnotationRepository.SchemaSnapshotRecord;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.PageResponse;
import com.labelhub.backend.task.TaskDeadlineSettlementService;
import com.labelhub.backend.task.TaskService;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
  private static final Set<String> ISSUE_CATEGORIES = Set.of(
      "data_error",
      "schema_mismatch",
      "media_broken",
      "duplicate",
      "sensitive",
      "other");

  private final AnnotationRepository annotationRepository;
  private final TaskService taskService;
  private final TaskDeadlineSettlementService deadlineSettlementService;
  private final AiReviewService aiReviewService;
  private final AnswerValidationService answerValidationService;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public AnnotationService(
      AnnotationRepository annotationRepository,
      TaskService taskService,
      TaskDeadlineSettlementService deadlineSettlementService,
      AiReviewService aiReviewService,
      AnswerValidationService answerValidationService,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.annotationRepository = annotationRepository;
    this.taskService = taskService;
    this.deadlineSettlementService = deadlineSettlementService;
    this.aiReviewService = aiReviewService;
    this.answerValidationService = answerValidationService;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  public AssignmentItemResponse getAssignmentItem(Authentication authentication, long assignmentId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureAssignmentUsable(assignment);
    try {
      taskService.backfillAssignmentsForLabelerTask(labeler.id(), assignment.taskId());
    } catch (ApiException exception) {
      if (!Set.of("SCHEMA_WITHDRAWN", "TASK_EXPIRED", "TASK_NOT_PUBLISHED").contains(exception.getCode())) {
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
    boolean reworkOpen = isReturnReworkOpen(assignment);
    LabelerContributionRecord contribution = annotationRepository.getLabelerContribution(
        labeler.id(),
        assignment.taskId());
    List<LabelerItemHistoryResponse> itemHistory = buildLabelerItemHistory(assignment);
    return new AssignmentItemResponse(
        Long.toString(assignment.assignmentId()),
        Long.toString(assignment.taskId()),
        assignment.taskTitle(),
        Long.toString(assignment.itemId()),
        assignment.assignmentStatus(),
        (schema.runtimeUsable() || reworkOpen) && isEditableAssignment(assignment),
        formatDateTime(assignment.taskDeadline()),
        formatDateTime(assignment.resubmitDeadline()),
        resolveLockReason(assignment),
        Long.toString(schema.id()),
        schema.digest(),
        buildRawPayload(assignment),
        schema.fields(),
        resolvePosition(assignment, schema),
        returnReason,
        draft,
        latestAnnotation,
        readMetadataLlmAssistEnabled(assignment.rewardRuleJson()),
        new LabelerContributionResponse(
            contribution.submittedCount(),
            contribution.approvedCount(),
            contribution.returnedCount(),
            contribution.rejectedCount(),
            contribution.disputedCount()),
        itemHistory);
  }

  public DraftResponse getDraft(Authentication authentication, long assignmentId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
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
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureEditableAssignment(assignment);
    SchemaContext schema = resolveSchema(assignment, !isReturnReworkOpen(assignment));
    ensureSchemaDigestMatches(request == null ? null : request.schemaDigest(), schema);
    JsonNode answerJson = requireAnswerObject(request == null ? null : request.answerJson());
    JsonNode visibleAnswerJson = filterVisibleAnswer(answerJson, schema.fields());
    DraftRecord saved = annotationRepository.upsertDraft(
        assignment.assignmentId(),
        writeJson(visibleAnswerJson));
    return toDraftResponse(saved);
  }

  public PageResponse<LabelerDraftResponse> listDrafts(
      Authentication authentication,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 50 : Math.min(pageSize, 100);
    long total = annotationRepository.countDraftsForLabeler(labeler.id());
    List<LabelerDraftResponse> items = annotationRepository
        .listDraftsForLabeler(labeler.id(), safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toLabelerDraftResponse)
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  public void deleteDraft(Authentication authentication, long assignmentId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureAssignmentUsable(assignment);
    annotationRepository.deleteDraft(assignment.assignmentId());
  }

  @Transactional
  public ReportIssueResponse reportIssue(
      Authentication authentication,
      long assignmentId,
      ReportIssueRequest request) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = loadAssignment(labeler.id(), assignmentId);
    ensureAssignmentUsable(assignment);
    String category = normalizeIssueCategory(request == null ? null : request.category());
    String description = normalizeIssueDescription(request == null ? null : request.description());
    IssueRecord issue = annotationRepository.createIssue(
        assignment.assignmentId(),
        assignment.taskId(),
        assignment.itemId(),
        labeler.id(),
        category,
        description);
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        assignment.assignmentId(),
        labeler,
        "labeler",
        "assignment.issue_reported",
        null,
        null,
        description,
        null,
        Map.of(
            "issueId", issue.id(),
            "assignmentId", assignment.assignmentId(),
            "taskId", assignment.taskId(),
            "itemId", assignment.itemId(),
            "category", category),
        Map.of(
            "issueId", issue.id(),
            "category", category,
            "taskTitle", blankToDefault(assignment.taskTitle(), "标注任务")));
    return toReportIssueResponse(issue);
  }

  @Transactional
  public AnnotationResponse submit(
      Authentication authentication,
      long assignmentId,
      SubmitAnnotationRequest request) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = annotationRepository
        .lockAssignmentForLabeler(assignmentId, labeler.id())
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "ASSIGNMENT_NOT_FOUND",
            "assignment not found"));
    ensureEditableAssignment(assignment);
    ensureTaskAllowsSubmission(assignment);
    SchemaContext schema = resolveSchema(assignment, !isReturnReworkOpen(assignment));
    long requestedSchemaId = parseSchemaVersionId(request == null ? null : request.schemaVersionId());
    if (requestedSchemaId != schema.id()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_VERSION_MISMATCH",
          "schema version does not match assignment");
    }
    ensureSchemaDigestMatches(request.schemaDigest(), schema);
    JsonNode answerJson = requireAnswerObject(request.answerJson());
    JsonNode visibleAnswerJson = filterVisibleAnswer(answerJson, schema.fields());
    validateAnswer(visibleAnswerJson, schema.fields());

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
    auditSubmit(
        labeler,
        assignment,
        assignmentBeforeStatus,
        annotationId,
        aiReviewJobId,
        schema.id(),
        visibleAnswerJson,
        revisionNo,
        resubmit);

    return new AnnotationResponse(
        Long.toString(annotationId),
        Long.toString(assignment.assignmentId()),
        Long.toString(schema.id()),
        visibleAnswerJson,
        readJson(schema.schemaJson()),
        aiReviewJobId == null ? "REVIEWING" : "AI_REVIEWING",
        revisionNo,
        null);
  }

  @Transactional
  public BatchSubmitResponse submitTaskAssignments(Authentication authentication, long taskId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    List<AssignmentItemRecord> assignments = annotationRepository.lockTaskAssignmentsForLabeler(
        taskId,
        labeler.id());
    if (assignments.isEmpty()) {
      throw new ApiException(
          HttpStatus.NOT_FOUND,
          "ASSIGNMENT_NOT_FOUND",
          "task has no assignment for current labeler");
    }

    List<BatchSubmitInvalidItem> invalidItems = new ArrayList<>();
    List<PreparedBatchSubmission> preparedSubmissions = new ArrayList<>();
    for (int index = 0; index < assignments.size(); index += 1) {
      AssignmentItemRecord assignment = assignments.get(index);
      String assignmentStatus = normalize(assignment.assignmentStatus());
      if (isBatchSubmitSkippableStatus(assignmentStatus)) {
        continue;
      }
      ensureEditableAssignment(assignment);
      SchemaContext schema = resolveSchema(assignment, !isReturnReworkOpen(assignment));
      DraftRecord draft = annotationRepository.findDraft(assignment.assignmentId()).orElse(null);
      if (draft == null) {
        invalidItems.add(toBatchInvalidItem(assignment, index + 1, "该题还没有保存草稿", Map.of()));
        continue;
      }

      try {
        JsonNode answerJson = requireAnswerObject(readJson(draft.answerJson()));
        JsonNode visibleAnswerJson = filterVisibleAnswer(answerJson, schema.fields());
        validateAnswer(visibleAnswerJson, schema.fields());
        int revisionNo = annotationRepository.nextRevisionNo(assignment.assignmentId());
        boolean resubmit = revisionNo > 1 || "returned".equalsIgnoreCase(assignment.assignmentStatus());
        preparedSubmissions.add(new PreparedBatchSubmission(
            assignment,
            schema,
            visibleAnswerJson,
            revisionNo,
            resubmit));
      } catch (ApiException exception) {
        if (isDraftValidationError(exception)) {
          invalidItems.add(toBatchInvalidItem(
              assignment,
              index + 1,
              exception.getMessage(),
              Map.of("_form", exception.getMessage())));
          continue;
        }
        throw exception;
      }
    }

    if (!invalidItems.isEmpty()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "BATCH_SUBMIT_INCOMPLETE",
          "部分题目未完成或校验失败，请修正后再提交",
          invalidItems);
    }

    List<String> annotationIds = new ArrayList<>();
    for (PreparedBatchSubmission prepared : preparedSubmissions) {
      AssignmentItemRecord assignment = prepared.assignment();
      SchemaContext schema = prepared.schema();
      String assignmentBeforeStatus = assignment.assignmentStatus();
      long annotationId = annotationRepository.createAnnotation(
          assignment.assignmentId(),
          schema.id(),
          schema.schemaJson(),
          writeJson(prepared.answerJson()),
          prepared.revisionNo(),
          "submitted");
      annotationRepository.markSubmitted(assignment.assignmentId(), assignment.itemId());
      annotationRepository.deleteDraft(assignment.assignmentId());
      Long aiReviewJobId = enqueueAiReviewIfEnabled(assignment, annotationId, schema);
      auditSubmit(
          labeler,
          assignment,
          assignmentBeforeStatus,
          annotationId,
          aiReviewJobId,
          schema.id(),
          prepared.answerJson(),
          prepared.revisionNo(),
          prepared.resubmit());
      annotationIds.add(Long.toString(annotationId));
    }

    return new BatchSubmitResponse(Long.toString(taskId), annotationIds.size(), annotationIds);
  }

  private AssignmentItemRecord loadAssignment(long labelerId, long assignmentId) {
    return annotationRepository.findAssignmentForLabeler(assignmentId, labelerId)
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "ASSIGNMENT_NOT_FOUND",
            "assignment not found"));
  }

  private BatchSubmitInvalidItem toBatchInvalidItem(
      AssignmentItemRecord assignment,
      int index,
      String reason,
      Map<String, String> fieldErrors) {
    return new BatchSubmitInvalidItem(
        Long.toString(assignment.assignmentId()),
        Long.toString(assignment.itemId()),
        index,
        reason,
        fieldErrors);
  }

  private boolean isDraftValidationError(ApiException exception) {
    return Set.of(
        "ANSWER_VALIDATION_FAILED",
        "INVALID_ANSWER_JSON",
        "INVALID_JSON").contains(exception.getCode());
  }

  private boolean isBatchSubmitSkippableStatus(String assignmentStatus) {
    return Set.of(
        "submitted",
        "ai_reviewing",
        "reviewing",
        "accepted",
        "exported").contains(assignmentStatus);
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
    if ("returned".equals(status)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "RETURN_REWORK_EXPIRED",
          "returned assignment rework window has expired");
    }
    String taskStatus = normalize(assignment.taskStatus());
    if (!"published".equals(taskStatus)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "TASK_NOT_PUBLISHED",
          "task is not published");
    }
    throw new ApiException(HttpStatus.CONFLICT, "TASK_EXPIRED", "task deadline has passed");
  }

  private boolean isEditableAssignment(AssignmentItemRecord assignment) {
    if (assignment.taskDeletedAt() != null) {
      return false;
    }
    String status = normalize(assignment.assignmentStatus());
    if ("returned".equals(status)) {
      return isReturnReworkOpen(assignment);
    }
    String taskStatus = normalize(assignment.taskStatus());
    return List.of("claimed", "submitted").contains(status)
        && "published".equals(taskStatus)
        && !isDeadlineExpired(assignment.taskDeadline());
  }

  private boolean isEditableDraft(LabelerDraftRecord draft) {
    if (draft.taskDeletedAt() != null) {
      return false;
    }
    String status = normalize(draft.assignmentStatus());
    if ("returned".equals(status)) {
      return draft.resubmitDeadline() != null && draft.resubmitDeadline().isAfter(LocalDateTime.now());
    }
    String taskStatus = normalize(draft.taskStatus());
    return List.of("claimed", "submitted").contains(status)
        && "published".equals(taskStatus)
        && !isDeadlineExpired(draft.taskDeadline());
  }

  private boolean isDeadlineExpired(LocalDateTime deadline) {
    return deadline != null && deadline.isBefore(LocalDateTime.now());
  }

  private void ensureTaskAllowsSubmission(AssignmentItemRecord assignment) {
    ensureAssignmentUsable(assignment);
    if (isReturnReworkOpen(assignment)) {
      return;
    }
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

  private boolean isReturnReworkOpen(AssignmentItemRecord assignment) {
    return "returned".equals(normalize(assignment.assignmentStatus()))
        && assignment.resubmitDeadline() != null
        && assignment.resubmitDeadline().isAfter(LocalDateTime.now());
  }

  private String resolveLockReason(AssignmentItemRecord assignment) {
    if (isEditableAssignment(assignment)) {
      return "";
    }
    String status = normalize(assignment.assignmentStatus());
    if ("returned".equals(status)) {
      return "RETURN_REWORK_EXPIRED";
    }
    if (!"published".equals(normalize(assignment.taskStatus()))) {
      return "TASK_NOT_PUBLISHED";
    }
    if (isDeadlineExpired(assignment.taskDeadline())) {
      return "TASK_EXPIRED";
    }
    return "ASSIGNMENT_NOT_EDITABLE";
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
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
    ObjectNode root = normalizeRuntimeSchemaRoot(readJson(schema.schemaJson()));
    JsonNode fields = root.path("fields");
    ArrayNode fieldArray = fields.isArray()
        ? (ArrayNode) fields
        : objectMapper.createArrayNode();
    String schemaJson = writeJson(root);
    return new SchemaContext(schema.id(), schemaJson, schemaDigest(schemaJson), fieldArray, runtimeUsable);
  }

  private ObjectNode normalizeRuntimeSchemaRoot(JsonNode root) {
    ObjectNode normalized = root != null && root.isObject()
        ? ((ObjectNode) root).deepCopy()
        : objectMapper.createObjectNode();
    JsonNode fields = normalized.path("fields");
    normalized.set(
        "fields",
        fields.isArray() ? normalizeRuntimeFields(fields) : objectMapper.createArrayNode());
    return normalized;
  }

  private ArrayNode normalizeRuntimeFields(JsonNode fields) {
    ArrayNode normalized = objectMapper.createArrayNode();
    for (JsonNode field : fields) {
      if (!field.isObject()) {
        normalized.add(field.deepCopy());
        continue;
      }
      ObjectNode next = ((ObjectNode) field).deepCopy();
      if (!next.hasNonNull("semanticType") || next.path("semanticType").asText("").isBlank()) {
        next.put("semanticType", inferSemanticType(text(next, "kind", "")));
      }
      normalized.add(next);
    }
    return normalized;
  }

  private void ensureSchemaDigestMatches(String requestDigest, SchemaContext schema) {
    if (requestDigest == null || requestDigest.isBlank()) {
      return;
    }
    if (requestDigest.equals(schema.digest())) {
      return;
    }
    throw new ApiException(
        HttpStatus.CONFLICT,
        "SCHEMA_CHANGED",
        "schema has changed, please reload the assignment");
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

  private boolean readMetadataAiReviewEnabled(String rewardRuleJson) {
    if (rewardRuleJson == null || rewardRuleJson.isBlank()) {
      return true;
    }
    JsonNode root = readJson(rewardRuleJson);
    JsonNode value = root.path("aiReviewEnabled");
    return value.isMissingNode() || value.isNull() || value.asBoolean(true);
  }

  private boolean readMetadataLlmAssistEnabled(String rewardRuleJson) {
    if (rewardRuleJson == null || rewardRuleJson.isBlank()) {
      return false;
    }
    JsonNode root = readJson(rewardRuleJson);
    JsonNode value = root.path("llmAssistEnabled");
    return !value.isMissingNode() && !value.isNull() && value.asBoolean(false);
  }

  private Long readMetadataAiReviewRuleId(String rewardRuleJson) {
    if (rewardRuleJson == null || rewardRuleJson.isBlank()) {
      return null;
    }
    JsonNode root = readJson(rewardRuleJson);
    JsonNode value = root.path("aiReviewRuleId");
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
            "INVALID_AI_REVIEW_RULE_ID",
            "ai review rule id format is invalid");
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

  private AssignmentPositionResponse resolvePosition(AssignmentItemRecord assignment, SchemaContext schema) {
    List<AnnotationRepository.AssignmentProgressRecord> progress =
        annotationRepository.listAssignmentProgress(assignment.taskId(), assignment.labelerId());
    List<String> idStrings = new ArrayList<>(progress.size());
    List<String> statuses = new ArrayList<>(progress.size());
    int zeroBased = -1;
    for (int i = 0; i < progress.size(); i += 1) {
      AnnotationRepository.AssignmentProgressRecord record = progress.get(i);
      idStrings.add(Long.toString(record.assignmentId()));
      statuses.add(resolveDotStatus(record, schema));
      if (record.assignmentId() == assignment.assignmentId()) {
        zeroBased = i;
      }
    }
    if (zeroBased < 0) {
      String self = Long.toString(assignment.assignmentId());
      return new AssignmentPositionResponse(1, 1, null, null, List.of(self), List.of("empty"));
    }
    String prev = zeroBased > 0 ? idStrings.get(zeroBased - 1) : null;
    String next = zeroBased + 1 < idStrings.size() ? idStrings.get(zeroBased + 1) : null;
    return new AssignmentPositionResponse(
        zeroBased + 1, idStrings.size(), prev, next, idStrings, statuses);
  }

  /**
   * 判定单题进度条着色状态:
   *   已提交 -> completed;
   *   有草稿且必填齐全 -> completed;
   *   有草稿但必填缺失 -> incomplete;
   *   无草稿 -> empty。
   * 复用 validateAnswer,仅捕获必填校验失败(ANSWER_VALIDATION_FAILED),
   * 其它异常按未完成处理,避免单题异常影响整体进度展示。
   */
  private String resolveDotStatus(
      AnnotationRepository.AssignmentProgressRecord record, SchemaContext schema) {
    String status = record.assignmentStatus() == null
        ? ""
        : record.assignmentStatus().toLowerCase(Locale.ROOT);
    if ("submitted".equals(status) || "accepted".equals(status)) {
      return "completed";
    }
    if (record.answerJson() == null || record.answerJson().isBlank()) {
      return "empty";
    }
    try {
      JsonNode answerJson = requireAnswerObject(readJson(record.answerJson()));
      JsonNode visibleAnswerJson = filterVisibleAnswer(answerJson, schema.fields());
      validateAnswer(visibleAnswerJson, schema.fields());
      return "completed";
    } catch (ApiException exception) {
      // 必填缺失或其它校验失败,统一按未完成着色,不影响整体进度展示
      return "incomplete";
    }
  }

  private DraftResponse toDraftResponse(DraftRecord record) {
    return new DraftResponse(
        Long.toString(record.assignmentId()),
        readJson(record.answerJson()),
        formatDateTime(record.updatedAt()));
  }

  private LabelerDraftResponse toLabelerDraftResponse(LabelerDraftRecord record) {
    String taskTitle = blankToDefault(record.taskTitle(), "标注任务");
    String taskType = blankToDefault(record.taskType(), "Annotation Task");
    String schemaVersion = record.schemaVersion() == null
        ? ""
        : "v" + record.schemaVersion();
    int itemIndex = Math.max(record.itemIndex(), 1);
    return new LabelerDraftResponse(
        Long.toString(record.assignmentId()),
        Long.toString(record.taskId()),
        Long.toString(record.itemId()),
        taskTitle + " - 第 " + itemIndex + " 题",
        taskTitle,
        taskType,
        toTaskTypeKey(taskType),
        record.schemaVersionId() == null ? "" : Long.toString(record.schemaVersionId()),
        schemaVersion,
        formatDateTime(record.draftUpdatedAt()),
        isEditableDraft(record));
  }

  private AnnotationResponse toAnnotationResponse(AnnotationRecord record, String returnReason) {
    return new AnnotationResponse(
        Long.toString(record.id()),
        Long.toString(record.assignmentId()),
        Long.toString(record.schemaVersionId()),
        readJson(record.answerJson()),
        record.schemaSnapshotJson() == null || record.schemaSnapshotJson().isBlank()
            ? null
            : readJson(record.schemaSnapshotJson()),
        normalizeAnnotationStatus(record.status()),
        record.revisionNo(),
        returnReason);
  }

  private List<LabelerItemHistoryResponse> buildLabelerItemHistory(AssignmentItemRecord assignment) {
    List<LabelerItemHistoryResponse> history = new ArrayList<>();
    for (LabelerItemHistoryRecord record : annotationRepository.listLabelerItemHistory(assignment.assignmentId())) {
      String type = record.eventType();
      if ("submit".equals(type)) {
        history.add(new LabelerItemHistoryResponse(
            "submit-" + record.annotationId(),
            "submit",
            record.revisionNo() <= 1 ? "提交" : "重新提交",
            "我",
            "SUBMIT",
            null,
            null,
            null,
            formatDateTime(record.submittedAt()),
            "completed"));
        continue;
      }
      if ("ai_review".equals(type)) {
        history.add(new LabelerItemHistoryResponse(
            "ai-" + record.annotationId(),
            "ai_review",
            "AI 预审（Revision " + record.revisionNo() + "）",
            "AI Agent",
            normalizeDecision(record.aiDecision()),
            null,
            record.aiComment(),
            record.aiTotalScore(),
            formatDateTime(record.aiFinishedAt()),
            record.aiDecision() == null || record.aiDecision().isBlank() ? "pending" : "completed"));
        continue;
      }
      if ("human_review".equals(type)) {
        String decision = normalizeDecision(record.humanDecision());
        history.add(new LabelerItemHistoryResponse(
            "human-" + record.annotationId() + "-" + history.size(),
            "human_review",
            resolveHumanHistoryTitle(record.revisionNo(), decision),
            blankToDefault(record.humanReviewerName(), "Reviewer"),
            decision,
            record.humanReason(),
            null,
            null,
            formatDateTime(record.humanReviewedAt()),
            "completed"));
      }
    }
    if ("returned".equalsIgnoreCase(assignment.assignmentStatus())) {
      history.add(new LabelerItemHistoryResponse(
          "rework-" + assignment.assignmentId(),
          "rework",
          "修改中",
          "我",
          "REWORKING",
          null,
          "当前",
          null,
          "",
          "current"));
    }
    return history;
  }

  private String resolveHumanHistoryTitle(int revisionNo, String decision) {
    if ("ESCALATE".equals(decision)) {
      return revisionNo <= 1 ? "初审升级" : "复审升级";
    }
    if (revisionNo <= 1) {
      return "初审";
    }
    if (revisionNo == 2) {
      return "复审";
    }
    return "终审";
  }

  private String normalizeDecision(String decision) {
    return decision == null || decision.isBlank() ? null : decision.toUpperCase(Locale.ROOT);
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
      String semanticType = semanticType(field);
      if ("display".equals(semanticType) || "layout".equals(semanticType)) {
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
      if ("json".equals(semanticType) && value != null && value.isTextual() && !value.asText().isBlank()) {
        try {
          objectMapper.readTree(value.asText());
        } catch (JsonProcessingException exception) {
          throwAnswerValidation(label + " is not valid JSON");
        }
      }
      validateChoiceValue(semanticType, field, value, label);
      validateStructuredValidators(field, value, label);
    }
  }

  private JsonNode filterVisibleAnswer(JsonNode answerJson, ArrayNode fields) {
    Set<String> hiddenFields = resolveHiddenFields(fields, answerJson);
    ObjectNode filtered = objectMapper.createObjectNode();
    for (JsonNode field : fields) {
      String semanticType = semanticType(field);
      if (!isSubmittableSemanticType(semanticType)) {
        continue;
      }
      String fieldName = text(field, "fieldName", "");
      if (fieldName.isBlank() || hiddenFields.contains(fieldName) || !answerJson.has(fieldName)) {
        continue;
      }
      filtered.set(fieldName, answerJson.get(fieldName));
    }
    return filtered;
  }

  private boolean isSubmittableSemanticType(String semanticType) {
    return List.of(
        "text",
        "single_choice",
        "multi_choice",
        "tags",
        "file",
        "json",
        "llm").contains(semanticType);
  }

  private void validateChoiceValue(String semanticType, JsonNode field, JsonNode value, String label) {
    if (!List.of("single_choice", "multi_choice", "tags").contains(semanticType) || isEmptyAnswer(value)) {
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
    if ("single_choice".equals(semanticType)) {
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
    if (hidden != null || required != null) {
      applyDisplayRequiredDefaults(fields, hidden, required);
    }
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String sourceField = text(reaction, "sourceField", "");
        if (!matchesReaction(reaction, answerJson.get(sourceField), findField(fields, sourceField))) {
          continue;
        }
        String targetField = text(reaction, "targetField", "");
        String action = text(reaction, "action", "");
        if (hidden != null) {
          if ("hidden".equals(action)) {
            hidden.add(targetField);
          } else if ("visible".equals(action) || isDisplayRequiredAction(action)) {
            hidden.remove(targetField);
          }
        }
        if (required != null) {
          if (isDisplayRequiredAction(action)) {
            required.add(targetField);
          } else if ("optional".equals(action)) {
            required.remove(targetField);
          }
        }
      }
    }
  }

  private void applyDisplayRequiredDefaults(
      ArrayNode fields,
      Set<String> hidden,
      Set<String> required) {
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String action = text(reaction, "action", "");
        if (!isDisplayRequiredAction(action)) {
          continue;
        }
        String targetField = text(reaction, "targetField", "");
        if (targetField.isBlank()) {
          continue;
        }
        if (hidden != null) {
          hidden.add(targetField);
        }
        if (required != null && !isStaticRequired(fields, targetField)) {
          required.remove(targetField);
        }
      }
    }
  }

  private boolean isDisplayRequiredAction(String action) {
    return "visibleRequired".equals(action) || "required".equals(action);
  }

  private boolean isStaticRequired(ArrayNode fields, String fieldName) {
    for (JsonNode field : fields) {
      if (fieldName.equals(text(field, "fieldName", ""))) {
        return field.path("required").asBoolean(false);
      }
    }
    return false;
  }

  private JsonNode findField(ArrayNode fields, String fieldName) {
    for (JsonNode field : fields) {
      if (fieldName.equals(text(field, "fieldName", ""))) {
        return field;
      }
    }
    return null;
  }

  private boolean matchesReaction(JsonNode reaction, JsonNode value, JsonNode sourceField) {
    String operator = text(reaction, "operator", "");
    Set<String> expectedValues = resolveExpectedValues(reaction, sourceField);
    return switch (operator) {
      case "eq" -> valueMatchesExpected(value, expectedValues);
      case "ne" -> !valueMatchesExpected(value, expectedValues);
      case "empty" -> isEmptyAnswer(value);
      case "notEmpty" -> !isEmptyAnswer(value);
      case "includes" -> includesValue(value, expectedValues);
      default -> false;
    };
  }

  private Set<String> resolveExpectedValues(JsonNode reaction, JsonNode sourceField) {
    Set<String> values = new HashSet<>();
    String raw = text(reaction, "value", "");
    if (!raw.isBlank()) {
      values.add(raw);
    }
    if (sourceField != null) {
      JsonNode options = sourceField.path("options");
      if (options.isArray()) {
        for (JsonNode option : options) {
          String optionValue = text(option, "value", "");
          String optionLabel = text(option, "label", "");
          if (raw.equals(optionValue) || raw.equals(optionLabel)) {
            if (!optionValue.isBlank()) {
              values.add(optionValue);
            }
            if (!optionLabel.isBlank()) {
              values.add(optionLabel);
            }
          }
        }
      }
    }
    return values;
  }

  private boolean valueMatchesExpected(JsonNode value, Set<String> expectedValues) {
    return value != null && !expectedValues.isEmpty() && expectedValues.contains(value.asText());
  }

  private boolean includesValue(JsonNode value, Set<String> expectedValues) {
    if (value == null || expectedValues.isEmpty()) {
      return false;
    }
    if (value.isArray()) {
      for (JsonNode item : value) {
        if (expectedValues.contains(item.asText())) {
          return true;
        }
      }
      return false;
    }
    return expectedValues.stream().anyMatch(expected -> value.asText().contains(expected));
  }

  private boolean isEmptyAnswer(JsonNode value) {
    return value == null
        || value.isNull()
        || (value.isTextual() && value.asText().isBlank())
        || (value.isArray() && value.isEmpty());
  }

  private String semanticType(JsonNode field) {
    String semanticType = text(field, "semanticType", "");
    if (!semanticType.isBlank()) {
      return semanticType;
    }
    return inferSemanticType(text(field, "kind", ""));
  }

  private String inferSemanticType(String kind) {
    return switch (kind) {
      case "single-choice" -> "single_choice";
      case "multi-choice" -> "multi_choice";
      case "tags" -> "tags";
      case "json-editor" -> "json";
      case "file-upload" -> "file";
      case "llm-trigger" -> "llm";
      case "show-item" -> "display";
      case "group", "multi-tab" -> "layout";
      default -> "text";
    };
  }

  private void throwAnswerValidation(String message) {
    throw new ApiException(HttpStatus.BAD_REQUEST, "ANSWER_VALIDATION_FAILED", message);
  }

  private void auditSubmit(
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      String assignmentBeforeStatus,
      long annotationId,
      Long aiReviewJobId,
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
    if (aiReviewJobId == null) {
      stateMachineService.audit(
          WorkflowEntityType.ANNOTATION,
          annotationId,
          labeler,
          "system_agent",
          "annotation.submit",
          "submitted",
          "reviewing",
          "ai review disabled, send to human review",
          java.util.Map.of("annotationId", annotationId, "status", "submitted"),
          java.util.Map.of("annotationId", annotationId, "status", "reviewing"),
          null);
      return;
    }
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

  private String schemaDigest(String schemaJson) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] bytes = digest.digest(schemaJson.getBytes(StandardCharsets.UTF_8));
      StringBuilder builder = new StringBuilder(bytes.length * 2);
      for (byte value : bytes) {
        builder.append(String.format("%02x", value));
      }
      return builder.toString();
    } catch (NoSuchAlgorithmException exception) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "SCHEMA_DIGEST_FAILED", "schema digest failed");
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

  private String toTaskTypeKey(String taskType) {
    if (taskType == null || taskType.isBlank()) {
      return "annotation_task";
    }
    String normalized = taskType.trim().toLowerCase(Locale.ROOT).replace(' ', '_');
    if (normalized.contains("preference")) {
      return "preference_compare";
    }
    if (normalized.contains("image")) {
      return "image_classification";
    }
    if (normalized.contains("safety")) {
      return "safety_tagging";
    }
    if (normalized.contains("qa")) {
      return "qa_quality";
    }
    return normalized;
  }

  private String normalizeIssueCategory(String category) {
    String normalized = category == null ? "" : category.trim().toLowerCase(Locale.ROOT);
    if (!ISSUE_CATEGORIES.contains(normalized)) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_ISSUE_CATEGORY",
          "invalid issue category");
    }
    return normalized;
  }

  private String normalizeIssueDescription(String description) {
    String normalized = description == null ? "" : description.trim();
    if (normalized.length() < 5 || normalized.length() > 500) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_ISSUE_DESCRIPTION",
          "issue description length must be between 5 and 500");
    }
    return normalized;
  }

  private ReportIssueResponse toReportIssueResponse(IssueRecord record) {
    return new ReportIssueResponse(
        Long.toString(record.id()),
        Long.toString(record.assignmentId()),
        Long.toString(record.taskId()),
        Long.toString(record.itemId()),
        record.category(),
        record.description(),
        record.status(),
        formatDateTime(record.createdAt()));
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

  private record SchemaContext(
      long id,
      String schemaJson,
      String digest,
      ArrayNode fields,
      boolean runtimeUsable) {}

  private record PreparedBatchSubmission(
      AssignmentItemRecord assignment,
      SchemaContext schema,
      JsonNode answerJson,
      int revisionNo,
      boolean resubmit) {}
}
