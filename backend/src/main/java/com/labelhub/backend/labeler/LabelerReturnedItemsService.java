package com.labelhub.backend.labeler;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.labeler.LabelerReturnedItemsRepository.ReturnedItemRecord;
import com.labelhub.backend.task.PageResponse;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
public class LabelerReturnedItemsService {

  private static final String SOURCE_HUMAN_RETURN = "HUMAN_REVIEW_RETURN";
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final LabelerReturnedItemsRepository repository;
  private final ObjectMapper objectMapper;

  public LabelerReturnedItemsService(
      LabelerReturnedItemsRepository repository,
      ObjectMapper objectMapper) {
    this.repository = repository;
    this.objectMapper = objectMapper;
  }

  public PageResponse<LabelerReturnedItemResponse> listReturnedItems(
      Authentication authentication,
      String source,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    String normalizedSource = normalizeSource(source);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    long total = repository.countReturnedItems(labeler.id(), normalizedSource);
    List<LabelerReturnedItemResponse> items = repository
        .listReturnedItems(labeler.id(), normalizedSource, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toResponse)
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  private LabelerReturnedItemResponse toResponse(ReturnedItemRecord record) {
    boolean humanReturn = SOURCE_HUMAN_RETURN.equals(record.source());
    boolean reworkOpen = humanReturn
        && record.resubmitDeadline() != null
        && record.resubmitDeadline().isAfter(LocalDateTime.now());
    String expiredReason = humanReturn && !reworkOpen ? "RETURN_REWORK_EXPIRED" : "";
    String taskTitle = blankToDefault(record.taskTitle(), "标注任务");
    String taskType = blankToDefault(record.taskType(), "Annotation Task");
    int itemIndex = Math.max(record.itemIndex(), 1);
    return new LabelerReturnedItemResponse(
        record.source(),
        humanReturn ? "人工复审打回" : "AI预打回（待人工复审）",
        Long.toString(record.assignmentId()),
        Long.toString(record.annotationId()),
        Long.toString(record.taskId()),
        Long.toString(record.itemId()),
        taskTitle + " - 第 " + itemIndex + " 题",
        taskTitle,
        taskType,
        toTaskTypeKey(taskType),
        Long.toString(record.schemaVersionId()),
        record.revisionNo(),
        formatDateTime(record.updatedAt()),
        nullToEmpty(record.reviewerName()),
        record.reviewRoundNo(),
        nullToEmpty(record.humanReason()),
        nullToEmpty(record.aiDecision()),
        nullToEmpty(record.aiComment()),
        record.aiTotalScore(),
        readStringArray(record.aiRiskFlagsJson()),
        readStringArray(record.aiEvidenceJson()),
        formatDateTime(record.resubmitDeadline()),
        reworkOpen,
        expiredReason,
        reworkOpen,
        resolveActionText(humanReturn, reworkOpen));
  }

  private String resolveActionText(boolean humanReturn, boolean reworkOpen) {
    if (!humanReturn) {
      return "等待人工复审";
    }
    return reworkOpen ? "立即修改" : "返修已过期";
  }

  private String normalizeSource(String source) {
    if (source == null || source.isBlank() || "all".equalsIgnoreCase(source)) {
      return "all";
    }
    String normalized = source.trim().toLowerCase(Locale.ROOT);
    if (List.of("human_return", "ai_pre_reject").contains(normalized)) {
      return normalized;
    }
    throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_RETURNED_ITEM_SOURCE",
        "unsupported returned item source");
  }

  private List<String> readStringArray(String json) {
    if (json == null || json.isBlank()) {
      return List.of();
    }
    try {
      JsonNode root = objectMapper.readTree(json);
      if (!root.isArray()) {
        return List.of();
      }
      List<String> values = new ArrayList<>();
      for (JsonNode item : root) {
        String value = item.isTextual() ? item.asText() : item.toString();
        if (value != null && !value.isBlank()) {
          values.add(value);
        }
      }
      return values;
    } catch (JsonProcessingException exception) {
      return List.of();
    }
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

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private String nullToEmpty(String value) {
    return value == null ? "" : value;
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
}
