package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.auth.AuthRepository;
import com.labelhub.backend.auth.UserAccount;
import com.labelhub.backend.ai.AiReviewRepository;
import com.labelhub.backend.ai.AiReviewService;
import com.labelhub.backend.dataset.DatasetRecord;
import com.labelhub.backend.dataset.DatasetRepository;
import com.labelhub.backend.schema.SchemaRecord;
import com.labelhub.backend.schema.SchemaRepository;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskService {

  private static final Set<String> CREATE_STATES = Set.of("draft", "published");
  private static final Set<String> TASK_STATES = Set.of("draft", "published", "paused", "ended");
  private static final Set<String> ASSIGNMENT_STATUSES =
      Set.of("claimed", "submitted", "returned", "accepted");
  private static final Set<String> MEDIA_TYPES = Set.of("text", "image", "video", "markdown");
  private static final Set<String> PUBLISHED_STRATEGIES = Set.of("first-come", "assigned", "quota");
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final DateTimeFormatter DATE_TIME_SECONDS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
  private static final Pattern NUMBER_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)");

  private final AuthRepository authRepository;
  private final DatasetRepository datasetRepository;
  private final TaskRepository taskRepository;
  private final SchemaRepository schemaRepository;
  private final AiReviewService aiReviewService;
  private final TaskDeadlineSettlementService deadlineSettlementService;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public TaskService(
      AuthRepository authRepository,
      DatasetRepository datasetRepository,
      TaskRepository taskRepository,
      SchemaRepository schemaRepository,
      AiReviewService aiReviewService,
      TaskDeadlineSettlementService deadlineSettlementService,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.authRepository = authRepository;
    this.datasetRepository = datasetRepository;
    this.taskRepository = taskRepository;
    this.schemaRepository = schemaRepository;
    this.aiReviewService = aiReviewService;
    this.deadlineSettlementService = deadlineSettlementService;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public OwnerTaskResponse createTask(Authentication authentication, CreateTaskRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    String state = normalizeState(request.status(), "published", CREATE_STATES);
    DatasetRecord dataset = resolveSelectedDataset(owner.id(), request.datasetId());
    List<Long> taskItemIds = resolveTaskItemScope(owner.id(), dataset, request, state, null);
    Integer taskQuota = resolveTaskQuota(request.quota(), taskItemIds);
    TaskMetadata metadata = buildTaskMetadata(owner.id(), request, dataset, state, null);
    List<TaskRepository.UserAllocationRecord> labelerAllocations =
        resolveLabelerAllocations(request, metadata, taskItemIds.size(), null);
    List<TaskRepository.UserAllocationRecord> reviewerAllocations =
        resolveReviewerAllocations(request, taskItemIds.size(), null);
    validatePublishedSchemaConfiguration(owner.id(), metadata, state, null);
    validateStrategyConfiguration(metadata, state, taskItemIds.size(), labelerAllocations, reviewerAllocations);

    long taskId = taskRepository.createTask(
        owner.id(),
        request.title().trim(),
        resolveDescription(request.description()),
        state,
        taskQuota,
        parseDeadline(request.deadline()),
        metadata,
        parseSchemaVersion(request.schema()));
    bindDatasetToTask(dataset, taskId);
    syncTaskScopeAndAllocations(taskId, taskItemIds, labelerAllocations, reviewerAllocations);
    auditTaskCreation(taskId, owner, state);
    ensureStrategyAssignments(taskId, metadata, taskQuota, state, owner);

    return taskRepository.findTask(taskId)
        .map(this::toOwnerResponse)
        .orElseThrow(() -> new IllegalStateException("failed to load created task"));
  }

  @Transactional
  public OwnerTaskResponse updateTask(
      Authentication authentication,
      long taskId,
      CreateTaskRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    deadlineSettlementService.settleExpiredTasks();
    TaskRecord existing = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    if (existing.ownerId() != owner.id()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    ensureTaskNotDeleted(existing);

    String state = normalizeState(request.status(), existing.status(), TASK_STATES);
    LocalDateTime deadline = parseDeadline(request.deadline());
    validateRenewedPublish(existing.status(), state, deadline);
    stateMachineService.validate(WorkflowEntityType.TASK, existing.status(), state, "owner");
    DatasetRecord dataset = resolveSelectedDataset(owner.id(), request.datasetId());
    boolean renewingEndedTask = "ended".equals(existing.status()) && "published".equals(state);
    List<Long> taskItemIds = resolveTaskItemScope(owner.id(), dataset, request, state, existing);
    Integer taskQuota = resolveTaskQuota(request.quota(), taskItemIds);
    TaskMetadata metadata = buildTaskMetadata(
        owner.id(),
        request,
        dataset,
        state,
        readMetadata(existing.rewardRuleJson()),
        renewingEndedTask);
    List<TaskRepository.UserAllocationRecord> labelerAllocations =
        resolveLabelerAllocations(request, metadata, taskItemIds.size(), taskRepository.listLabelerAllocations(taskId));
    List<TaskRepository.UserAllocationRecord> reviewerAllocations =
        resolveReviewerAllocations(request, taskItemIds.size(), taskRepository.listReviewerAllocations(taskId));
    ensureConfigMutable(existing, taskItemIds, labelerAllocations, reviewerAllocations);
    validatePublishedSchemaConfiguration(owner.id(), metadata, state, existing, existing.status());
    validateStrategyConfiguration(metadata, state, taskItemIds.size(), labelerAllocations, reviewerAllocations);

    int updated = taskRepository.updateTask(
        owner.id(),
        taskId,
        request.title().trim(),
        resolveDescription(request.description()),
        state,
        taskQuota,
        deadline,
        metadata);
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    taskRepository.updateLatestSchemaState(taskId, state);
    bindDatasetToTask(dataset, taskId);
    syncTaskScopeAndAllocations(taskId, taskItemIds, labelerAllocations, reviewerAllocations);
    auditTaskTransition(existing, owner, state);
    ensureStrategyAssignments(taskId, metadata, taskQuota, state, owner);

    return taskRepository.findTask(taskId)
        .map(this::toOwnerResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
  }

  public PageResponse<OwnerTaskResponse> listOwnerTasks(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    deadlineSettlementService.settleExpiredTasks();
    List<OwnerTaskResponse> items = taskRepository.listOwnerTasks(owner.id()).stream()
        .map(this::toOwnerResponse)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
  }

  public OwnerTaskDetailResponse getTaskDetail(Authentication authentication, long taskId) {
    AuthenticatedUser owner = requireOwner(authentication);
    TaskRecord task = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    if (task.ownerId() != owner.id()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    TaskMetadata metadata = readMetadata(task.rewardRuleJson());
    List<Long> taskItemIds = taskRepository.listTaskItemIds(taskId);
    List<TaskRepository.UserAllocationRecord> labelerAllocations = taskRepository.listLabelerAllocations(taskId);
    if (labelerAllocations.isEmpty() && "assigned".equals(metadata.resolvedStrategy())) {
      labelerAllocations = splitEvenly(metadata.resolvedAssignedLabelerIds(), taskItemIds.size());
    }
    return new OwnerTaskDetailResponse(
        toOwnerResponse(task),
        metadata.resolvedItemSelectionMode(),
        taskItemIds.stream().map(String::valueOf).toList(),
        labelerAllocations.stream()
            .map(this::toTaskUserAllocationResponse)
            .toList(),
        taskRepository.listReviewerAllocations(taskId).stream()
            .map(this::toTaskUserAllocationResponse)
            .toList());
  }

  @Transactional
  public void deleteTask(Authentication authentication, long taskId) {
    AuthenticatedUser owner = requireOwner(authentication);
    TaskRecord existing = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    if (existing.ownerId() != owner.id()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    if (existing.deletedAt() != null) {
      return;
    }
    List<TaskRepository.TaskAssignmentStateRecord> assignments =
        taskRepository.listTaskAssignmentStates(taskId);
    List<TaskRepository.TaskAnnotationStateRecord> annotations =
        taskRepository.listTaskAnnotationStates(taskId);
    int deleted = taskRepository.deleteTask(owner.id(), taskId);
    if (deleted == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    taskRepository.voidTaskAnnotations(taskId);
    taskRepository.voidTaskAssignments(taskId);
    taskRepository.deleteTaskDrafts(taskId);
    auditTaskDeletion(existing, owner, assignments.size(), annotations.size());
    assignments.forEach(record -> auditAssignmentVoided(record, owner, taskId));
    annotations.forEach(record -> auditAnnotationVoided(record, owner, taskId));
  }

  public List<AssignableLabelerResponse> listAssignableLabelers(Authentication authentication) {
    requireOwner(authentication);
    return authRepository.listUsersByRoleCode("labeler").stream()
        .map(user -> new AssignableLabelerResponse(
            Long.toString(user.id()),
            user.username(),
            user.name()))
        .toList();
  }

  public List<AssignableLabelerResponse> listAssignableReviewers(Authentication authentication) {
    requireOwner(authentication);
    return authRepository.listUsersByRoleCode("reviewer").stream()
        .map(user -> new AssignableLabelerResponse(
            Long.toString(user.id()),
            user.username(),
            user.name()))
        .toList();
  }

  @Transactional
  public OwnerTaskResponse updateState(
      Authentication authentication,
      long taskId,
      UpdateTaskStateRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    deadlineSettlementService.settleExpiredTasks();
    String state = normalizeState(request.state(), null, TASK_STATES);
    TaskRecord existing = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    if (existing.ownerId() != owner.id()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    ensureTaskNotDeleted(existing);
    if ("published".equals(state) && "ended".equals(existing.status())) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "DEADLINE_REQUIRED",
          "renew ended task through task edit with a future deadline");
    }
    validatePublishedSchemaConfiguration(owner.id(), readMetadata(existing.rewardRuleJson()), state, existing, existing.status());
    stateMachineService.validate(WorkflowEntityType.TASK, existing.status(), state, "owner");
    int updated = taskRepository.updateTaskState(owner.id(), taskId, state);
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    taskRepository.updateLatestSchemaState(taskId, state);
    auditTaskTransition(existing, owner, state);
    return taskRepository.findTask(taskId)
        .map(this::toOwnerResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
  }

  public PageResponse<MarketTaskResponse> listMarketTasks(
      Authentication authentication,
      String keyword,
      String taskType,
      String strategy,
      String mediaType,
      String aiReview,
      String sortBy,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    deadlineSettlementService.settleExpiredTasks();
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    String normalizedTaskType = normalizeTaskTypeFilter(taskType);
    String normalizedStrategy = normalizeStrategyFilter(strategy);
    String normalizedMediaType = normalizeMediaTypeFilter(mediaType);
    String normalizedAiReview = normalizeAiReviewFilter(aiReview);
    String orderBy = resolveMarketOrderBy(sortBy);
    long total = taskRepository.countMarketTasks(
        keyword,
        normalizedTaskType,
        normalizedStrategy,
        normalizedMediaType,
        normalizedAiReview);
    List<MarketTaskResponse> items = taskRepository.listMarketTasks(
            keyword,
            normalizedTaskType,
            normalizedStrategy,
            normalizedMediaType,
            normalizedAiReview,
            orderBy,
            (safePage - 1) * safePageSize,
            safePageSize)
        .stream()
        .map(record -> toMarketResponse(record, principal.id()))
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  public MarketTaskStatsResponse getMarketTaskStats(Authentication authentication) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    List<TaskRecord> candidates = taskRepository.listMarketTaskCandidates();
    long availableTasks = 0;
    long expiringSoonTasks = 0;
    double rewardTotal = 0D;
    LocalDateTime now = LocalDateTime.now();
    LocalDateTime soonBoundary = now.plusHours(48);

    for (TaskRecord task : candidates) {
      TaskMetadata metadata = readMetadata(task.rewardRuleJson());
      if (!isMarketTaskAvailableForLabeler(task, metadata, labeler.id())) {
        continue;
      }
      availableTasks++;
      rewardTotal += metadata.rewardPerItem() == null ? 0D : metadata.rewardPerItem();
      if (task.deadline() != null && task.deadline().isAfter(now) && !task.deadline().isAfter(soonBoundary)) {
        expiringSoonTasks++;
      }
    }

    double avgRewardPerItem = availableTasks == 0 ? 0D : rewardTotal / availableTasks;
    return new MarketTaskStatsResponse(
        availableTasks,
        roundMoney(avgRewardPerItem),
        expiringSoonTasks);
  }

  @Transactional
  public AssignmentResponse claimTask(Authentication authentication, long taskId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    if (!taskRepository.lockTask(taskId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }

    TaskRecord task = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    TaskMetadata metadata = readMetadata(task.rewardRuleJson());
    validateClaimableTask(task, metadata);
    boolean alreadyClaimed = taskRepository.hasTaskAssignment(taskId, labeler.id());
    if (!"assigned".equals(metadata.resolvedStrategy())) {
      createAssignmentsForStrategy(task, metadata, labeler.id(), !alreadyClaimed, labeler, "labeler");
    }
    return taskRepository.findAssignmentForLabelerTask(taskId, labeler.id())
        .map(this::toAssignmentResponse)
        .orElseGet(() -> createAssignmentForStrategy(task, labeler));
  }

  @Transactional
  public PageResponse<AssignmentResponse> listMyAssignments(
      Authentication authentication,
      String status) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    String normalizedStatus = normalizeAssignmentStatus(status);
    if (normalizedStatus == null) {
      backfillExistingTaskAssignments(labeler.id());
    }
    List<AssignmentResponse> items = taskRepository
        .listLabelerAssignments(labeler.id(), normalizedStatus)
        .stream()
        .map(this::toAssignmentResponse)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
  }

  @Transactional
  public void backfillAssignmentsForLabelerTask(long labelerId, long taskId) {
    if (!taskRepository.hasTaskAssignment(taskId, labelerId) || !taskRepository.lockTask(taskId)) {
      return;
    }
    TaskRecord task = taskRepository.findTask(taskId).orElse(null);
    if (task == null || !canCreateMoreAssignments(task)) {
      return;
    }
    TaskMetadata metadata = readMetadata(task.rewardRuleJson());
    try {
      validateClaimableTask(task, metadata);
    } catch (ApiException exception) {
      if ("SCHEMA_WITHDRAWN".equals(exception.getCode())) {
        return;
      }
      throw exception;
    }
    if ("assigned".equals(metadata.resolvedStrategy())) {
      ensureStrategyAssignments(task.id(), metadata, task.quota(), task.status(), null);
    } else {
      createAssignmentsForStrategy(task, metadata, labelerId, false, null, "labeler");
    }
  }

  private TaskMetadata buildTaskMetadata(
      long ownerId,
      CreateTaskRequest request,
      DatasetRecord dataset,
      String state,
      TaskMetadata fallbackMetadata) {
    return buildTaskMetadata(ownerId, request, dataset, state, fallbackMetadata, false);
  }

  private TaskMetadata buildTaskMetadata(
      long ownerId,
      CreateTaskRequest request,
      DatasetRecord dataset,
      String state,
      TaskMetadata fallbackMetadata,
      boolean allowEndedSchema) {
    SchemaSelection selectedSchema = resolveSelectedSchema(ownerId, request.schemaVersionId(), allowEndedSchema);
    String schemaLabel = blankToNull(request.schema());
    Long schemaVersionId = null;
    Integer schemaVersion = null;
    if (selectedSchema != null) {
      schemaVersionId = selectedSchema.id();
      schemaVersion = selectedSchema.version();
      if (schemaLabel == null) {
        schemaLabel = selectedSchema.label();
      }
    } else if (request.schemaVersionId() == null && fallbackMetadata != null) {
      schemaVersionId = fallbackMetadata.schemaVersionId();
      schemaVersion = fallbackMetadata.schemaVersion();
      if (schemaLabel == null) {
        schemaLabel = fallbackMetadata.schema();
      }
    }

    AiReviewRuleSelection aiReviewRule = resolveAiReviewRuleSelection(
        request.aiReviewEnabled(),
        request.aiReviewRuleId(),
        "published".equals(state),
        fallbackMetadata);
    List<Long> assignedLabelerIds = resolveAssignedLabelerIds(request);
    if (assignedLabelerIds.isEmpty()
        && fallbackMetadata != null
        && request.assignedLabelerIds() == null
        && request.labelerAllocations() == null) {
      assignedLabelerIds = fallbackMetadata.resolvedAssignedLabelerIds();
    }

    return new TaskMetadata(
        normalizeTags(request.tags()),
        blankToNull(request.reward()),
        normalizeStrategy(request.strategy()),
        dataset == null ? null : dataset.id(),
        request.maxClaimPerUser(),
        assignedLabelerIds,
        schemaLabel,
        schemaVersionId,
        schemaVersion,
        request.aiReviewEnabled(),
        aiReviewRule.ruleId(),
        aiReviewRule.ruleName(),
        request.llmAssistEnabled() == null
            ? fallbackMetadata == null || fallbackMetadata.resolvedLlmAssistEnabled()
            : request.llmAssistEnabled(),
        request.itemSelectionMode() == null && fallbackMetadata != null
            ? fallbackMetadata.resolvedItemSelectionMode()
            : normalizeItemSelectionMode(request.itemSelectionMode()),
        resolveTaskType(request),
        resolveRewardPerItem(request.reward()));
  }

  private AiReviewRuleSelection resolveAiReviewRuleSelection(
      Boolean aiReviewEnabled,
      String requestedRuleId,
      boolean requireRule,
      TaskMetadata fallbackMetadata) {
    boolean enabled = aiReviewEnabled == null || aiReviewEnabled;
    if (!enabled) {
      return new AiReviewRuleSelection(null, null);
    }
    Long ruleId = null;
    if (requestedRuleId != null && !requestedRuleId.isBlank()) {
      ruleId = parseLongId(requestedRuleId.trim(), "INVALID_AI_REVIEW_RULE_ID");
    } else if (fallbackMetadata != null) {
      ruleId = fallbackMetadata.aiReviewRuleId();
    }
    if (ruleId == null && !requireRule) {
      return new AiReviewRuleSelection(null, null);
    }
    AiReviewRepository.AiReviewRuleRecord rule = aiReviewService.resolveEnabledRule(ruleId, null);
    return new AiReviewRuleSelection(rule.id(), rule.name());
  }

  private DatasetRecord resolveSelectedDataset(long ownerId, String datasetIdValue) {
    if (datasetIdValue == null || datasetIdValue.isBlank()) {
      return null;
    }
    long datasetId = parseLongId(datasetIdValue, "INVALID_DATASET_ID");
    return datasetRepository.findOwnerDataset(ownerId, datasetId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DATASET_NOT_FOUND", "dataset not found"));
  }

  private SchemaSelection resolveSelectedSchema(long ownerId, String schemaVersionIdValue) {
    return resolveSelectedSchema(ownerId, schemaVersionIdValue, false);
  }

  private SchemaSelection resolveSelectedSchema(long ownerId, String schemaVersionIdValue, boolean allowEndedSchema) {
    if (schemaVersionIdValue == null || schemaVersionIdValue.isBlank()) {
      return null;
    }
    long schemaVersionId = parseLongId(schemaVersionIdValue, "INVALID_SCHEMA_VERSION_ID");
    SchemaRecord schema = schemaRepository.findOwnerSchemaIncludingDeleted(ownerId, schemaVersionId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
    if (!"published".equals(schema.status())
        && !("ended".equals(schema.status()) && allowEndedSchema)
        && schema.deletedAt() == null) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_NOT_PUBLISHED",
          "task can only be associated with a published schema");
    }
    return new SchemaSelection(schema.id(), schema.version(), resolveSchemaLabel(schema));
  }

  private String resolveSchemaLabel(SchemaRecord schema) {
    String name = "未命名模板";
    try {
      JsonNode root = objectMapper.readTree(schema.schemaJson());
      String parsedName = text(root, "name");
      if (parsedName != null && !parsedName.isBlank()) {
        name = parsedName.trim();
      }
    } catch (JsonProcessingException ignored) {
      // Keep a stable fallback label; schema ownership/status has already been validated.
    }
    return name + " (r" + schema.version() + ")";
  }

  private void bindDatasetToTask(DatasetRecord dataset, long taskId) {
    if (dataset != null) {
      datasetRepository.rebindDatasetToTask(dataset.id(), taskId);
    }
  }

  private void validatePublishedSchemaConfiguration(
      long ownerId,
      TaskMetadata metadata,
      String state,
      TaskRecord existing) {
    validatePublishedSchemaConfiguration(ownerId, metadata, state, existing, null);
  }

  private void validatePublishedSchemaConfiguration(
      long ownerId,
      TaskMetadata metadata,
      String state,
      TaskRecord existing,
      String fromState) {
    if (!"published".equals(state)) {
      return;
    }
    Long schemaVersionId = metadata.schemaVersionId() == null && existing != null
        ? existing.schemaVersionId()
        : metadata.schemaVersionId();
    if (schemaVersionId == null) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "SCHEMA_REQUIRED",
          "published task requires a published schema");
    }
    SchemaRecord schema = schemaRepository.findOwnerSchema(ownerId, schemaVersionId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
    if ("ended".equals(fromState) && "ended".equals(schema.status())) {
      return;
    }
    if (!"published".equals(schema.status())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_NOT_PUBLISHED",
          "published task requires a published schema");
    }
  }

  private void validateRenewedPublish(String fromState, String toState, LocalDateTime deadline) {
    if (!"ended".equals(fromState) || !"published".equals(toState)) {
      return;
    }
    if (deadline == null || !deadline.isAfter(LocalDateTime.now())) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_DEADLINE",
          "renewed published task requires a future deadline");
    }
  }

  private void validateStrategyConfiguration(
      TaskMetadata metadata,
      String state,
      int itemCount,
      List<TaskRepository.UserAllocationRecord> labelerAllocations,
      List<TaskRepository.UserAllocationRecord> reviewerAllocations) {
    if (!PUBLISHED_STRATEGIES.contains(metadata.resolvedStrategy())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ASSIGN_STRATEGY", "unsupported assign strategy");
    }
    if (!"published".equals(state)) {
      return;
    }
    if (itemCount <= 0) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "TASK_ITEMS_REQUIRED", "published task requires at least one item");
    }
    if ("assigned".equals(metadata.resolvedStrategy()) && labelerAllocations.isEmpty()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "ASSIGNED_LABELERS_REQUIRED",
          "assigned strategy requires at least one labeler");
    }
    if ("assigned".equals(metadata.resolvedStrategy()) && sumAllocations(labelerAllocations) != itemCount) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "LABELER_ALLOCATION_MISMATCH",
          "labeler allocation total must equal task item count");
    }
    if ("quota".equals(metadata.resolvedStrategy()) && metadata.resolvedMaxClaimPerUser() == null) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "MAX_CLAIM_PER_USER_REQUIRED",
          "quota strategy requires max claim per user");
    }
    if (reviewerAllocations.isEmpty()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "REVIEWERS_REQUIRED",
          "published task requires at least one reviewer");
    }
    if (sumAllocations(reviewerAllocations) != itemCount) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "REVIEWER_ALLOCATION_MISMATCH",
          "reviewer allocation total must equal task item count");
    }
  }

  private List<Long> resolveTaskItemScope(
      long ownerId,
      DatasetRecord dataset,
      CreateTaskRequest request,
      String state,
      TaskRecord existing) {
    if (dataset == null) {
      if ("published".equals(state)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "DATASET_REQUIRED", "published task requires dataset");
      }
      return existing == null ? List.of() : taskRepository.listTaskItemIds(existing.id());
    }
    if (request.itemSelectionMode() == null
        && request.selectedItemIds() == null
        && existing != null
        && taskRepository.hasTaskItemSnapshot(existing.id())) {
      return taskRepository.listTaskItemIds(existing.id());
    }
    List<Long> datasetItemIds = datasetRepository.listDatasetItemIds(ownerId, dataset.id());
    String mode = normalizeItemSelectionMode(request.itemSelectionMode());
    if ("all".equals(mode)) {
      return datasetItemIds;
    }
    List<Long> selected = parseLongIds(request.selectedItemIds(), "INVALID_ITEM_ID");
    if (selected.isEmpty()) {
      if ("published".equals(state)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "TASK_ITEMS_REQUIRED", "partial item selection is empty");
      }
      return List.of();
    }
    Set<Long> allowed = new LinkedHashSet<>(datasetItemIds);
    for (long itemId : selected) {
      if (!allowed.contains(itemId)) {
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "ITEM_NOT_IN_DATASET",
            "selected item does not belong to dataset");
      }
    }
    return selected;
  }

  private Integer resolveTaskQuota(Integer requestedQuota, List<Long> taskItemIds) {
    if (taskItemIds != null && !taskItemIds.isEmpty()) {
      return taskItemIds.size();
    }
    return requestedQuota;
  }

  private List<TaskRepository.UserAllocationRecord> resolveLabelerAllocations(
      CreateTaskRequest request,
      TaskMetadata metadata,
      int itemCount,
      List<TaskRepository.UserAllocationRecord> fallback) {
    if (request.labelerAllocations() == null && fallback != null && !fallback.isEmpty()) {
      return fallback;
    }
    List<TaskRepository.UserAllocationRecord> allocations =
        parseUserAllocations(request.labelerAllocations(), "INVALID_LABELER_ID");
    if (allocations.isEmpty() && "assigned".equals(metadata.resolvedStrategy())) {
      List<Long> labelerIds = metadata.resolvedAssignedLabelerIds();
      allocations = splitEvenly(labelerIds, itemCount);
    }
    for (TaskRepository.UserAllocationRecord allocation : allocations) {
      ensureAssignableLabeler(allocation.userId());
    }
    return allocations;
  }

  private List<TaskRepository.UserAllocationRecord> resolveReviewerAllocations(
      CreateTaskRequest request,
      int itemCount,
      List<TaskRepository.UserAllocationRecord> fallback) {
    if (request.reviewerAllocations() == null && fallback != null && !fallback.isEmpty()) {
      return fallback;
    }
    List<TaskRepository.UserAllocationRecord> allocations =
        parseUserAllocations(request.reviewerAllocations(), "INVALID_REVIEWER_ID");
    if (allocations.isEmpty() && itemCount > 0) {
      List<Long> reviewerIds = authRepository.listUsersByRoleCode("reviewer").stream()
          .map(UserAccount::id)
          .toList();
      allocations = splitEvenly(reviewerIds, itemCount);
    }
    for (TaskRepository.UserAllocationRecord allocation : allocations) {
      ensureAssignableReviewer(allocation.userId());
    }
    return allocations;
  }

  private void ensureConfigMutable(
      TaskRecord existing,
      List<Long> nextItemIds,
      List<TaskRepository.UserAllocationRecord> nextLabelerAllocations,
      List<TaskRepository.UserAllocationRecord> nextReviewerAllocations) {
    if (!taskRepository.hasTaskWork(existing.id())) {
      return;
    }
    if (!sameLongList(taskRepository.listTaskItemIds(existing.id()), nextItemIds)
        || !sameAllocationList(taskRepository.listLabelerAllocations(existing.id()), nextLabelerAllocations)
        || !sameAllocationList(taskRepository.listReviewerAllocations(existing.id()), nextReviewerAllocations)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "TASK_DISTRIBUTION_LOCKED",
          "task item scope or allocation cannot be changed after assignments or annotations exist");
    }
  }

  private void syncTaskScopeAndAllocations(
      long taskId,
      List<Long> itemIds,
      List<TaskRepository.UserAllocationRecord> labelerAllocations,
      List<TaskRepository.UserAllocationRecord> reviewerAllocations) {
    taskRepository.replaceTaskItems(taskId, itemIds);
    taskRepository.replaceLabelerAllocations(taskId, labelerAllocations);
    taskRepository.replaceReviewerAllocations(taskId, reviewerAllocations);
    taskRepository.replaceTaskReviewItems(taskId, buildReviewItemBindings(itemIds, reviewerAllocations));
  }

  private List<TaskRepository.ItemReviewerRecord> buildReviewItemBindings(
      List<Long> itemIds,
      List<TaskRepository.UserAllocationRecord> reviewerAllocations) {
    List<TaskRepository.ItemReviewerRecord> records = new ArrayList<>();
    if (itemIds == null || itemIds.isEmpty() || reviewerAllocations == null || reviewerAllocations.isEmpty()) {
      return records;
    }
    int itemIndex = 0;
    for (TaskRepository.UserAllocationRecord allocation : reviewerAllocations) {
      for (int i = 0; i < allocation.itemCount() && itemIndex < itemIds.size(); i++) {
        records.add(new TaskRepository.ItemReviewerRecord(itemIds.get(itemIndex), allocation.userId()));
        itemIndex++;
      }
    }
    return records;
  }

  private List<TaskRepository.UserAllocationRecord> parseUserAllocations(
      List<UserAllocationRequest> requests,
      String idCode) {
    if (requests == null) {
      return List.of();
    }
    List<TaskRepository.UserAllocationRecord> allocations = new ArrayList<>();
    Set<Long> seen = new LinkedHashSet<>();
    for (UserAllocationRequest request : requests) {
      if (request == null || request.userId() == null || request.userId().isBlank()) {
        continue;
      }
      long userId = parseLongId(request.userId(), idCode);
      if (!seen.add(userId)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "DUPLICATE_ALLOCATION_USER", "allocation user is duplicated");
      }
      if (request.itemCount() == null || request.itemCount() < 1) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ALLOCATION_COUNT", "allocation count must be greater than 0");
      }
      allocations.add(new TaskRepository.UserAllocationRecord(userId, null, null, request.itemCount()));
    }
    return allocations;
  }

  private List<TaskRepository.UserAllocationRecord> splitEvenly(List<Long> userIds, int itemCount) {
    if (userIds == null || userIds.isEmpty() || itemCount <= 0) {
      return List.of();
    }
    List<TaskRepository.UserAllocationRecord> allocations = new ArrayList<>();
    int base = itemCount / userIds.size();
    int remainder = itemCount % userIds.size();
    for (int index = 0; index < userIds.size(); index++) {
      int count = base + (index < remainder ? 1 : 0);
      if (count > 0) {
        allocations.add(new TaskRepository.UserAllocationRecord(userIds.get(index), null, null, count));
      }
    }
    return allocations;
  }

  private int sumAllocations(List<TaskRepository.UserAllocationRecord> allocations) {
    return allocations == null ? 0 : allocations.stream().mapToInt(TaskRepository.UserAllocationRecord::itemCount).sum();
  }

  private boolean sameLongList(List<Long> left, List<Long> right) {
    return List.copyOf(left == null ? List.of() : left).equals(List.copyOf(right == null ? List.of() : right));
  }

  private boolean sameAllocationList(
      List<TaskRepository.UserAllocationRecord> left,
      List<TaskRepository.UserAllocationRecord> right) {
    Map<Long, Integer> leftMap = toAllocationMap(left);
    Map<Long, Integer> rightMap = toAllocationMap(right);
    return leftMap.equals(rightMap);
  }

  private Map<Long, Integer> toAllocationMap(List<TaskRepository.UserAllocationRecord> allocations) {
    return allocations == null
        ? Map.of()
        : allocations.stream()
            .collect(java.util.stream.Collectors.toMap(
                TaskRepository.UserAllocationRecord::userId,
                TaskRepository.UserAllocationRecord::itemCount));
  }

  private void ensureStrategyAssignments(
      long taskId,
      TaskMetadata metadata,
      Integer quota,
      String state,
      AuthenticatedUser owner) {
    if (!"published".equals(state)
        || !"assigned".equals(metadata.resolvedStrategy())
        || metadata.resolvedAssignedLabelerIds().isEmpty()) {
      return;
    }

    List<Long> labelerIds = metadata.resolvedAssignedLabelerIds();
    List<TaskRepository.UserAllocationRecord> allocations = taskRepository.listLabelerAllocations(taskId);
    for (TaskRepository.UserAllocationRecord allocation : allocations) {
      ensureAssignableLabeler(allocation.userId());
    }
    for (long labelerId : labelerIds) {
      ensureAssignableLabeler(labelerId);
    }

    long existingAssignments = taskRepository.countTaskAssignments(taskId);
    int batchSize = toBatchSize(resolveAssignableRemaining(taskId, quota));
    if (batchSize <= 0) {
      if (existingAssignments == 0) {
        throw noAssignableItemOrQuota(taskId, "assign");
      }
      return;
    }

    if (!allocations.isEmpty()) {
      LocalDateTime lockedUntil = LocalDateTime.now().plusHours(2);
      for (TaskRepository.UserAllocationRecord allocation : allocations) {
        long alreadyAssigned = taskRepository.countLabelerTaskAssignments(taskId, allocation.userId());
        int remaining = (int) Math.max(allocation.itemCount() - alreadyAssigned, 0);
        if (remaining <= 0) {
          continue;
        }
        List<Long> itemIds = taskRepository.findClaimableItems(taskId, remaining);
        if (itemIds.size() < remaining && existingAssignments == 0) {
          throw noAssignableItemOrQuota(taskId, "assign");
        }
        for (long itemId : itemIds) {
          long assignmentId = createAssignmentOrConflict(taskId, itemId, allocation.userId(), lockedUntil);
          auditAssignmentCreation(assignmentId, owner, "owner", taskId, itemId, allocation.userId());
        }
      }
      return;
    }

    List<Long> itemIds = taskRepository.findClaimableItems(taskId, batchSize);
    if (itemIds.isEmpty()) {
      if (existingAssignments == 0) {
        throw new ApiException(
            HttpStatus.CONFLICT,
            "NO_AVAILABLE_ITEM",
            "task has no available item to assign");
      }
      return;
    }

    int startIndex = (int) (existingAssignments % labelerIds.size());
    LocalDateTime lockedUntil = LocalDateTime.now().plusHours(2);
    for (int i = 0; i < itemIds.size(); i++) {
      long labelerId = labelerIds.get((startIndex + i) % labelerIds.size());
      long itemId = itemIds.get(i);
      long assignmentId = createAssignmentOrConflict(taskId, itemId, labelerId, lockedUntil);
      auditAssignmentCreation(assignmentId, owner, "owner", taskId, itemIds.get(i), labelerId);
    }
  }

  private void ensureAssignableLabeler(long labelerId) {
    UserAccount user = authRepository.findUserById(labelerId)
        .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "LABELER_NOT_FOUND", "labeler not found"));
    if (!authRepository.findRoleCodes(user.id()).contains("labeler")) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "LABELER_ROLE_REQUIRED",
          "assigned user must have labeler role");
    }
  }

  private void ensureAssignableReviewer(long reviewerId) {
    UserAccount user = authRepository.findUserById(reviewerId)
        .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "REVIEWER_NOT_FOUND", "reviewer not found"));
    if (!authRepository.findRoleCodes(user.id()).contains("reviewer")) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "REVIEWER_ROLE_REQUIRED",
          "assigned user must have reviewer role");
    }
  }

  private TaskUserAllocationResponse toTaskUserAllocationResponse(TaskRepository.UserAllocationRecord record) {
    return new TaskUserAllocationResponse(
        Long.toString(record.userId()),
        record.username(),
        record.displayName(),
        record.itemCount());
  }

  private OwnerTaskResponse toOwnerResponse(TaskRecord record) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    int totalQuota = record.quota() == null ? 0 : record.quota();
    String datasetId = metadata.datasetId() != null
        ? Long.toString(metadata.datasetId())
        : record.datasetId() == null ? "" : Long.toString(record.datasetId());
    Long schemaVersionId = resolveEffectiveSchemaVersionId(record, metadata);
    return new OwnerTaskResponse(
        Long.toString(record.id()),
        record.title(),
        metadata.resolvedTaskType(),
        "r" + resolveEffectiveSchemaVersion(record, metadata),
        schemaVersionId == null ? "" : Long.toString(schemaVersionId),
        record.ownerName(),
        record.status(),
        metadata.resolvedStrategy(),
        datasetId,
        record.quotaUsed(),
        totalQuota,
        record.annotatedItemCount(),
        record.publishedItemTotal(),
        record.reviewStatus(),
        record.reviewRound(),
        metadata.resolvedMaxClaimPerUser(),
        metadata.resolvedAssignedLabelerIds().stream().map(String::valueOf).toList(),
        formatDateTime(record.createdAt()),
        formatDateTime(record.deadline()),
        metadata.reward(),
        metadata.tags() == null ? List.of() : metadata.tags(),
        record.description(),
        metadata.resolvedAiReviewEnabled(),
        metadata.aiReviewRuleId() == null ? null : Long.toString(metadata.aiReviewRuleId()),
        metadata.aiReviewRuleName(),
        metadata.resolvedLlmAssistEnabled());
  }

  private MarketTaskResponse toMarketResponse(TaskRecord record, long currentUserId) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    int totalQuota = record.quota() == null ? 0 : record.quota();
    int remainingQuota = Math.max(totalQuota - record.quotaUsed(), 0);
    boolean expired = isDeadlineExpired(record.deadline());
    boolean claimable = "published".equals(record.status()) && !expired && remainingQuota > 0;
    String taskType = metadata.resolvedTaskType();
    List<String> mediaTypes = taskRepository.listTaskMediaTypes(record.id());
    Long schemaVersionId = resolveEffectiveSchemaVersionId(record, metadata);
    return new MarketTaskResponse(
        Long.toString(record.id()),
        record.title(),
        taskType,
        toTaskTypeKey(taskType),
        record.description(),
        metadata.tags() == null ? List.of() : metadata.tags(),
        schemaVersionId == null ? "" : Long.toString(schemaVersionId),
        remainingQuota,
        totalQuota,
        formatDateTime(record.deadline()),
        metadata.rewardPerItem(),
        resolveRewardCap(metadata.reward()),
        metadata.resolvedStrategy(),
        mediaTypes.isEmpty() ? List.of("text") : mediaTypes,
        record.ownerName(),
        metadata.resolvedAiReviewEnabled(),
        metadata.resolvedLlmAssistEnabled(),
        metadata.resolvedAiReviewEnabled() ? metadata.aiReviewRuleName() : null,
        formatDateTime(record.publishedAt() == null ? record.createdAt() : record.publishedAt()),
        metadata.resolvedMaxClaimPerUser(),
        taskRepository.hasTaskAssignment(record.id(), currentUserId),
        record.status(),
        expired || "ended".equals(record.status()),
        claimable,
        resolveMarketStatusLabel(record.status(), expired, remainingQuota));
  }

  private AssignmentResponse createAssignmentForStrategy(TaskRecord task, AuthenticatedUser labeler) {
    TaskMetadata metadata = readMetadata(task.rewardRuleJson());
    validateClaimableTask(task, metadata);
    if ("assigned".equals(metadata.resolvedStrategy())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "ASSIGNED_TASK_NOT_CLAIMABLE",
          "assigned task requires a pre-created assignment");
    }

    createAssignmentsForStrategy(task, metadata, labeler.id(), true, labeler, "labeler");
    return taskRepository.findAssignmentForLabelerTask(task.id(), labeler.id())
        .map(this::toAssignmentResponse)
        .orElseThrow(() -> new IllegalStateException("failed to load created assignment"));
  }

  private int createAssignmentsForStrategy(
      TaskRecord task,
      TaskMetadata metadata,
      long labelerId,
      boolean failWhenNoNewAssignment,
      AuthenticatedUser operator,
      String operatorRole) {
    validateClaimableTask(task, metadata);
    String strategy = metadata.resolvedStrategy();
    if ("assigned".equals(strategy)) {
      return 0;
    }

    long taskRemaining = resolveAssignableRemaining(task.id(), task.quota());
    if (taskRemaining <= 0) {
      if (failWhenNoNewAssignment) {
        throw noAssignableItemOrQuota(task.id(), "claim");
      }
      return 0;
    }

    long labelerRemaining = taskRemaining;
    if ("quota".equals(strategy) && metadata.resolvedMaxClaimPerUser() != null) {
      long current = taskRepository.countLabelerTaskAssignments(task.id(), labelerId);
      labelerRemaining = metadata.resolvedMaxClaimPerUser() - current;
      if (labelerRemaining <= 0) {
        if (failWhenNoNewAssignment) {
          throw new ApiException(
              HttpStatus.CONFLICT,
              "TASK_CLAIM_LIMIT_REACHED",
              "task claim limit for current labeler is reached");
        }
        return 0;
      }
    }

    int batchSize = toBatchSize(Math.min(taskRemaining, labelerRemaining));
    List<Long> itemIds = taskRepository.findClaimableItems(task.id(), batchSize);
    if (itemIds.isEmpty()) {
      if (failWhenNoNewAssignment) {
        throw new ApiException(
            HttpStatus.CONFLICT,
            "NO_AVAILABLE_ITEM",
            "task has no available item to claim");
      }
      return 0;
    }

    LocalDateTime lockedUntil = LocalDateTime.now().plusHours(2);
    for (long itemId : itemIds) {
      long assignmentId = createAssignmentOrConflict(task.id(), itemId, labelerId, lockedUntil);
      auditAssignmentCreation(assignmentId, operator, operatorRole, task.id(), itemId, labelerId);
    }
    return itemIds.size();
  }

  private long createAssignmentOrConflict(
      long taskId,
      long itemId,
      long labelerId,
      LocalDateTime lockedUntil) {
    try {
      return taskRepository.createAssignment(taskId, itemId, labelerId, lockedUntil);
    } catch (TaskRepository.DuplicateAssignmentException exception) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "NO_AVAILABLE_ITEM",
          "selected item has already been claimed by current labeler");
    }
  }

  private void backfillExistingTaskAssignments(long labelerId) {
    List<AssignmentRecord> existingAssignments = taskRepository.listLabelerAssignments(labelerId, null);
    List<Long> visitedTaskIds = new ArrayList<>();
    for (AssignmentRecord assignment : existingAssignments) {
      if (visitedTaskIds.contains(assignment.taskId())) {
        continue;
      }
      visitedTaskIds.add(assignment.taskId());
      backfillAssignmentsForLabelerTask(labelerId, assignment.taskId());
    }
  }

  private boolean canCreateMoreAssignments(TaskRecord task) {
    return task.deletedAt() == null
        && "published".equals(task.status())
        && !isDeadlineExpired(task.deadline());
  }

  private boolean isMarketTaskAvailableForLabeler(TaskRecord task, TaskMetadata metadata, long labelerId) {
    if (!canCreateMoreAssignments(task)) {
      return false;
    }

    if ("assigned".equals(metadata.resolvedStrategy())) {
      return taskRepository.findAssignmentForLabelerTask(task.id(), labelerId)
          .filter(assignment -> "claimed".equals(assignment.status()) || "returned".equals(assignment.status()))
          .isPresent();
    }

    long taskRemaining = resolveAssignableRemaining(task.id(), task.quota());
    if (taskRemaining <= 0) {
      return false;
    }

    if ("quota".equals(metadata.resolvedStrategy()) && metadata.resolvedMaxClaimPerUser() != null) {
      long current = taskRepository.countLabelerTaskAssignments(task.id(), labelerId);
      return metadata.resolvedMaxClaimPerUser() - current > 0;
    }
    return true;
  }

  private boolean isDeadlineExpired(LocalDateTime deadline) {
    return deadline != null && !deadline.isAfter(LocalDateTime.now());
  }

  private String resolveMarketStatusLabel(String state, boolean expired, int remainingQuota) {
    if (expired || "ended".equals(state)) {
      return "已截止";
    }
    if ("paused".equals(state)) {
      return "已暂停";
    }
    if (remainingQuota <= 0) {
      return "配额已满";
    }
    return "可认领";
  }

  private long resolveAssignableRemaining(long taskId, Integer quota) {
    long claimableItems = taskRepository.countClaimableItems(taskId);
    if (claimableItems <= 0) {
      return 0;
    }
    if (quota == null) {
      return claimableItems;
    }
    long quotaRemaining = quota - taskRepository.countTaskAssignments(taskId);
    return Math.min(Math.max(quotaRemaining, 0), claimableItems);
  }

  private int toBatchSize(long size) {
    return (int) Math.min(size, Integer.MAX_VALUE);
  }

  private ApiException noAssignableItemOrQuota(long taskId, String action) {
    if (taskRepository.countClaimableItems(taskId) <= 0) {
      String message = "assign".equals(action)
          ? "task has no available item to assign"
          : "task has no available item to claim";
      return new ApiException(HttpStatus.CONFLICT, "NO_AVAILABLE_ITEM", message);
    }
    return new ApiException(HttpStatus.CONFLICT, "TASK_QUOTA_EXHAUSTED", "task quota is exhausted");
  }

  private void validateClaimableTask(TaskRecord task, TaskMetadata metadata) {
    if (task.deletedAt() != null) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_DELETED", "task has been deleted");
    }
    if (!"published".equals(task.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_NOT_PUBLISHED", "task is not published");
    }
    if (isDeadlineExpired(task.deadline())) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_EXPIRED", "task deadline has passed");
    }
    Long schemaVersionId = resolveEffectiveSchemaVersionId(task, metadata);
    if (schemaVersionId == null) {
      throw new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found");
    }
    SchemaRecord schema = schemaRepository.findOwnerSchemaIncludingDeleted(task.ownerId(), schemaVersionId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
    if (!"published".equals(schema.status()) && schema.deletedAt() == null) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_WITHDRAWN",
          "task schema has been withdrawn");
    }
  }

  private void auditTaskCreation(long taskId, AuthenticatedUser owner, String state) {
    stateMachineService.auditCreation(
        WorkflowEntityType.TASK,
        taskId,
        owner,
        "owner",
        "published".equals(state) ? "task.publish" : "task.create",
        state,
        "task created",
        java.util.Map.of("taskId", taskId, "status", state),
        null);
  }

  private void auditTaskTransition(TaskRecord before, AuthenticatedUser owner, String state) {
    if (before.status() == null || before.status().equals(state)) {
      return;
    }
    stateMachineService.audit(
        WorkflowEntityType.TASK,
        before.id(),
        owner,
        "owner",
        taskAction(before.status(), state),
        before.status(),
        state,
        "task state changed",
        java.util.Map.of("taskId", before.id(), "status", before.status()),
        java.util.Map.of("taskId", before.id(), "status", state),
        null);
  }

  private void auditTaskDeletion(
      TaskRecord before,
      AuthenticatedUser owner,
      int affectedAssignments,
      int affectedAnnotations) {
    stateMachineService.audit(
        WorkflowEntityType.TASK,
        before.id(),
        owner,
        "owner",
        "task.delete",
        before.status(),
        "ended",
        "task deleted by owner",
        java.util.Map.of("taskId", before.id(), "status", before.status()),
        java.util.Map.of(
            "taskId", before.id(),
            "status", "ended",
            "deleted", true,
            "affectedAssignments", affectedAssignments,
            "affectedAnnotations", affectedAnnotations),
        java.util.Map.of(
            "affectedAssignments", affectedAssignments,
            "affectedAnnotations", affectedAnnotations));
  }

  private void auditAssignmentVoided(
      TaskRepository.TaskAssignmentStateRecord record,
      AuthenticatedUser owner,
      long taskId) {
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        record.assignmentId(),
        owner,
        "owner",
        "assignment.void",
        record.status(),
        "voided",
        "task deleted by owner",
        java.util.Map.of(
            "assignmentId", record.assignmentId(),
            "taskId", taskId,
            "itemId", record.itemId(),
            "labelerId", record.labelerId(),
            "status", record.status()),
        java.util.Map.of(
            "assignmentId", record.assignmentId(),
            "taskId", taskId,
            "status", "voided"),
        null);
  }

  private void auditAnnotationVoided(
      TaskRepository.TaskAnnotationStateRecord record,
      AuthenticatedUser owner,
      long taskId) {
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        record.annotationId(),
        owner,
        "owner",
        "annotation.void",
        record.status(),
        "voided",
        "task deleted by owner",
        java.util.Map.of(
            "annotationId", record.annotationId(),
            "assignmentId", record.assignmentId(),
            "taskId", taskId,
            "status", record.status()),
        java.util.Map.of(
            "annotationId", record.annotationId(),
            "assignmentId", record.assignmentId(),
            "taskId", taskId,
            "status", "voided"),
        null);
  }

  private void auditAssignmentCreation(
      long assignmentId,
      AuthenticatedUser operator,
      String operatorRole,
      long taskId,
      long itemId,
      long labelerId) {
    stateMachineService.auditCreation(
        WorkflowEntityType.ASSIGNMENT,
        assignmentId,
        operator,
        operatorRole,
        "assignment.claim",
        "claimed",
        "assignment claimed",
        java.util.Map.of(
            "assignmentId", assignmentId,
            "taskId", taskId,
            "itemId", itemId,
            "labelerId", labelerId),
        null);
  }

  private String taskAction(String from, String to) {
    if ("published".equals(to)) {
      return "task.publish";
    }
    if ("paused".equals(to)) {
      return "task.pause";
    }
    if ("ended".equals(to)) {
      return "task.end";
    }
    return "task.update";
  }

  private AssignmentResponse toAssignmentResponse(AssignmentRecord record) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    String taskType = metadata.resolvedTaskType();
    Long schemaVersionId = metadata.schemaVersionId() == null
        ? record.schemaVersionId()
        : metadata.schemaVersionId();
    return new AssignmentResponse(
        Long.toString(record.id()),
        Long.toString(record.taskId()),
        Long.toString(record.itemId()),
        record.status(),
        formatDateTime(record.lockedUntil()),
        schemaVersionId == null ? "" : Long.toString(schemaVersionId),
        record.taskTitle(),
        taskType,
        toTaskTypeKey(taskType),
        record.ownerName(),
        formatDateTime(record.taskPublishedAt() == null ? record.taskCreatedAt() : record.taskPublishedAt()),
        formatDateTime(record.taskDeadline()),
        record.taskQuotaUsed(),
        record.taskQuota() == null ? 0 : record.taskQuota(),
        record.hasDraft(),
        record.hasSubmittedAnnotation(),
        formatDateTime(record.claimedAt()),
        formatDateTime(record.submittedAt()),
        formatDateTime(record.updatedAt()));
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
    }
    return principal;
  }

  private void ensureTaskNotDeleted(TaskRecord task) {
    if (task.deletedAt() != null) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_DELETED", "task has been deleted");
    }
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

  private TaskMetadata readMetadata(String json) {
    if (json == null || json.isBlank()) {
      return emptyMetadata();
    }
    try {
      TaskMetadata metadata = objectMapper.readValue(json, TaskMetadata.class);
      return metadata == null ? emptyMetadata() : metadata;
    } catch (JsonProcessingException exception) {
      return emptyMetadata();
    }
  }

  private TaskMetadata emptyMetadata() {
    return new TaskMetadata(
        List.of(),
        null,
        "first-come",
        null,
        null,
        List.of(),
        null,
        null,
        null,
        true,
        null,
        null,
        false,
        "all",
        "Annotation Task",
        null);
  }

  private String normalizeState(String state, String defaultState, Set<String> allowedStates) {
    String normalized = state == null || state.isBlank()
        ? defaultState
        : state.trim().toLowerCase(Locale.ROOT);
    if (normalized == null || !allowedStates.contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TASK_STATE", "unsupported task state");
    }
    return normalized;
  }

  private String normalizeStrategy(String strategy) {
    if (strategy == null || strategy.isBlank()) {
      return "first-come";
    }
    String normalized = strategy.trim();
    if (!Set.of("first-come", "assigned", "quota").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ASSIGN_STRATEGY", "unsupported assign strategy");
    }
    return normalized;
  }

  private String normalizeStrategyFilter(String strategy) {
    if (strategy == null || strategy.isBlank()) {
      return null;
    }
    return normalizeStrategy(strategy);
  }

  private String normalizeMediaTypeFilter(String mediaType) {
    if (mediaType == null || mediaType.isBlank()) {
      return null;
    }
    String normalized = mediaType.trim().toLowerCase(Locale.ROOT).replace('-', '_');
    if (!MEDIA_TYPES.contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_MEDIA_TYPE", "unsupported media type");
    }
    return normalized;
  }

  private String normalizeAiReviewFilter(String aiReview) {
    if (aiReview == null || aiReview.isBlank()) {
      return null;
    }
    String normalized = aiReview.trim().toLowerCase(Locale.ROOT);
    if ("enabled".equals(normalized)) {
      return "true";
    }
    if ("disabled".equals(normalized)) {
      return "false";
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_FILTER", "unsupported ai review filter");
  }

  private String normalizeAssignmentStatus(String status) {
    if (status == null || status.isBlank()) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (!ASSIGNMENT_STATUSES.contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ASSIGNMENT_STATUS", "unsupported assignment status");
    }
    return normalized;
  }

  private List<String> normalizeTags(List<String> tags) {
    if (tags == null) {
      return List.of();
    }
    return tags.stream()
        .filter(tag -> tag != null && !tag.isBlank())
        .map(String::trim)
        .distinct()
        .toList();
  }

  private List<Long> parseAssignedLabelerIds(List<String> assignedLabelerIds) {
    if (assignedLabelerIds == null) {
      return List.of();
    }
    List<Long> ids = new ArrayList<>();
    for (String assignedLabelerId : assignedLabelerIds) {
      if (assignedLabelerId == null || assignedLabelerId.isBlank()) {
        continue;
      }
      long parsed = parseLongId(assignedLabelerId, "INVALID_LABELER_ID");
      if (!ids.contains(parsed)) {
        ids.add(parsed);
      }
    }
    return ids;
  }

  private List<Long> resolveAssignedLabelerIds(CreateTaskRequest request) {
    if (request.labelerAllocations() != null && !request.labelerAllocations().isEmpty()) {
      return parseUserAllocations(request.labelerAllocations(), "INVALID_LABELER_ID").stream()
          .map(TaskRepository.UserAllocationRecord::userId)
          .toList();
    }
    return parseAssignedLabelerIds(request.assignedLabelerIds());
  }

  private List<Long> parseLongIds(List<String> values, String code) {
    if (values == null) {
      return List.of();
    }
    List<Long> ids = new ArrayList<>();
    Set<Long> seen = new LinkedHashSet<>();
    for (String value : values) {
      if (value == null || value.isBlank()) {
        continue;
      }
      long parsed = parseLongId(value.trim(), code);
      if (seen.add(parsed)) {
        ids.add(parsed);
      }
    }
    return ids;
  }

  private String normalizeItemSelectionMode(String mode) {
    if (mode == null || mode.isBlank()) {
      return "all";
    }
    String normalized = mode.trim().toLowerCase(Locale.ROOT);
    if (!Set.of("all", "partial").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ITEM_SELECTION_MODE", "unsupported item selection mode");
    }
    return normalized;
  }

  private String resolveTaskType(CreateTaskRequest request) {
    if (request.taskType() != null && !request.taskType().isBlank()) {
      return request.taskType().trim();
    }
    String source = (request.title() + " " + String.join(" ", normalizeTags(request.tags()))).toLowerCase(Locale.ROOT);
    if (source.contains("preference") || source.contains("偏好") || source.contains("对比")) {
      return "Preference Compare";
    }
    if (source.contains("image") || source.contains("图像") || source.contains("图片")) {
      return "Image Classification";
    }
    if (source.contains("视频") || source.contains("video")) {
      return "Video Review";
    }
    return "QA Quality";
  }

  private Double resolveRewardPerItem(String reward) {
    if (reward == null || reward.isBlank()) {
      return null;
    }
    var matcher = NUMBER_PATTERN.matcher(reward);
    if (!matcher.find()) {
      return null;
    }
    try {
      return Double.parseDouble(matcher.group(1));
    } catch (NumberFormatException exception) {
      return null;
    }
  }

  private String resolveRewardCap(String reward) {
    if (reward == null || reward.isBlank()) {
      return null;
    }
    String[] parts = reward.split("·", 2);
    return parts.length < 2 || parts[1].isBlank() ? null : parts[1].trim();
  }

  private LocalDateTime parseDeadline(String deadline) {
    if (deadline == null || deadline.isBlank()) {
      return null;
    }
    String value = deadline.trim();
    for (DateTimeFormatter formatter : List.of(DATE_TIME, DATE_TIME_SECONDS, DateTimeFormatter.ISO_LOCAL_DATE_TIME)) {
      try {
        return LocalDateTime.parse(value, formatter);
      } catch (DateTimeParseException ignored) {
        // Try the next accepted format.
      }
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DEADLINE", "deadline format is invalid");
  }

  private int parseSchemaVersion(String schema) {
    if (schema == null || schema.isBlank()) {
      return 1;
    }
    var matcher = Pattern.compile("\\d+").matcher(schema);
    int version = 1;
    while (matcher.find()) {
      version = Integer.parseInt(matcher.group());
    }
    return Math.max(version, 1);
  }

  private Long resolveEffectiveSchemaVersionId(TaskRecord record, TaskMetadata metadata) {
    return metadata.schemaVersionId() == null ? record.schemaVersionId() : metadata.schemaVersionId();
  }

  private int resolveEffectiveSchemaVersion(TaskRecord record, TaskMetadata metadata) {
    if (metadata.schemaVersion() != null) {
      return metadata.schemaVersion();
    }
    if (record.schemaVersion() != null) {
      return record.schemaVersion();
    }
    return parseSchemaVersion(metadata.schema());
  }

  private long parseLongId(String value, String code) {
    try {
      return Long.parseLong(value);
    } catch (NumberFormatException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id format is invalid");
    }
  }

  private String resolveDescription(String description) {
    return description == null || description.isBlank()
        ? "Owner 发布的标注任务,请按关联模板完成作答。"
        : description.trim();
  }

  private String normalizeTaskTypeFilter(String taskType) {
    if (taskType == null || taskType.isBlank()) {
      return null;
    }
    return taskType.trim().toLowerCase(Locale.ROOT).replace(' ', '_');
  }

  private String resolveMarketOrderBy(String sortBy) {
    if (sortBy == null || sortBy.isBlank()) {
      return "ORDER BY t.published_at DESC, t.created_at DESC";
    }
    return switch (sortBy.trim()) {
      case "reward" -> """
          ORDER BY
            CAST(JSON_UNQUOTE(JSON_EXTRACT(t.reward_rule, '$.rewardPerItem')) AS DECIMAL(10, 4)) DESC,
            t.published_at DESC,
            t.created_at DESC
          """;
      case "deadline" -> "ORDER BY (t.deadline IS NULL) ASC, t.deadline ASC, t.published_at DESC";
      case "quota" -> """
          ORDER BY
            (COALESCE(t.quota, 0) - COALESCE(ac.quota_used, 0)) DESC,
            t.published_at DESC,
            t.created_at DESC
          """;
      case "publishedAt" -> "ORDER BY t.published_at DESC, t.created_at DESC";
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_MARKET_SORT", "unsupported market sort");
    };
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

  private String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private String text(JsonNode node, String field) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return null;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private double roundMoney(double value) {
    return Math.round(value * 100.0) / 100.0;
  }

  private record SchemaSelection(long id, int version, String label) {}

  private record AiReviewRuleSelection(Long ruleId, String ruleName) {}
}
