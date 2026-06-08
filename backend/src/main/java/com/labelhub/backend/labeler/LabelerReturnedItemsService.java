package com.labelhub.backend.labeler;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.labeler.LabelerReturnedItemsRepository.ReturnedItemRecord;
import com.labelhub.backend.labeler.LabelerReturnedItemsRepository.ReturnedItemTimelineRecord;
import com.labelhub.backend.task.PageResponse;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
    boolean finalReview = record.reviewAfterEscalate() && isFinalReviewDecision(record.reviewDecision());
    int reviewStageNo = finalReview ? 3 : record.revisionNo();
    String reviewStageLabel = finalReview ? "终审" : resolveReviewStageLabel(record.revisionNo());
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
        reviewStageNo,
        reviewStageLabel,
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
        resolveReviewResultLabel(record.reviewDecision(), reworkStatus, record.returnCount(), finalReview),
        nullToEmpty(record.reviewResultReason()),
        formatDateTime(record.reviewedAt()),
        formatDateTime(record.reworkSubmittedAt()),
        buildReviewTimeline(record, reworkStatus));
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

  private String resolveReviewResultLabel(
      String decision,
      String reworkStatus,
      int returnCount,
      boolean finalReview) {
    String normalized = decision == null ? "" : decision.trim().toLowerCase(Locale.ROOT);
    if (finalReview && List.of("approve", "approved").contains(normalized)) {
      return "终审通过";
    }
    if (finalReview && List.of("return", "returned", "reject", "rejected").contains(normalized)) {
      return "终审驳回";
    }
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

  private List<LabelerReturnedItemTimelineResponse> buildReviewTimeline(
      ReturnedItemRecord item,
      String reworkStatus) {
    List<LabelerReturnedItemTimelineResponse> timeline = new ArrayList<>();
    Map<Long, Boolean> escalatedAnnotations = new HashMap<>();
    for (ReturnedItemTimelineRecord record : repository.listReviewTimeline(item.assignmentId())) {
      String type = record.eventType();
      if ("submit".equals(type)) {
        timeline.add(new LabelerReturnedItemTimelineResponse(
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
        String decision = normalizeDecision(record.aiDecision());
        timeline.add(new LabelerReturnedItemTimelineResponse(
            "ai-" + record.annotationId(),
            "ai_review",
            "AI预审（Revision " + record.revisionNo() + "）",
            "AI Agent",
            decision,
            null,
            record.aiComment(),
            record.aiTotalScore(),
            formatDateTime(record.aiFinishedAt()),
            decision == null ? "pending" : "completed"));
        continue;
      }
      if ("human_review".equals(type)) {
        String decision = normalizeDecision(record.humanDecision());
        boolean finalReview = Boolean.TRUE.equals(escalatedAnnotations.get(record.annotationId()))
            && isFinalReviewDecision(decision);
        timeline.add(new LabelerReturnedItemTimelineResponse(
            "human-" + record.annotationId() + "-" + timeline.size(),
            "human_review",
            resolveHumanTimelineTitle(record.revisionNo(), decision, finalReview),
            blankToDefault(record.humanReviewerName(), "Reviewer"),
            decision,
            record.humanReason(),
            null,
            null,
            formatDateTime(record.humanReviewedAt()),
            "completed"));
        if ("ESCALATE".equals(decision)) {
          escalatedAnnotations.put(record.annotationId(), true);
        }
      }
    }
    if (SOURCE_HUMAN_RETURN.equals(item.source()) && REWORK_STATUS_RETURNED.equals(reworkStatus)) {
      String deadline = formatDateTime(item.resubmitDeadline());
      timeline.add(new LabelerReturnedItemTimelineResponse(
          "rework-" + item.assignmentId(),
          "rework",
          "修改中",
          "我",
          "REWORKING",
          null,
          deadline.isBlank() ? "当前可修改" : "返修截止:" + deadline,
          null,
          "",
          "current"));
    } else if ("AI_PRE_REJECT".equals(item.source())) {
      timeline.add(new LabelerReturnedItemTimelineResponse(
          "pending-human-" + item.annotationId(),
          "human_review",
          "等待人工审核",
          "Reviewer",
          "PENDING_HUMAN_REVIEW",
          null,
          "AI 预打回仍需等待人工审核裁决",
          null,
          "",
          "current"));
    }
    return timeline;
  }

  private String resolveHumanTimelineTitle(int revisionNo, String decision, boolean finalReview) {
    if (finalReview && ("APPROVE".equals(decision) || "APPROVED".equals(decision))) {
      return "终审通过";
    }
    if (finalReview
        && ("RETURN".equals(decision)
            || "RETURNED".equals(decision)
            || "REJECT".equals(decision)
            || "REJECTED".equals(decision))) {
      return "终审驳回";
    }
    if ("ESCALATE".equals(decision)) {
      return revisionNo <= 1 ? "初审升级" : "复审升级";
    }
    return resolveReviewStageLabel(revisionNo);
  }

  private boolean isFinalReviewDecision(String decision) {
    if (decision == null || decision.isBlank()) {
      return false;
    }
    String normalized = decision.trim().toUpperCase(Locale.ROOT);
    return List.of("APPROVE", "APPROVED", "RETURN", "RETURNED", "REJECT", "REJECTED").contains(normalized);
  }

  private String normalizeDecision(String decision) {
    return decision == null || decision.isBlank() ? null : decision.trim().toUpperCase(Locale.ROOT);
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
