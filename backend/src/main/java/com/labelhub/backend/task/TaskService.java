package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.auth.AuthRepository;
import com.labelhub.backend.auth.UserAccount;
import com.labelhub.backend.dataset.DatasetRecord;
import com.labelhub.backend.dataset.DatasetRepository;
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
  private final ObjectMapper objectMapper;

  public TaskService(
      AuthRepository authRepository,
      DatasetRepository datasetRepository,
      TaskRepository taskRepository,
      ObjectMapper objectMapper) {
    this.authRepository = authRepository;
    this.datasetRepository = datasetRepository;
    this.taskRepository = taskRepository;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public OwnerTaskResponse createTask(Authentication authentication, CreateTaskRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    String state = normalizeState(request.status(), "published", CREATE_STATES);
    DatasetRecord dataset = resolveSelectedDataset(owner.id(), request.datasetId());
    TaskMetadata metadata = buildTaskMetadata(request, dataset);
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
    ensureStrategyAssignments(taskId, metadata, request.quota(), state);

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

    String state = normalizeState(request.status(), existing.status(), TASK_STATES);
    DatasetRecord dataset = resolveSelectedDataset(owner.id(), request.datasetId());
    TaskMetadata metadata = buildTaskMetadata(request, dataset);
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
    ensureStrategyAssignments(taskId, metadata, request.quota(), state);

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
    int updated = taskRepository.updateTaskState(owner.id(), taskId, state);
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    taskRepository.updateLatestSchemaState(taskId, state);
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
    return taskRepository.findAssignmentForLabelerTask(taskId, labeler.id())
        .map(this::toAssignmentResponse)
        .orElseGet(() -> createAssignmentForStrategy(task, labeler.id()));
  }

  public PageResponse<AssignmentResponse> listMyAssignments(
      Authentication authentication,
      String status) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    String normalizedStatus = normalizeAssignmentStatus(status);
    List<AssignmentResponse> items = taskRepository
        .listLabelerAssignments(labeler.id(), normalizedStatus)
        .stream()
        .map(this::toAssignmentResponse)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
  }

  private TaskMetadata buildTaskMetadata(CreateTaskRequest request, DatasetRecord dataset) {
    return new TaskMetadata(
        normalizeTags(request.tags()),
        blankToNull(request.reward()),
        normalizeStrategy(request.strategy()),
        dataset == null ? null : dataset.id(),
        request.maxClaimPerUser(),
        parseAssignedLabelerIds(request.assignedLabelerIds()),
        blankToNull(request.schema()),
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

  private void bindDatasetToTask(DatasetRecord dataset, long taskId) {
    if (dataset != null) {
      datasetRepository.rebindDatasetToTask(dataset.id(), taskId);
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
      String state) {
    if (!"published".equals(state)
        || !"assigned".equals(metadata.resolvedStrategy())
        || metadata.resolvedAssignedLabelerIds().isEmpty()) {
      return;
    }

    for (long labelerId : metadata.resolvedAssignedLabelerIds()) {
      ensureAssignableLabeler(labelerId);
      if (taskRepository.hasTaskAssignment(taskId, labelerId)) {
        continue;
      }
      if (quota != null && taskRepository.countTaskAssignments(taskId) >= quota) {
        throw new ApiException(HttpStatus.CONFLICT, "TASK_QUOTA_EXHAUSTED", "task quota is exhausted");
      }
      long itemId = taskRepository.findFirstClaimableItem(taskId)
          .orElseThrow(() -> new ApiException(
              HttpStatus.CONFLICT,
              "NO_AVAILABLE_ITEM",
              "task has no available item to assign"));
      taskRepository.createAssignment(taskId, itemId, labelerId, LocalDateTime.now().plusHours(2));
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
    return new OwnerTaskResponse(
        Long.toString(record.id()),
        record.title(),
        metadata.resolvedTaskType(),
        "r" + resolveSchemaVersion(record),
        record.schemaVersionId() == null ? "" : Long.toString(record.schemaVersionId()),
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
    return new MarketTaskResponse(
        Long.toString(record.id()),
        record.title(),
        taskType,
        toTaskTypeKey(taskType),
        record.description(),
        metadata.tags() == null ? List.of() : metadata.tags(),
        record.schemaVersionId() == null ? "" : Long.toString(record.schemaVersionId()),
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
        formatDateTime(record.createdAt()),
        metadata.resolvedMaxClaimPerUser(),
        taskRepository.hasTaskAssignment(record.id(), currentUserId));
  }

  private AssignmentResponse createAssignmentForStrategy(TaskRecord task, long labelerId) {
    validateClaimableTask(task);
    TaskMetadata metadata = readMetadata(task.rewardRuleJson());
    String strategy = metadata.resolvedStrategy();
    if ("assigned".equals(strategy)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "ASSIGNED_TASK_NOT_CLAIMABLE",
          "assigned task requires a pre-created assignment");
    }

    if ("quota".equals(strategy)
        && metadata.resolvedMaxClaimPerUser() != null
        && taskRepository.countLabelerTaskAssignments(task.id(), labelerId)
            >= metadata.resolvedMaxClaimPerUser()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "TASK_CLAIM_LIMIT_REACHED",
          "task claim limit for current labeler is reached");
    }

    if (task.quota() != null && taskRepository.countTaskAssignments(task.id()) >= task.quota()) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_QUOTA_EXHAUSTED", "task quota is exhausted");
    }

    long itemId = taskRepository.findFirstClaimableItem(task.id())
        .orElseThrow(() -> new ApiException(
            HttpStatus.CONFLICT,
            "NO_AVAILABLE_ITEM",
            "task has no available item to claim"));
    long assignmentId = taskRepository.createAssignment(
        task.id(),
        itemId,
        labelerId,
        LocalDateTime.now().plusHours(2));
    return taskRepository.findAssignment(assignmentId)
        .map(this::toAssignmentResponse)
        .orElseThrow(() -> new IllegalStateException("failed to load created assignment"));
  }

  private void validateClaimableTask(TaskRecord task) {
    if (!"published".equals(task.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_NOT_PUBLISHED", "task is not published");
    }
    if (task.deadline() != null && task.deadline().isBefore(LocalDateTime.now())) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_EXPIRED", "task deadline has passed");
    }
  }

  private AssignmentResponse toAssignmentResponse(AssignmentRecord record) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    String taskType = metadata.resolvedTaskType();
    return new AssignmentResponse(
        Long.toString(record.id()),
        Long.toString(record.taskId()),
        Long.toString(record.itemId()),
        record.status(),
        formatDateTime(record.lockedUntil()),
        record.schemaVersionId() == null ? "" : Long.toString(record.schemaVersionId()),
        record.taskTitle(),
        taskType,
        toTaskTypeKey(taskType),
        record.ownerName(),
        record.taskQuotaUsed(),
        record.taskQuota() == null ? 0 : record.taskQuota(),
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

  private int resolveSchemaVersion(TaskRecord record) {
    return record.schemaVersion() == null ? 1 : record.schemaVersion();
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

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }
}
