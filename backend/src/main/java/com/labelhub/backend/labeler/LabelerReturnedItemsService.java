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
  private static final String REWORK_STATUS_RETURNED = "RETURNED";
  private static final String REWORK_STATUS_SUBMITTED = "REWORK_SUBMITTED";
  private static final String REWORK_STATUS_AI_PRE_REJECT = "AI_PRE_REJECT";
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
    String reworkStatus = blankToDefault(
        record.reworkStatus(),
        humanReturn ? REWORK_STATUS_RETURNED : REWORK_STATUS_AI_PRE_REJECT);
    boolean returned = REWORK_STATUS_RETURNED.equals(reworkStatus);
    boolean reworkOpen = returned
        && record.resubmitDeadline() != null
        && record.resubmitDeadline().isAfter(LocalDateTime.now());
    String expiredReason = returned && !reworkOpen ? "RETURN_REWORK_EXPIRED" : "";
    String taskTitle = blankToDefault(record.taskTitle(), "标注任务");
    String taskType = blankToDefault(record.taskType(), "Annotation Task");
    int itemIndex = Math.max(record.itemIndex(), 1);
    return new LabelerReturnedItemResponse(
        record.source(),
        humanReturn ? "人工审核打回" : "AI预打回（待人工审核）",
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
        record.revisionNo(),
        resolveReviewStageLabel(record.revisionNo()),
        nullToEmpty(record.humanReason()),
        nullToEmpty(record.aiDecision()),
        nullToEmpty(record.aiComment()),
        record.aiTotalScore(),
        readStringArray(record.aiRiskFlagsJson()),
        readStringArray(record.aiEvidenceJson()),
        formatDateTime(record.resubmitDeadline()),
        reworkOpen,
        expiredReason,
        resolveActionable(humanReturn, reworkStatus, reworkOpen),
        resolveActionText(humanReturn, reworkStatus, reworkOpen),
        reworkStatus,
        resolveReworkStatusLabel(reworkStatus, record.returnCount()),
        nullToEmpty(record.reviewDecision()),
        resolveReviewResultLabel(record.reviewDecision(), reworkStatus, record.returnCount()),
        nullToEmpty(record.reviewResultReason()),
        formatDateTime(record.reviewedAt()),
        formatDateTime(record.reworkSubmittedAt()));
  }

  private boolean resolveActionable(boolean humanReturn, String reworkStatus, boolean reworkOpen) {
    if (!humanReturn) {
      return false;
    }
    if (REWORK_STATUS_RETURNED.equals(reworkStatus)) {
      return reworkOpen;
    }
    return true;
  }

  private String resolveActionText(boolean humanReturn, String reworkStatus, boolean reworkOpen) {
    if (!humanReturn) {
      return "等待人工审核";
    }
    if (REWORK_STATUS_RETURNED.equals(reworkStatus)) {
      return reworkOpen ? "立即修改" : "返修已过期";
    }
    if (REWORK_STATUS_SUBMITTED.equals(reworkStatus)) {
      return "查看修改";
    }
    return "查看结果";
  }

  private String resolveReworkStatusLabel(String reworkStatus, int returnCount) {
    return switch (reworkStatus) {
      case REWORK_STATUS_RETURNED -> returnCount > 1 ? "再次打回待修改" : "待修改";
      case REWORK_STATUS_SUBMITTED -> "已修改";
      case "REVIEW_APPROVED", "REVIEW_REVISED", "REVIEW_ESCALATED" -> "已审核";
      case REWORK_STATUS_AI_PRE_REJECT -> "AI预打回";
      default -> reworkStatus;
    };
  }

  private String resolveReviewResultLabel(String decision, String reworkStatus, int returnCount) {
    String normalized = decision == null ? "" : decision.trim().toLowerCase(Locale.ROOT);
    if (REWORK_STATUS_RETURNED.equals(reworkStatus) && List.of("return", "returned", "reject", "rejected")
        .contains(normalized)) {
      return returnCount > 1 ? "再次打回" : "打回";
    }
    return switch (normalized) {
      case "approve", "approved" -> "通过";
      case "revise", "revised" -> "修订通过";
      case "escalate" -> "升级复核";
      case "return", "returned", "reject", "rejected" -> "再次打回";
      default -> "";
    };
  }

  private String resolveReviewStageLabel(int revisionNo) {
    if (revisionNo <= 1) {
      return "初审";
    }
    if (revisionNo == 2) {
      return "复审";
    }
    return "终审";
  }

  private String normalizeSource(String source) {
    if (source == null || source.isBlank() || "all".equalsIgnoreCase(source)) {
      return "all";
    }
    String normalized = source.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "human_return", "returned", "pending_rework" -> "human_return";
      case "reworked", "modified", "resubmitted", "rework_submitted" -> "reworked";
      case "reviewed", "review_result", "reviewed_result", "review_complete" -> "reviewed";
      case "ai_pre_reject", "ai_reject" -> "ai_pre_reject";
      default -> throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_RETURNED_ITEM_SOURCE",
          "unsupported returned item source");
    };
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
