package com.labelhub.backend.task;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
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
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final DateTimeFormatter DATE_TIME_SECONDS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
  private static final Pattern NUMBER_PATTERN = Pattern.compile("(\\d+(?:\\.\\d+)?)");

  private final TaskRepository taskRepository;
  private final ObjectMapper objectMapper;

  public TaskService(TaskRepository taskRepository, ObjectMapper objectMapper) {
    this.taskRepository = taskRepository;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public OwnerTaskResponse createTask(Authentication authentication, CreateTaskRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    String state = normalizeState(request.status(), "published", CREATE_STATES);
    TaskMetadata metadata = new TaskMetadata(
        normalizeTags(request.tags()),
        blankToNull(request.reward()),
        normalizeStrategy(request.strategy()),
        blankToNull(request.schema()),
        request.aiReviewEnabled(),
        resolveTaskType(request),
        resolveRewardPerItem(request.reward()));

    long taskId = taskRepository.createTask(
        owner.id(),
        request.title().trim(),
        resolveDescription(request.description()),
        state,
        request.quota(),
        parseDeadline(request.deadline()),
        metadata,
        parseSchemaVersion(request.schema()));

    return taskRepository.findTask(taskId)
        .map(this::toOwnerResponse)
        .orElseThrow(() -> new IllegalStateException("failed to load created task"));
  }

  public PageResponse<OwnerTaskResponse> listOwnerTasks(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    List<OwnerTaskResponse> items = taskRepository.listOwnerTasks(owner.id()).stream()
        .map(this::toOwnerResponse)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
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
      Integer page,
      Integer pageSize) {
    requirePrincipal(authentication);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    String normalizedTaskType = normalizeTaskTypeFilter(taskType);
    long total = taskRepository.countMarketTasks(keyword, normalizedTaskType);
    List<MarketTaskResponse> items = taskRepository.listMarketTasks(
            keyword,
            normalizedTaskType,
            (safePage - 1) * safePageSize,
            safePageSize)
        .stream()
        .map(this::toMarketResponse)
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  private OwnerTaskResponse toOwnerResponse(TaskRecord record) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    int totalQuota = record.quota() == null ? 0 : record.quota();
    return new OwnerTaskResponse(
        Long.toString(record.id()),
        record.title(),
        metadata.resolvedTaskType(),
        "r" + resolveSchemaVersion(record),
        record.schemaVersionId() == null ? "" : Long.toString(record.schemaVersionId()),
        record.ownerName(),
        record.status(),
        metadata.resolvedStrategy(),
        record.quotaUsed(),
        totalQuota,
        formatDateTime(record.createdAt()),
        formatDateTime(record.deadline()),
        metadata.reward(),
        metadata.tags() == null ? List.of() : metadata.tags(),
        record.description(),
        metadata.resolvedAiReviewEnabled());
  }

  private MarketTaskResponse toMarketResponse(TaskRecord record) {
    TaskMetadata metadata = readMetadata(record.rewardRuleJson());
    int totalQuota = record.quota() == null ? 0 : record.quota();
    int remainingQuota = Math.max(totalQuota - record.quotaUsed(), 0);
    return new MarketTaskResponse(
        Long.toString(record.id()),
        record.title(),
        metadata.resolvedTaskType(),
        record.description(),
        record.schemaVersionId() == null ? "" : Long.toString(record.schemaVersionId()),
        remainingQuota,
        totalQuota,
        formatDateTime(record.deadline()),
        metadata.rewardPerItem());
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
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
    return new TaskMetadata(List.of(), null, "first-come", null, true, "Annotation Task", null);
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

  private String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }
}
