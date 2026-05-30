package com.labelhub.backend.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.PageResponse;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AiReviewService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final TypeReference<List<AiReviewDimension>> DIMENSION_LIST =
      new TypeReference<>() {};
  private static final TypeReference<Map<String, Double>> SCORE_MAP =
      new TypeReference<>() {};
  private static final TypeReference<List<String>> STRING_LIST =
      new TypeReference<>() {};

  private final AiReviewRepository aiReviewRepository;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public AiReviewService(
      AiReviewRepository aiReviewRepository,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.aiReviewRepository = aiReviewRepository;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  public PageResponse<AiReviewRuleResponse> listRules(
      Authentication authentication,
      String status,
    String taskId,
    Integer page,
    Integer pageSize) {
    requireRuleManager(authentication);
    String normalizedStatus = normalizeRuleStatusFilter(status);
    Long parsedTaskId = parseOptionalLong(taskId, "INVALID_TASK_ID");
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    long total = aiReviewRepository.countRules(normalizedStatus, parsedTaskId);
    List<AiReviewRuleResponse> items = aiReviewRepository
        .listRules(normalizedStatus, parsedTaskId, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toRuleResponse)
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  public AiReviewRuleResponse getRule(Authentication authentication, long ruleId) {
    requireRuleManager(authentication);
    return aiReviewRepository.findRule(ruleId)
        .map(this::toRuleResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_RULE_NOT_FOUND", "ai review rule not found"));
  }

  @Transactional
  public AiReviewRuleResponse createRule(Authentication authentication, AiReviewRuleRequest request) {
    AuthenticatedUser operator = requireRuleManager(authentication);
    ValidRuleInput input = validateRuleInput(request);
    long ruleId = aiReviewRepository.createRule(
        input.name(),
        input.scopeTaskId(),
        input.promptTemplate(),
        input.dimensionsJson(),
        input.passThreshold(),
        input.needHumanThreshold(),
        input.maxRetry(),
        input.retryBackoffSec(),
        input.status(),
        operator.id());
    return getRule(authentication, ruleId);
  }

  @Transactional
  public AiReviewRuleResponse updateRule(
      Authentication authentication,
      long ruleId,
      AiReviewRuleRequest request) {
    requireRuleManager(authentication);
    ValidRuleInput input = validateRuleInput(request);
    int updated = aiReviewRepository.updateRule(
        ruleId,
        input.name(),
        input.scopeTaskId(),
        input.promptTemplate(),
        input.dimensionsJson(),
        input.passThreshold(),
        input.needHumanThreshold(),
        input.maxRetry(),
        input.retryBackoffSec(),
        input.status());
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_RULE_NOT_FOUND", "ai review rule not found");
    }
    return getRule(authentication, ruleId);
  }

  @Transactional
  public void deleteRule(Authentication authentication, long ruleId) {
    requireRuleManager(authentication);
    aiReviewRepository.deleteRule(ruleId);
  }

  @Transactional
  public AiReviewRuleResponse toggleRule(
      Authentication authentication,
      long ruleId,
      ToggleAiReviewRuleRequest request) {
    requireRuleManager(authentication);
    String status = normalizeRuleStatus(request == null ? null : request.status());
    int updated = aiReviewRepository.toggleRule(ruleId, status);
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_RULE_NOT_FOUND", "ai review rule not found");
    }
    return getRule(authentication, ruleId);
  }

  public PageResponse<AiReviewJobResponse> listJobs(
      Authentication authentication,
      String status,
      String ruleId,
      String taskId,
      Integer page,
      Integer pageSize) {
    requireAiManager(authentication);
    String normalizedStatus = normalizeJobStatusFilter(status);
    Long parsedRuleId = parseOptionalLong(ruleId, "INVALID_AI_REVIEW_RULE_ID");
    Long parsedTaskId = parseOptionalLong(taskId, "INVALID_TASK_ID");
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    long total = aiReviewRepository.countJobs(normalizedStatus, parsedRuleId, parsedTaskId);
    List<AiReviewJobResponse> items = aiReviewRepository
        .listJobs(normalizedStatus, parsedRuleId, parsedTaskId, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toResponse)
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  @Transactional
  public AiReviewJobClaimResponse claimNext(Authentication authentication) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = aiReviewRepository.findNextPendingJob()
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "AI_REVIEW_JOB_NOT_FOUND",
            "pending ai review job not found"));
    String runToken = UUID.randomUUID().toString();
    aiReviewRepository.markRunning(job.id(), runToken);
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.start",
        job.status(),
        "running",
        "ai review job claimed",
        Map.of("jobId", job.id(), "status", job.status()),
        Map.of("jobId", job.id(), "status", "running"),
        null);
    AiReviewRepository.AiReviewJobRecord running = lockJob(job.id());
    AiReviewRepository.AiReviewJobPayloadRecord payload = aiReviewRepository.findJobPayload(job.id())
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "AI_REVIEW_JOB_NOT_FOUND",
            "ai review job payload not found"));
    return new AiReviewJobClaimResponse(
        toResponse(running),
        Long.toString(payload.taskId()),
        payload.taskTitle(),
        Long.toString(payload.annotationId()),
        runToken,
        buildRawPayload(payload),
        readJson(payload.answerJson()),
        readJson(payload.schemaSnapshotJson()),
        readJson(payload.ruleSnapshotJson()));
  }

  @Transactional
  public AiReviewJobResponse complete(
      Authentication authentication,
      long jobId,
      AiReviewCompleteRequest request) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    if (!"running".equals(job.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "AI_REVIEW_JOB_NOT_RUNNING", "ai review job is not running");
    }
    ensureFreshRunToken(authentication, job, request == null ? null : request.runToken(), "complete");
    String decision = normalizeDecision(request == null ? null : request.decision());
    double totalScore = request == null || request.totalScore() == null
        ? calculateTotalScore(request == null ? null : request.scores(), job.ruleSnapshotJson())
        : request.totalScore();
    validateScores(request == null ? null : request.scores(), job.ruleSnapshotJson());
    aiReviewRepository.createResult(
        job.id(),
        writeNullableJson(request == null ? null : request.scores()),
        totalScore,
        decision,
        request == null ? null : request.comment(),
        writeNullableJson(request == null ? null : request.riskFlags()),
        writeNullableJson(request == null ? null : request.evidence()),
        request == null ? null : request.promptSnapshot(),
        writeNullableJson(request == null ? null : request.responseJson()),
        request == null ? null : request.modelName(),
        request == null ? null : request.latencyMs());
    aiReviewRepository.markSucceeded(job.id());
    aiReviewRepository.updateAnnotationStatus(job.annotationId(), "reviewing");
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.complete",
        job.status(),
        "succeeded",
        "ai review completed",
        Map.of("jobId", job.id(), "status", job.status()),
        Map.of("jobId", job.id(), "status", "succeeded", "decision", decision, "totalScore", totalScore),
        null);
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        job.annotationId(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.complete",
        "ai_reviewing",
        "reviewing",
        "ai review completed",
        Map.of("annotationId", job.annotationId(), "status", "ai_reviewing"),
        Map.of("annotationId", job.annotationId(), "status", "reviewing", "decision", decision),
        null);
    return toResponse(lockJob(job.id()));
  }

  @Transactional
  public AiReviewJobResponse fail(
      Authentication authentication,
      long jobId,
      AiReviewFailRequest request) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    if (!List.of("pending", "running").contains(job.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "AI_REVIEW_JOB_NOT_FAILABLE", "ai review job cannot fail from current state");
    }
    if ("running".equals(job.status())) {
      ensureFreshRunToken(authentication, job, request == null ? null : request.runToken(), "fail");
    }
    String errorSummary = request == null ? null : request.errorSummary();
    aiReviewRepository.markFailed(job.id(), errorSummary);
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.fail",
        job.status(),
        "failed",
        errorSummary,
        Map.of("jobId", job.id(), "status", job.status()),
        Map.of("jobId", job.id(), "status", "failed"),
        null);

    RetryPolicy policy = parseRetryPolicy(job.ruleSnapshotJson());
    if (job.retryCount() < policy.maxRetry()) {
      AiReviewRepository.AiReviewJobRecord failed = lockJob(job.id());
      aiReviewRepository.retry(job.id(), policy.retryBackoffSec());
      stateMachineService.audit(
          WorkflowEntityType.AI_REVIEW_JOB,
          job.id(),
          operator,
          resolveOperatorRole(operator),
          "ai_review.retry",
          failed.status(),
          "pending",
          "ai review retry scheduled",
          Map.of("jobId", job.id(), "status", failed.status(), "retryCount", failed.retryCount()),
          Map.of("jobId", job.id(), "status", "pending", "retryCount", failed.retryCount() + 1),
          null);
      return toResponse(lockJob(job.id()));
    }

    aiReviewRepository.updateAnnotationStatus(job.annotationId(), "reviewing");
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        job.annotationId(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.fallback_to_human",
        "ai_reviewing",
        "reviewing",
        "ai review failed, fallback to human review",
        Map.of("annotationId", job.annotationId(), "status", "ai_reviewing"),
        Map.of("annotationId", job.annotationId(), "status", "reviewing", "aiFailed", true),
        null);
    return toResponse(lockJob(job.id()));
  }

  @Transactional
  public AiReviewJobResponse retry(Authentication authentication, long jobId) {
    AuthenticatedUser operator = requireAiManager(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    if (!"failed".equals(job.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "JOB_NOT_RETRYABLE", "only failed ai review job can retry");
    }
    aiReviewRepository.retry(job.id(), 0);
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.retry",
        job.status(),
        "pending",
        "ai review retry requested",
        Map.of("jobId", job.id(), "status", job.status()),
        Map.of("jobId", job.id(), "status", "pending"),
        null);
    return toResponse(lockJob(job.id()));
  }

  @Transactional
  public AiReviewBatchDeleteResponse batchDeleteJobs(
      Authentication authentication,
      AiReviewBatchDeleteRequest request) {
    AuthenticatedUser operator = requireAiManager(authentication);
    if (operator.roles().contains("system_agent")
        && operator.roles().stream().noneMatch(role -> List.of("owner", "reviewer", "ai_reviewer").contains(role))) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "system_agent cannot delete ai review jobs");
    }
    List<Long> jobIds = parseJobIds(request == null ? null : request.jobIds());
    List<String> deleted = new java.util.ArrayList<>();
    for (Long jobId : jobIds) {
      AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
      if (!List.of("failed", "succeeded").contains(job.status())) {
        throw new ApiException(
            HttpStatus.CONFLICT,
            "AI_REVIEW_JOB_NOT_DELETABLE",
            "only failed or succeeded ai review jobs can be deleted");
      }
      stateMachineService.audit(
          WorkflowEntityType.AI_REVIEW_JOB,
          job.id(),
          operator,
          resolveOperatorRole(operator),
          "ai_review.delete",
          job.status(),
          job.status(),
          "ai review job deleted",
          Map.of("jobId", job.id(), "status", job.status()),
          Map.of("jobId", job.id(), "deleted", true),
          null);
      aiReviewRepository.deleteJob(job.id());
      deleted.add(Long.toString(job.id()));
    }
    return new AiReviewBatchDeleteResponse(deleted.size(), deleted);
  }

  @Transactional
  public AiReviewJobResponse cancel(Authentication authentication, long jobId, AiReviewCancelRequest request) {
    AuthenticatedUser operator = requireAiManager(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    if (!"running".equals(job.status())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "AI_REVIEW_JOB_NOT_RUNNING",
          "only running ai review job can be cancelled");
    }
    String reason = request == null || request.reason() == null || request.reason().isBlank()
        ? "manual cancel and requeue"
        : request.reason().trim();
    aiReviewRepository.cancelRunning(job.id(), reason);
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.cancel",
        job.status(),
        "pending",
        reason,
        Map.of("jobId", job.id(), "status", job.status(), "runToken", nullToEmpty(job.runToken())),
        Map.of("jobId", job.id(), "status", "pending", "runTokenInvalidated", true),
        null);
    return toResponse(lockJob(job.id()));
  }

  public AiReviewResultResponse getResult(Authentication authentication, long annotationId) {
    requireAiManager(authentication);
    return aiReviewRepository.findResultByAnnotation(annotationId)
        .map(this::toResultResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_RESULT_NOT_FOUND", "ai review result not found"));
  }

  public AiReviewRepository.AiReviewRuleRecord resolveEnabledRule(Long explicitRuleId, Long taskId) {
    if (explicitRuleId != null) {
      return aiReviewRepository.findEnabledRule(explicitRuleId)
          .orElseThrow(() -> new ApiException(
              HttpStatus.CONFLICT,
              "AI_REVIEW_RULE_NOT_AVAILABLE",
              "selected ai review rule is not enabled"));
    }
    return aiReviewRepository.findDefaultEnabledRule(taskId)
        .orElseThrow(() -> new ApiException(
            HttpStatus.CONFLICT,
            "AI_REVIEW_RULE_REQUIRED",
            "enabled ai review rule is required"));
  }

  public String writeRuleSnapshot(AiReviewRepository.AiReviewRuleRecord rule) {
    ObjectNode node = objectMapper.createObjectNode();
    node.put("ruleId", Long.toString(rule.id()));
    node.put("name", rule.name());
    if (rule.scopeTaskId() != null) {
      node.put("scopeTaskId", Long.toString(rule.scopeTaskId()));
      node.put("scopeTaskTitle", rule.scopeTaskTitle());
    }
    node.put("promptTemplate", rule.promptTemplate());
    node.set("dimensions", readJson(rule.dimensionsJson()));
    node.put("passThreshold", rule.passThreshold());
    node.put("needHumanThreshold", rule.needHumanThreshold());
    node.put("maxRetry", rule.maxRetry());
    node.put("retryBackoffSec", rule.retryBackoffSec());
    node.put("version", rule.version());
    return writeJson(node);
  }

  private ValidRuleInput validateRuleInput(AiReviewRuleRequest request) {
    if (request == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "ai review rule request is required");
    }
    String name = request.name() == null ? "" : request.name().trim();
    String promptTemplate = request.promptTemplate() == null ? "" : request.promptTemplate().trim();
    if (name.isBlank() || promptTemplate.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "rule name and prompt are required");
    }
    List<AiReviewDimension> dimensions = request.dimensions() == null ? List.of() : request.dimensions();
    if (dimensions.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "at least one dimension is required");
    }
    double weightSum = 0;
    for (AiReviewDimension dimension : dimensions) {
      if (dimension.key() == null || dimension.key().isBlank()
          || dimension.label() == null || dimension.label().isBlank()) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "dimension key and label are required");
      }
      if (dimension.weight() <= 0 || dimension.maxScore() <= 0) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "dimension weight and maxScore must be positive");
      }
      weightSum += dimension.weight();
    }
    if (Math.abs(weightSum - 1.0) > 0.001) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "dimension weights must sum to 1");
    }
    double passThreshold = request.passThreshold() <= 0 ? 4.0 : request.passThreshold();
    double needHumanThreshold = request.needHumanThreshold() <= 0 ? 3.0 : request.needHumanThreshold();
    if (passThreshold <= needHumanThreshold) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "passThreshold must be greater than needHumanThreshold");
    }
    int maxRetry = Math.max(0, request.maxRetry());
    int retryBackoffSec = request.retryBackoffSec() <= 0 ? 30 : request.retryBackoffSec();
    Long scopeTaskId = parseOptionalLong(request.scopeTaskId(), "INVALID_TASK_ID");
    return new ValidRuleInput(
        name,
        scopeTaskId,
        promptTemplate,
        writeDimensions(dimensions),
        passThreshold,
        needHumanThreshold,
        maxRetry,
        retryBackoffSec,
        normalizeRuleStatus(request.status()));
  }

  private void validateScores(JsonNode scores, String ruleSnapshotJson) {
    if (scores == null || !scores.isObject()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RESULT", "scores must be an object");
    }
    for (AiReviewDimension dimension : parseDimensionsFromSnapshot(ruleSnapshotJson)) {
      JsonNode value = scores.get(dimension.key());
      if (value == null || !value.isNumber()) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RESULT", "score missing for dimension " + dimension.key());
      }
      double score = value.asDouble();
      if (score < 0 || score > dimension.maxScore()) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RESULT", "score out of range for dimension " + dimension.key());
      }
    }
  }

  private double calculateTotalScore(JsonNode scores, String ruleSnapshotJson) {
    validateScores(scores, ruleSnapshotJson);
    double total = 0;
    for (AiReviewDimension dimension : parseDimensionsFromSnapshot(ruleSnapshotJson)) {
      total += scores.path(dimension.key()).asDouble() * dimension.weight();
    }
    return Math.round(total * 10000.0) / 10000.0;
  }

  private List<AiReviewDimension> parseDimensionsFromSnapshot(String ruleSnapshotJson) {
    JsonNode snapshot = readJson(ruleSnapshotJson);
    JsonNode dimensions = snapshot.path("dimensions");
    try {
      return objectMapper.readValue(objectMapper.treeAsTokens(dimensions), DIMENSION_LIST);
    } catch (Exception exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "rule dimensions are invalid");
    }
  }

  private RetryPolicy parseRetryPolicy(String ruleSnapshotJson) {
    JsonNode snapshot = readJson(ruleSnapshotJson);
    return new RetryPolicy(
        snapshot.path("maxRetry").asInt(2),
        snapshot.path("retryBackoffSec").asInt(30));
  }

  private AiReviewRuleResponse toRuleResponse(AiReviewRepository.AiReviewRuleRecord record) {
    return new AiReviewRuleResponse(
        Long.toString(record.id()),
        record.name(),
        record.scopeTaskId() == null ? null : Long.toString(record.scopeTaskId()),
        record.scopeTaskTitle(),
        record.promptTemplate(),
        readDimensions(record.dimensionsJson()),
        record.passThreshold(),
        record.needHumanThreshold(),
        record.maxRetry(),
        record.retryBackoffSec(),
        record.status(),
        record.version(),
        formatDateTime(record.updatedAt()),
        record.createdByName());
  }

  private AiReviewJobResponse toResponse(AiReviewRepository.AiReviewJobRecord record) {
    return new AiReviewJobResponse(
        Long.toString(record.id()),
        Long.toString(record.annotationId()),
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.ruleId() == null ? null : Long.toString(record.ruleId()),
        record.ruleName(),
        normalizeFrontendJobStatus(record.status()),
        record.decision(),
        record.totalScore(),
        record.retryCount(),
        record.errorSummary(),
        formatDateTime(record.createdAt()),
        formatDateTime(record.availableAt()),
        formatDateTime(record.startedAt()),
        formatDateTime(record.finishedAt()));
  }

  private AiReviewResultResponse toResultResponse(AiReviewRepository.AiReviewResultRecord record) {
    return new AiReviewResultResponse(
        readMap(record.scoresJson()),
        record.totalScore() == null ? 0 : record.totalScore(),
        record.decision(),
        record.comment(),
        readStringList(record.riskFlagsJson()),
        readStringList(record.evidenceJson()),
        record.promptSnapshot(),
        readJson(record.responseJson()),
        record.modelName(),
        record.latencyMs());
  }

  private ObjectNode buildRawPayload(AiReviewRepository.AiReviewJobPayloadRecord payload) {
    JsonNode parsed = readJson(payload.rawPayloadJson());
    ObjectNode raw = parsed.isObject()
        ? ((ObjectNode) parsed).deepCopy()
        : objectMapper.createObjectNode().put("value", parsed.asText(""));
    raw.put("media_type", payload.mediaType() == null || payload.mediaType().isBlank() ? "text" : payload.mediaType());
    if (payload.mediaUrl() != null && !payload.mediaUrl().isBlank()) {
      raw.put("media_url", payload.mediaUrl());
    }
    if (payload.contentMarkdown() != null && !payload.contentMarkdown().isBlank()) {
      raw.put("content_markdown", payload.contentMarkdown());
    }
    return raw;
  }

  private AiReviewRepository.AiReviewJobRecord lockJob(long jobId) {
    return aiReviewRepository.lockJob(jobId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_JOB_NOT_FOUND", "ai review job not found"));
  }

  private void ensureFreshRunToken(
      Authentication authentication,
      AiReviewRepository.AiReviewJobRecord job,
      String requestRunToken,
      String action) {
    String current = job.runToken();
    if (current != null && !current.isBlank() && current.equals(requestRunToken)) {
      return;
    }
    AuthenticatedUser operator = requireAiOperator(authentication);
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.stale_writeback_rejected",
        job.status(),
        job.status(),
        "stale ai review " + action + " writeback rejected",
        Map.of("jobId", job.id(), "status", job.status(), "runToken", nullToEmpty(current)),
        Map.of("jobId", job.id(), "status", job.status(), "requestRunToken", nullToEmpty(requestRunToken)),
        null);
    throw new ApiException(
        HttpStatus.CONFLICT,
        "AI_REVIEW_RUN_STALE",
        "ai review job run token is stale");
  }

  private AuthenticatedUser requireAiManager(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (principal.roles().stream().noneMatch(role -> List.of("owner", "reviewer", "ai_reviewer").contains(role))) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "ai review manager role is required");
    }
    return principal;
  }

  private AuthenticatedUser requireRuleManager(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required to manage ai review rules");
    }
    return principal;
  }

  private AuthenticatedUser requireAiOperator(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (principal.roles().stream().noneMatch(role -> List.of("system_agent", "ai_reviewer", "reviewer", "owner").contains(role))) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "ai review operator role is required");
    }
    return principal;
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    return principal;
  }

  private String resolveOperatorRole(AuthenticatedUser operator) {
    for (String role : List.of("system_agent", "ai_reviewer", "reviewer", "owner")) {
      if (operator.roles().contains(role)) {
        return role;
      }
    }
    return "system_agent";
  }

  private String nullToEmpty(String value) {
    return value == null ? "" : value;
  }

  private String normalizeDecision(String decision) {
    if (decision == null || decision.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_DECISION", "ai review decision is required");
    }
    String normalized = decision.trim().toUpperCase(Locale.ROOT);
    if (!List.of("PASS", "REJECT", "NEED_HUMAN_REVIEW").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_DECISION", "unsupported ai review decision");
    }
    return normalized;
  }

  private String normalizeRuleStatus(String status) {
    if (status == null || status.isBlank()) {
      return "enabled";
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (!List.of("enabled", "disabled").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE_STATUS", "unsupported rule status");
    }
    return normalized;
  }

  private String normalizeRuleStatusFilter(String status) {
    return status == null || status.isBlank() ? null : normalizeRuleStatus(status);
  }

  private String normalizeJobStatusFilter(String status) {
    if (status == null || status.isBlank()) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if ("success".equals(normalized)) {
      normalized = "succeeded";
    }
    if (!List.of("pending", "running", "succeeded", "failed").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_JOB_STATUS", "unsupported job status");
    }
    return normalized;
  }

  private String normalizeFrontendJobStatus(String status) {
    return "succeeded".equals(status) ? "success" : status;
  }

  private Long parseOptionalLong(String value, String code) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(value.trim());
    } catch (NumberFormatException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id format is invalid");
    }
  }

  private List<Long> parseJobIds(List<String> values) {
    if (values == null || values.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_JOB_IDS", "jobIds are required");
    }
    return values.stream()
        .filter(value -> value != null && !value.isBlank())
        .distinct()
        .map(value -> parseOptionalLong(value, "INVALID_AI_REVIEW_JOB_ID"))
        .toList();
  }

  private List<AiReviewDimension> readDimensions(String json) {
    try {
      return objectMapper.readValue(json, DIMENSION_LIST);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "rule dimensions are invalid");
    }
  }

  private String writeDimensions(List<AiReviewDimension> dimensions) {
    try {
      return objectMapper.writeValueAsString(dimensions);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_RULE", "rule dimensions cannot be serialized");
    }
  }

  private Map<String, Double> readMap(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    try {
      return objectMapper.readValue(json, SCORE_MAP);
    } catch (JsonProcessingException exception) {
      return Map.of();
    }
  }

  private List<String> readStringList(String json) {
    if (json == null || json.isBlank()) {
      return List.of();
    }
    try {
      return objectMapper.readValue(json, STRING_LIST);
    } catch (JsonProcessingException exception) {
      return List.of();
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

  private String writeNullableJson(JsonNode node) {
    if (node == null || node.isNull()) {
      return null;
    }
    return writeJson(node);
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private record ValidRuleInput(
      String name,
      Long scopeTaskId,
      String promptTemplate,
      String dimensionsJson,
      double passThreshold,
      double needHumanThreshold,
      int maxRetry,
      int retryBackoffSec,
      String status) {}

  private record RetryPolicy(int maxRetry, int retryBackoffSec) {}
}
