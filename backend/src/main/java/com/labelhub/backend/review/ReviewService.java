package com.labelhub.backend.review;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ReviewService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final ReviewRepository reviewRepository;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public ReviewService(
      ReviewRepository reviewRepository,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.reviewRepository = reviewRepository;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  public ReviewerOverviewResponse getOverview(Authentication authentication, Integer days) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    int rangeDays = days == null || days < 1 ? 30 : Math.min(days, 365);
    return new ReviewerOverviewResponse(
        rangeDays,
        reviewRepository.countPendingBatches(),
        reviewRepository.countHumanReviewsToday("approve"),
        reviewRepository.countHumanReviewsToday("return"),
        reviewRepository.countHumanReviewsToday("escalate"),
        reviewRepository.countReviewedTotal(reviewer.id()),
        1.0,
        1.0);
  }

  public ReviewerPageResponse<ReviewBatchResponse> listBatches(
      Authentication authentication,
      String status,
      String keyword,
      Integer page,
      Integer pageSize) {
    requireReviewer(authentication);
    String normalizedStatus = normalizeBatchStatus(status);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    List<ReviewBatchResponse> items = reviewRepository
        .listBatches(normalizedStatus, keyword, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toBatchResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countBatches(normalizedStatus, keyword));
  }

  public ReviewBatchResponse claimBatch(Authentication authentication, long batchId) {
    requireReviewer(authentication);
    return reviewRepository.findBatch(batchId)
        .map(this::toBatchResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "REVIEW_BATCH_NOT_FOUND", "review batch not found"));
  }

  public ReviewerPageResponse<AnnotationToReviewResponse> listAnnotations(
      Authentication authentication,
      String batchId,
      String decision,
      Integer page,
      Integer pageSize) {
    requireReviewer(authentication);
    long taskId = "all".equalsIgnoreCase(batchId) ? 0L : parseLongId(batchId, "INVALID_REVIEW_BATCH_ID");
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    String normalizedDecision = decision == null || decision.isBlank()
        ? null
        : decision.trim().toLowerCase(Locale.ROOT);
    List<AnnotationToReviewResponse> items = reviewRepository
        .listAnnotations(taskId, normalizedDecision, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toAnnotationResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countAnnotations(taskId, normalizedDecision));
  }

  @Transactional
  public AnnotationToReviewResponse submitDecision(
      Authentication authentication,
      long annotationId,
      ReviewDecisionRequest request) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    String decision = normalizeReviewDecision(request == null ? null : request.decision());
    String reason = request == null ? null : request.reason();
    ReviewRepository.AnnotationStateRecord state = reviewRepository.lockAnnotationState(annotationId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
    ensureReviewable(state.annotationStatus());
    int roundNo = reviewRepository.nextReviewRound(annotationId);

    switch (decision) {
      case "approve" -> approve(reviewer, state, reason, roundNo);
      case "return" -> returnToLabeler(reviewer, state, reason, roundNo);
      case "escalate" -> escalate(reviewer, state, reason, roundNo);
      case "revise" -> revise(reviewer, state, reason, roundNo);
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_DECISION", "unsupported review decision");
    }

    return reviewRepository.findAnnotation(annotationId)
        .map(this::toAnnotationResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
  }

  public ReviewerPageResponse<DisputeItemResponse> listDisputes(
      Authentication authentication,
      String status,
      Integer page,
      Integer pageSize) {
    requireReviewer(authentication);
    String normalizedStatus = normalizeDisputeStatus(status);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    List<DisputeItemResponse> items = reviewRepository
        .listDisputes(normalizedStatus, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toDisputeResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countDisputes(normalizedStatus));
  }

  @Transactional
  public DisputeItemResponse resolveDispute(
      Authentication authentication,
      long disputeId,
      ResolveDisputeRequest request) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    ReviewRepository.DisputeRecord dispute = reviewRepository.findDispute(disputeId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DISPUTE_NOT_FOUND", "dispute not found"));
    String resolution = request == null || request.resolution() == null
        ? ""
        : request.resolution().trim().toLowerCase(Locale.ROOT);
    ReviewDecisionRequest decision = switch (resolution) {
      case "approve" -> new ReviewDecisionRequest("APPROVE", request == null ? null : request.note(), null, false);
      case "reject" -> new ReviewDecisionRequest("RETURN", request == null ? null : request.note(), null, false);
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DISPUTE_RESOLUTION", "unsupported dispute resolution");
    };
    submitDecisionForReviewer(reviewer, dispute.annotationId(), decision);
    return reviewRepository.findDispute(disputeId)
        .map(this::toDisputeResponse)
        .orElseGet(() -> toDisputeResponse(dispute));
  }

  private void submitDecisionForReviewer(
      AuthenticatedUser reviewer,
      long annotationId,
      ReviewDecisionRequest request) {
    String decision = normalizeReviewDecision(request.decision());
    ReviewRepository.AnnotationStateRecord state = reviewRepository.lockAnnotationState(annotationId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
    ensureReviewable(state.annotationStatus());
    int roundNo = reviewRepository.nextReviewRound(annotationId);
    if ("approve".equals(decision)) {
      approve(reviewer, state, request.reason(), roundNo);
    } else if ("return".equals(decision)) {
      returnToLabeler(reviewer, state, request.reason(), roundNo);
    }
  }

  private void approve(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state,
      String reason,
      int roundNo) {
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.updateAnnotationStatus(state.annotationId(), "accepted");
    reviewRepository.updateAssignmentStatus(state.assignmentId(), "accepted");
    reviewRepository.updateItemStatus(state.itemId(), "accepted");
    reviewRepository.createHumanReview(state.annotationId(), reviewer.id(), roundNo, "approve", reason, null);
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        state.annotationId(),
        reviewer,
        "reviewer",
        "human_review.approve",
        effectiveReviewFromState(state.annotationStatus()),
        "accepted",
        reason,
        Map.of("annotationId", state.annotationId(), "status", effectiveReviewFromState(state.annotationStatus())),
        Map.of("annotationId", state.annotationId(), "status", "accepted"),
        null);
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        state.assignmentId(),
        reviewer,
        "reviewer",
        "human_review.approve",
        state.assignmentStatus(),
        "accepted",
        reason,
        Map.of("assignmentId", state.assignmentId(), "status", state.assignmentStatus()),
        Map.of("assignmentId", state.assignmentId(), "status", "accepted"),
        null);
  }

  private void returnToLabeler(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state,
      String reason,
      int roundNo) {
    if (reason == null || reason.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "RETURN_REASON_REQUIRED", "return reason is required");
    }
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.updateAnnotationStatus(state.annotationId(), "returned");
    reviewRepository.updateAssignmentStatus(state.assignmentId(), "returned");
    reviewRepository.updateItemStatus(state.itemId(), "returned");
    reviewRepository.createHumanReview(state.annotationId(), reviewer.id(), roundNo, "return", reason, null);
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        state.annotationId(),
        reviewer,
        "reviewer",
        "human_review.return",
        effectiveReviewFromState(state.annotationStatus()),
        "returned",
        reason,
        Map.of("annotationId", state.annotationId(), "status", effectiveReviewFromState(state.annotationStatus())),
        Map.of("annotationId", state.annotationId(), "status", "returned"),
        null);
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        state.assignmentId(),
        reviewer,
        "reviewer",
        "human_review.return",
        state.assignmentStatus(),
        "returned",
        reason,
        Map.of("assignmentId", state.assignmentId(), "status", state.assignmentStatus()),
        Map.of("assignmentId", state.assignmentId(), "status", "returned"),
        null);
  }

  private void escalate(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state,
      String reason,
      int roundNo) {
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.createHumanReview(
        state.annotationId(),
        reviewer.id(),
        roundNo,
        "escalate",
        reason == null || reason.isBlank() ? "escalated to dispute review" : reason,
        null);
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        state.annotationId(),
        reviewer,
        "reviewer",
        "human_review.escalate",
        effectiveReviewFromState(state.annotationStatus()),
        "reviewing",
        reason,
        Map.of("annotationId", state.annotationId(), "status", effectiveReviewFromState(state.annotationStatus())),
        Map.of("annotationId", state.annotationId(), "status", "reviewing"),
        null);
  }

  private void revise(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state,
      String reason,
      int roundNo) {
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.createHumanReview(state.annotationId(), reviewer.id(), roundNo, "revise", reason, null);
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        state.annotationId(),
        reviewer,
        "reviewer",
        "human_review.revise",
        effectiveReviewFromState(state.annotationStatus()),
        "reviewing",
        reason,
        Map.of("annotationId", state.annotationId(), "status", effectiveReviewFromState(state.annotationStatus())),
        Map.of("annotationId", state.annotationId(), "status", "reviewing"),
        null);
  }

  private void transitionAnnotationToReviewingIfNeeded(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state) {
    String current = normalizeStatus(state.annotationStatus());
    if ("reviewing".equals(current)) {
      return;
    }
    if (!List.of("submitted", "ai_reviewing").contains(current)) {
      return;
    }
    reviewRepository.updateAnnotationStatus(state.annotationId(), "reviewing");
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        state.annotationId(),
        reviewer,
        "reviewer",
        "human_review.start",
        current,
        "reviewing",
        "human review started",
        Map.of("annotationId", state.annotationId(), "status", current),
        Map.of("annotationId", state.annotationId(), "status", "reviewing"),
        null);
  }

  private void ensureReviewable(String status) {
    String normalized = normalizeStatus(status);
    if (!List.of("submitted", "ai_reviewing", "reviewing").contains(normalized)) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "ANNOTATION_NOT_REVIEWABLE",
          "annotation is not reviewable in current state");
    }
  }

  private String effectiveReviewFromState(String state) {
    String normalized = normalizeStatus(state);
    return List.of("submitted", "ai_reviewing").contains(normalized) ? "reviewing" : normalized;
  }

  private ReviewBatchResponse toBatchResponse(ReviewRepository.ReviewBatchRecord record) {
    return new ReviewBatchResponse(
        Long.toString(record.taskId()),
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.taskType(),
        record.pending(),
        record.reviewed(),
        record.needHumanReview(),
        record.samplingRatio(),
        record.priority(),
        record.status(),
        null,
        formatDateTime(record.deadline()),
        formatDateTime(record.updatedAt()));
  }

  private AnnotationToReviewResponse toAnnotationResponse(ReviewRepository.AnnotationReviewRecord record) {
    return new AnnotationToReviewResponse(
        Long.toString(record.annotationId()),
        Long.toString(record.assignmentId()),
        Long.toString(record.itemId()),
        Long.toString(record.schemaVersionId()),
        record.labelerName(),
        formatDateTime(record.submittedAt()),
        readJson(record.answerJson()),
        readJson(record.rawPayloadJson()),
        toAiResult(record),
        record.humanDecision() == null ? null : record.humanDecision().toUpperCase(Locale.ROOT),
        record.revisionNo(),
        record.dispute());
  }

  private DisputeItemResponse toDisputeResponse(ReviewRepository.DisputeRecord record) {
    return new DisputeItemResponse(
        Long.toString(record.disputeId()),
        Long.toString(record.annotationId()),
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.reason(),
        record.raisedBy(),
        formatDateTime(record.raisedAt()),
        record.status(),
        record.rounds());
  }

  private AiReviewResultResponse toAiResult(ReviewRepository.AnnotationReviewRecord record) {
    if (record.aiDecision() == null || record.aiDecision().isBlank()) {
      return null;
    }
    Map<String, Double> scores = readScores(record.aiScoresJson());
    double total = scores.values().stream().mapToDouble(Double::doubleValue).average().orElse(0);
    JsonNode response = readJson(record.aiResponseJson());
    return new AiReviewResultResponse(
        scores,
        total,
        record.aiDecision(),
        record.aiComment() == null ? "" : record.aiComment(),
        readStringArray(response.path("risk_flags")),
        readStringArray(response.path("evidence")));
  }

  private Map<String, Double> readScores(String json) {
    JsonNode node = readJson(json);
    Map<String, Double> scores = new HashMap<>();
    if (node.isObject()) {
      node.fields().forEachRemaining(entry -> {
        if (entry.getValue().isNumber()) {
          scores.put(entry.getKey(), entry.getValue().doubleValue());
        }
      });
    }
    return scores;
  }

  private List<String> readStringArray(JsonNode node) {
    if (node == null || !node.isArray()) {
      return List.of();
    }
    java.util.ArrayList<String> values = new java.util.ArrayList<>();
    for (JsonNode item : node) {
      if (item.isTextual()) {
        values.add(item.asText());
      }
    }
    return values;
  }

  private JsonNode readJson(String json) {
    if (json == null || json.isBlank()) {
      return objectMapper.createObjectNode();
    }
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException exception) {
      return objectMapper.createObjectNode();
    }
  }

  private String normalizeBatchStatus(String status) {
    if (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (!List.of("pending", "in_review", "completed").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_BATCH_STATUS", "unsupported batch status");
    }
    return normalized;
  }

  private String normalizeDisputeStatus(String status) {
    if (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (!List.of("open", "resolved").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DISPUTE_STATUS", "unsupported dispute status");
    }
    return normalized;
  }

  private String normalizeReviewDecision(String decision) {
    if (decision == null || decision.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_DECISION", "review decision is required");
    }
    String normalized = decision.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "approve", "approved" -> "approve";
      case "return", "returned", "reject", "rejected" -> "return";
      case "escalate", "escalate_to_dispute" -> "escalate";
      case "revise", "revised" -> "revise";
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_DECISION", "unsupported review decision");
    };
  }

  private String normalizeStatus(String status) {
    return status == null || status.isBlank() ? "" : status.trim().toLowerCase(Locale.ROOT);
  }

  private long parseLongId(String value, String code) {
    try {
      return Long.parseLong(value);
    } catch (NumberFormatException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id format is invalid");
    }
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private AuthenticatedUser requireReviewer(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    if (!principal.roles().contains("reviewer")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "reviewer role is required");
    }
    return principal;
  }
}
