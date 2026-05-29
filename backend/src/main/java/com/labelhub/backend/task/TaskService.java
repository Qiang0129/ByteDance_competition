package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.auth.AuthRepository;
import com.labelhub.backend.auth.UserAccount;
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
import java.util.List;
import java.util.Locale;
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
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public TaskService(
      AuthRepository authRepository,
      DatasetRepository datasetRepository,
      TaskRepository taskRepository,
      SchemaRepository schemaRepository,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.authRepository = authRepository;
    this.datasetRepository = datasetRepository;
    this.taskRepository = taskRepository;
    this.schemaRepository = schemaRepository;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public OwnerTaskResponse createTask(Authentication authentication, CreateTaskRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    String state = normalizeState(request.status(), "published", CREATE_STATES);
    DatasetRecord dataset = resolveSelectedDataset(owner.id(), request.datasetId());
    TaskMetadata metadata = buildTaskMetadata(owner.id(), request, dataset, null);
    validatePublishedSchemaConfiguration(owner.id(), metadata, state, null);
    validateStrategyConfiguration(metadata, state);

    long taskId = taskRepository.createTask(
        owner.id(),
        request.title().trim(),
        resolveDescription(request.description()),
        state,
        request.quota(),
        parseDeadline(request.deadline()),
        metadata,
        parseSchemaVersion(request.schema()));
    bindDatasetToTask(dataset, taskId);
    auditTaskCreation(taskId, owner, state);
    ensureStrategyAssignments(taskId, metadata, request.quota(), state, owner);

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
    TaskRecord existing = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    if (existing.ownerId() != owner.id()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    ensureTaskNotDeleted(existing);

    String state = normalizeState(request.status(), existing.status(), TASK_STATES);
    stateMachineService.validate(WorkflowEntityType.TASK, existing.status(), state, "owner");
    DatasetRecord dataset = resolveSelectedDataset(owner.id(), request.datasetId());
    TaskMetadata metadata = buildTaskMetadata(owner.id(), request, dataset, readMetadata(existing.rewardRuleJson()));
    validatePublishedSchemaConfiguration(owner.id(), metadata, state, existing);
    validateStrategyConfiguration(metadata, state);

    int updated = taskRepository.updateTask(
        owner.id(),
        taskId,
        request.title().trim(),
        resolveDescription(request.description()),
        state,
        request.quota(),
        parseDeadline(request.deadline()),
        metadata);
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    taskRepository.updateLatestSchemaState(taskId, state);
    bindDatasetToTask(dataset, taskId);
    auditTaskTransition(existing, owner, state);
    ensureStrategyAssignments(taskId, metadata, request.quota(), state, owner);

    return taskRepository.findTask(taskId)
        .map(this::toOwnerResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
  }

  public PageResponse<OwnerTaskResponse> listOwnerTasks(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    List<OwnerTaskResponse> items = taskRepository.listOwnerTasks(owner.id()).stream()
        .map(this::toOwnerResponse)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
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

  @Transactional
  public OwnerTaskResponse updateState(
      Authentication authentication,
      long taskId,
      UpdateTaskStateRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    String state = normalizeState(request.state(), null, TASK_STATES);
    TaskRecord existing = taskRepository.findTask(taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    if (existing.ownerId() != owner.id()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    ensureTaskNotDeleted(existing);
    validatePublishedSchemaConfiguration(owner.id(), readMetadata(existing.rewardRuleJson()), state, existing);
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

  @Transactional
  public AssignmentResponse claimTask(Authentication authentication, long taskId) {
    AuthenticatedUser labeler = requireLabeler(authentication);
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
      TaskMetadata fallbackMetadata) {
    SchemaSelection selectedSchema = resolveSelectedSchema(ownerId, request.schemaVersionId());
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

    return new TaskMetadata(
        normalizeTags(request.tags()),
        blankToNull(request.reward()),
        normalizeStrategy(request.strategy()),
        dataset == null ? null : dataset.id(),
        request.maxClaimPerUser(),
        parseAssignedLabelerIds(request.assignedLabelerIds()),
        schemaLabel,
        schemaVersionId,
        schemaVersion,
        request.aiReviewEnabled(),
        resolveTaskType(request),
        resolveRewardPerItem(request.reward()));
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
    if (schemaVersionIdValue == null || schemaVersionIdValue.isBlank()) {
      return null;
    }
    long schemaVersionId = parseLongId(schemaVersionIdValue, "INVALID_SCHEMA_VERSION_ID");
    SchemaRecord schema = schemaRepository.findOwnerSchemaIncludingDeleted(ownerId, schemaVersionId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
    if (!"published".equals(schema.status()) && schema.deletedAt() == null) {
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
    if (!"published".equals(schema.status())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_NOT_PUBLISHED",
          "published task requires a published schema");
    }
  }

  private void validateStrategyConfiguration(TaskMetadata metadata, String state) {
    if (!PUBLISHED_STRATEGIES.contains(metadata.resolvedStrategy())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ASSIGN_STRATEGY", "unsupported assign strategy");
    }
    if (!"published".equals(state)) {
      return;
    }
    if ("assigned".equals(metadata.resolvedStrategy()) && metadata.resolvedAssignedLabelerIds().isEmpty()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "ASSIGNED_LABELERS_REQUIRED",
          "assigned strategy requires at least one labeler");
    }
    if ("quota".equals(metadata.resolvedStrategy()) && metadata.resolvedMaxClaimPerUser() == null) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "MAX_CLAIM_PER_USER_REQUIRED",
          "quota strategy requires max claim per user");
    }
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
    for (long labelerId : metadata.resolvedAssignedLabelerIds()) {
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
        metadata.resolvedMaxClaimPerUser(),
        metadata.resolvedAssignedLabelerIds().stream().map(String::valueOf).toList(),
        formatDateTime(record.createdAt()),
        formatDateTime(record.deadline()),
        metadata.reward(),
        metadata.tags() == null ? List.of() : metadata.tags(),
        record.description(),
        metadata.resolvedAiReviewEnabled());
  }

  private MarketTaskResponse toMarketResponse(TaskRecord record, long currentUserId) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    int totalQuota = record.quota() == null ? 0 : record.quota();
    int remainingQuota = Math.max(totalQuota - record.quotaUsed(), 0);
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
        metadata.resolvedAiReviewEnabled() ? "电商相关性 v2" : null,
        formatDateTime(record.publishedAt() == null ? record.createdAt() : record.publishedAt()),
        metadata.resolvedMaxClaimPerUser(),
        taskRepository.hasTaskAssignment(record.id(), currentUserId));
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
        && (task.deadline() == null || !task.deadline().isBefore(LocalDateTime.now()));
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
    if (task.deadline() != null && task.deadline().isBefore(LocalDateTime.now())) {
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

  private record SchemaSelection(long id, int version, String label) {}
}
