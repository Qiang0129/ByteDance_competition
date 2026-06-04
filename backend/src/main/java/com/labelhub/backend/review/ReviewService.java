package com.labelhub.backend.review;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.annotation.AnswerValidationService;
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
  private static final int RETURN_REWORK_WINDOW_HOURS = 48;
  private static final int AUTO_DISPUTE_REVISION_NO = 3;

  private final ReviewRepository reviewRepository;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;
  private final AnswerValidationService answerValidationService;

  public ReviewService(
      ReviewRepository reviewRepository,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper,
      AnswerValidationService answerValidationService) {
    this.reviewRepository = reviewRepository;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
    this.answerValidationService = answerValidationService;
  }

  public ReviewerOverviewResponse getOverview(Authentication authentication, Integer days) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    int rangeDays = days == null || days < 1 ? 30 : Math.min(days, 365);
    return new ReviewerOverviewResponse(
        rangeDays,
        reviewRepository.countPendingBatches(reviewer.id()),
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
    AuthenticatedUser reviewer = requireReviewer(authentication);
    String normalizedStatus = normalizeBatchStatus(status);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    List<ReviewBatchResponse> items = reviewRepository
        .listBatches(reviewer.id(), normalizedStatus, keyword, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toBatchResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countBatches(reviewer.id(), normalizedStatus, keyword));
  }

  public ReviewBatchResponse claimBatch(Authentication authentication, long batchId) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    return reviewRepository.findBatch(reviewer.id(), batchId)
        .map(this::toBatchResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "REVIEW_BATCH_NOT_FOUND", "review batch not found"));
  }

  public ReviewerPageResponse<AnnotationToReviewResponse> listAnnotations(
      Authentication authentication,
      String batchId,
      String decision,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    long taskId = "all".equalsIgnoreCase(batchId) ? 0L : parseLongId(batchId, "INVALID_REVIEW_BATCH_ID");
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    String normalizedDecision = decision == null || decision.isBlank()
        ? null
        : decision.trim().toLowerCase(Locale.ROOT);
    List<AnnotationToReviewResponse> items = reviewRepository
        .listAnnotations(reviewer.id(), taskId, normalizedDecision, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toAnnotationResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countAnnotations(reviewer.id(), taskId, normalizedDecision));
  }

  public ReviewerPageResponse<AiReviewTaskSummaryResponse> listAiReviewTasks(
      Authentication authentication,
      String decision,
      String keyword,
      String view,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    String normalizedDecision = normalizeAiDecisionFilter(decision);
    String normalizedView = normalizeReviewerView(view);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    List<AiReviewTaskSummaryResponse> items = reviewRepository
        .listAiReviewTaskSummaries(
            reviewer.id(),
            normalizedView,
            normalizedDecision,
            keyword,
            safePageSize,
            (safePage - 1) * safePageSize)
        .stream()
        .map(this::toAiReviewTaskSummaryResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countAiReviewTaskSummaries(reviewer.id(), normalizedView, normalizedDecision, keyword));
  }

  public ReviewerPageResponse<AnnotationToReviewResponse> listAiReviewAnnotations(
      Authentication authentication,
      long taskId,
      String decision,
      String keyword,
      String view,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    String normalizedDecision = normalizeAiDecisionFilter(decision);
    String normalizedView = normalizeReviewerView(view);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    List<AnnotationToReviewResponse> items = reviewRepository
        .listAiReviewAnnotations(
            reviewer.id(),
            normalizedView,
            taskId,
            normalizedDecision,
            keyword,
            safePageSize,
            (safePage - 1) * safePageSize)
        .stream()
        .map(this::toAnnotationResponse)
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countAiReviewAnnotations(reviewer.id(), normalizedView, taskId, normalizedDecision, keyword));
  }

  @Transactional
  public AnnotationToReviewResponse submitDecision(
      Authentication authentication,
      long annotationId,
      ReviewDecisionRequest request) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    String decision = normalizeReviewDecision(request == null ? null : request.decision());
    String reason = effectiveReason(request);
    ReviewRepository.AnnotationStateRecord state = reviewRepository.lockAnnotationState(annotationId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
    ensureReviewerAssigned(reviewer, annotationId);
    ensureReviewable(state.annotationStatus());
    int roundNo = reviewRepository.nextReviewRound(annotationId);
    Long responseAnnotationId = null;

    switch (decision) {
      case "approve" -> approve(reviewer, state, reason, roundNo);
      case "return" -> returnToLabeler(reviewer, state, reason, roundNo, true);
      case "escalate" -> escalate(reviewer, state, reason, roundNo);
      case "revise" -> responseAnnotationId = revise(reviewer, state, reason, request, roundNo);
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_DECISION", "unsupported review decision");
    }

    long lookupAnnotationId = responseAnnotationId == null ? annotationId : responseAnnotationId;
    return reviewRepository.findAnnotation(lookupAnnotationId)
        .map(this::toAnnotationResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
  }

  public ReviewerPageResponse<DisputeItemResponse> listDisputes(
      Authentication authentication,
      String status,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    String normalizedStatus = normalizeDisputeStatus(status);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    List<DisputeItemResponse> items = reviewRepository
        .listDisputes(normalizedStatus, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(record -> toDisputeResponse(record, reviewer))
        .toList();
    return new ReviewerPageResponse<>(
        items,
        safePage,
        safePageSize,
        reviewRepository.countDisputes(normalizedStatus));
  }

  public DisputeDetailResponse getDisputeDetail(
      Authentication authentication,
      long disputeId) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    ReviewRepository.DisputeRecord dispute = reviewRepository.findDispute(disputeId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DISPUTE_NOT_FOUND", "dispute not found"));
    AnnotationToReviewResponse annotation = reviewRepository.findAnnotation(dispute.annotationId())
        .map(this::toAnnotationResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
    return new DisputeDetailResponse(
        toDisputeResponse(dispute, reviewer),
        annotation);
  }

  @Transactional
  public DisputeItemResponse resolveDispute(
      Authentication authentication,
      long disputeId,
      ResolveDisputeRequest request) {
    AuthenticatedUser reviewer = requireReviewer(authentication);
    ReviewRepository.DisputeRecord dispute = reviewRepository.findDispute(disputeId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DISPUTE_NOT_FOUND", "dispute not found"));
    if (dispute.raisedById() == reviewer.id()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "DISPUTE_SELF_RESOLVE_FORBIDDEN",
          "the reviewer who raised the dispute cannot resolve it");
    }
    String resolution = request == null || request.resolution() == null
        ? ""
        : request.resolution().trim().toLowerCase(Locale.ROOT);
    ReviewDecisionRequest decision = switch (resolution) {
      case "approve" -> new ReviewDecisionRequest("APPROVE", request == null ? null : request.note(), null, false, null);
      case "reject" -> new ReviewDecisionRequest("RETURN", request == null ? null : request.note(), null, false, null);
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DISPUTE_RESOLUTION", "unsupported dispute resolution");
    };
    submitDisputeDecision(reviewer, dispute.annotationId(), decision);
    return reviewRepository.findDispute(disputeId)
        .map(record -> toDisputeResponse(record, reviewer))
        .orElseGet(() -> toDisputeResponse(dispute, reviewer));
  }

  private void submitDecisionForReviewer(
      AuthenticatedUser reviewer,
      long annotationId,
      ReviewDecisionRequest request) {
    applyReviewerDecision(reviewer, annotationId, request, true);
  }

  private void submitDisputeDecision(
      AuthenticatedUser reviewer,
      long annotationId,
      ReviewDecisionRequest request) {
    applyReviewerDecision(reviewer, annotationId, request, false);
  }

  private void applyReviewerDecision(
      AuthenticatedUser reviewer,
      long annotationId,
      ReviewDecisionRequest request,
      boolean requireAssignment) {
    String decision = normalizeReviewDecision(request.decision());
    ReviewRepository.AnnotationStateRecord state = reviewRepository.lockAnnotationState(annotationId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ANNOTATION_NOT_FOUND", "annotation not found"));
    if (requireAssignment) {
      ensureReviewerAssigned(reviewer, annotationId);
    }
    ensureReviewable(state.annotationStatus());
    int roundNo = reviewRepository.nextReviewRound(annotationId);
    String reason = effectiveReason(request);
    if ("approve".equals(decision)) {
      approve(reviewer, state, reason, roundNo);
    } else if ("return".equals(decision)) {
      returnToLabeler(reviewer, state, reason, roundNo, false);
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
      int roundNo,
      boolean autoEscalateOnFinalReview) {
    if (reason == null || reason.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "RETURN_REASON_REQUIRED", "return reason is required");
    }
    if (autoEscalateOnFinalReview && state.revisionNo() >= AUTO_DISPUTE_REVISION_NO) {
      escalate(reviewer, state, autoDisputeReason(reason), roundNo);
      return;
    }
    LocalDateTime resubmitDeadline = LocalDateTime.now().plusHours(RETURN_REWORK_WINDOW_HOURS);
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.updateAnnotationStatus(state.annotationId(), "returned");
    reviewRepository.returnAssignmentForRework(state.assignmentId(), resubmitDeadline);
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
        Map.of("resubmitDeadline", resubmitDeadline));
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
        Map.of(
            "assignmentId", state.assignmentId(),
            "status", "returned",
            "resubmitDeadline", resubmitDeadline),
        Map.of("resubmitDeadline", resubmitDeadline));
  }

  private void escalate(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state,
      String reason,
      int roundNo) {
    if (reason == null || reason.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "DISPUTE_REASON_REQUIRED", "dispute reason is required");
    }
    if (reviewRepository.hasOpenDispute(state.annotationId())) {
      throw new ApiException(HttpStatus.CONFLICT, "DISPUTE_ALREADY_OPEN", "open dispute already exists");
    }
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.createHumanReview(
        state.annotationId(),
        reviewer.id(),
        roundNo,
        "escalate",
        reason,
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

  private String autoDisputeReason(String reason) {
    return reason + "\n\n多轮返修后再次打回，自动升级争议。";
  }

  private long revise(
      AuthenticatedUser reviewer,
      ReviewRepository.AnnotationStateRecord state,
      String reason,
      ReviewDecisionRequest request,
      int roundNo) {
    if (request == null || request.answerJson() == null || !request.answerJson().isObject()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "REVISION_ANSWER_REQUIRED", "revision answerJson is required");
    }
    RevisionSchema schema = revisionSchema(state);
    JsonNode answerJson = answerValidationService.requireAnswerObject(request.answerJson());
    JsonNode visibleAnswerJson = answerValidationService.filterVisibleAnswer(answerJson, schema.fields());
    answerValidationService.validateAnswer(visibleAnswerJson, schema.fields());
    JsonNode originalAnswerJson = readJson(state.answerJson());
    if (jsonEquivalent(originalAnswerJson, visibleAnswerJson)) {
      throw new ApiException(HttpStatus.CONFLICT, "NO_REVISION_CHANGE", "revision answer has no changes");
    }
    String fromState = effectiveReviewFromState(state.annotationStatus());
    String diffJson = writeJson(buildRevisionDiff(originalAnswerJson, visibleAnswerJson));
    transitionAnnotationToReviewingIfNeeded(reviewer, state);
    reviewRepository.updateAnnotationStatus(state.annotationId(), "revised");
    reviewRepository.createHumanReview(state.annotationId(), reviewer.id(), roundNo, "revise", reason, diffJson);
    int nextRevisionNo = state.revisionNo() + 1;
    long revisedAnnotationId = reviewRepository.createAnnotation(
        state.assignmentId(),
        state.schemaVersionId(),
        schema.schemaSnapshotJson(),
        writeJson(visibleAnswerJson),
        nextRevisionNo,
        "accepted");
    reviewRepository.updateAssignmentStatus(state.assignmentId(), "accepted");
    reviewRepository.updateItemStatus(state.itemId(), "accepted");
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        state.annotationId(),
        reviewer,
        "reviewer",
        "human_review.revise",
        fromState,
        "revised",
        reason,
        Map.of("annotationId", state.annotationId(), "status", fromState, "answerJson", originalAnswerJson),
        Map.of("annotationId", state.annotationId(), "status", "revised"),
        readJson(diffJson));
    stateMachineService.audit(
        WorkflowEntityType.ANNOTATION,
        revisedAnnotationId,
        reviewer,
        "reviewer",
        "human_review.revise.accept",
        "submitted",
        "accepted",
        reason,
        Map.of("annotationId", revisedAnnotationId, "status", "submitted", "revisionNo", nextRevisionNo),
        Map.of("annotationId", revisedAnnotationId, "status", "accepted", "revisionNo", nextRevisionNo),
        Map.of(
            "sourceAnnotationId", state.annotationId(),
            "annotationId", revisedAnnotationId,
            "assignmentId", state.assignmentId(),
            "revisionNo", nextRevisionNo,
            "answerJson", visibleAnswerJson));
    stateMachineService.audit(
        WorkflowEntityType.ASSIGNMENT,
        state.assignmentId(),
        reviewer,
        "reviewer",
        "human_review.revise.accept",
        state.assignmentStatus(),
        "accepted",
        reason,
        Map.of("assignmentId", state.assignmentId(), "status", state.assignmentStatus()),
        Map.of("assignmentId", state.assignmentId(), "status", "accepted"),
        Map.of("sourceAnnotationId", state.annotationId(), "annotationId", revisedAnnotationId));
    return revisedAnnotationId;
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

  private void ensureReviewerAssigned(AuthenticatedUser reviewer, long annotationId) {
    if (!reviewRepository.canReviewerAccessAnnotation(reviewer.id(), annotationId)) {
      throw new ApiException(
          HttpStatus.FORBIDDEN,
          "REVIEWER_NOT_ASSIGNED",
          "reviewer is not assigned to this annotation");
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

  private AiReviewTaskSummaryResponse toAiReviewTaskSummaryResponse(
      ReviewRepository.AiReviewTaskSummaryRecord record) {
    return new AiReviewTaskSummaryResponse(
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.taskType(),
        record.total(),
        record.passCount(),
        record.needHumanCount(),
        record.rejectCount(),
        record.pendingHuman(),
        record.reviewedCount(),
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
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.taskType(),
        record.itemIndex(),
        readJson(record.answerJson()),
        readJson(record.previousAnswerJson()),
        readJson(record.rawPayloadJson()),
        schemaFields(record.schemaSnapshotJson()),
        toAiResult(record),
        record.humanDecision() == null ? null : record.humanDecision().toUpperCase(Locale.ROOT),
        record.revisionNo(),
        record.dispute(),
        buildReviewTimeline(record),
        record.humanReason(),
        formatDateTime(record.humanReviewedAt()),
        record.humanReviewerName());
  }

  private String effectiveReason(ReviewDecisionRequest request) {
    if (request == null) {
      return null;
    }
    if (request.reason() != null && !request.reason().isBlank()) {
      return request.reason().trim();
    }
    return request.note() == null || request.note().isBlank() ? null : request.note().trim();
  }

  private RevisionSchema revisionSchema(ReviewRepository.AnnotationStateRecord state) {
    JsonNode root = readJson(state.schemaSnapshotJson());
    JsonNode fieldsNode = root.path("fields");
    if (!fieldsNode.isArray()) {
      throw new ApiException(HttpStatus.CONFLICT, "REVISION_SCHEMA_MISSING", "annotation schema snapshot is missing");
    }
    return new RevisionSchema(writeJson(root), (ArrayNode) fieldsNode);
  }

  private JsonNode schemaFields(String schemaSnapshotJson) {
    JsonNode fields = readJson(schemaSnapshotJson).path("fields");
    return fields.isArray() ? fields : objectMapper.createArrayNode();
  }

  private boolean jsonEquivalent(JsonNode left, JsonNode right) {
    return left == null ? right == null : left.equals(right);
  }

  private ObjectNode buildRevisionDiff(JsonNode before, JsonNode after) {
    ObjectNode diff = objectMapper.createObjectNode();
    diff.set("before", before);
    diff.set("after", after);
    ArrayNode changedFields = objectMapper.createArrayNode();
    java.util.LinkedHashSet<String> keys = new java.util.LinkedHashSet<>();
    before.fieldNames().forEachRemaining(keys::add);
    after.fieldNames().forEachRemaining(keys::add);
    for (String key : keys) {
      JsonNode beforeValue = before.get(key);
      JsonNode afterValue = after.get(key);
      if (beforeValue == null || afterValue == null || !jsonEquivalent(beforeValue, afterValue)) {
        changedFields.add(key);
      }
    }
    diff.set("changedFields", changedFields);
    return diff;
  }

  private DisputeItemResponse toDisputeResponse(
      ReviewRepository.DisputeRecord record,
      AuthenticatedUser reviewer) {
    boolean canResolve = "open".equals(record.status()) && record.raisedById() != reviewer.id();
    return new DisputeItemResponse(
        Long.toString(record.disputeId()),
        Long.toString(record.annotationId()),
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.reason(),
        Long.toString(record.raisedById()),
        record.raisedBy(),
        formatDateTime(record.raisedAt()),
        record.status(),
        resolveDisputeEscalationStageLabel(record.revisionNo()),
        canResolve,
        record.rounds());
  }

  private String resolveDisputeEscalationStageLabel(int revisionNo) {
    return revisionNo <= 1 ? "初审升级" : "复审升级";
  }

  private AiReviewResultResponse toAiResult(ReviewRepository.AnnotationReviewRecord record) {
    if (record.aiDecision() == null || record.aiDecision().isBlank()) {
      return null;
    }
    Map<String, Double> scores = readScores(record.aiScoresJson());
    double total = record.aiTotalScore() == null
        ? scores.values().stream().mapToDouble(Double::doubleValue).average().orElse(0)
        : record.aiTotalScore();
    JsonNode response = readJson(record.aiResponseJson());
    List<String> riskFlags = readStringArray(readJson(record.aiRiskFlagsJson()));
    if (riskFlags.isEmpty()) {
      riskFlags = readStringArray(response.path("risk_flags"));
    }
    List<String> evidence = readStringArray(readJson(record.aiEvidenceJson()));
    if (evidence.isEmpty()) {
      evidence = readStringArray(response.path("evidence"));
    }
    return new AiReviewResultResponse(
        scores,
        total,
        record.aiDecision(),
        record.aiComment() == null ? "" : record.aiComment(),
        riskFlags,
        evidence,
        buildAiResultVersion(record),
        record.aiModelName());
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

  private String writeJson(JsonNode node) {
    try {
      return objectMapper.writeValueAsString(node);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize json", exception);
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

  private String normalizeAiDecisionFilter(String decision) {
    if (decision == null || decision.isBlank() || "all".equalsIgnoreCase(decision)) {
      return null;
    }
    String normalized = decision.trim().toUpperCase(Locale.ROOT);
    if ("NEED_HUMAN".equals(normalized)) {
      normalized = "NEED_HUMAN_REVIEW";
    }
    if (!List.of("PASS", "NEED_HUMAN_REVIEW", "REJECT").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_REVIEW_DECISION", "unsupported ai review decision");
    }
    return normalized;
  }

  /**
   * 归一化 Reviewer 视图参数,默认 pending。
   * pending  - 仅未由当前 reviewer 审过的待审条目;
   * reviewed - 仅当前 reviewer 已审过的条目;
   * all      - 两者并集。
   */
  private String normalizeReviewerView(String view) {
    if (view == null || view.isBlank()) {
      return "pending";
    }
    String normalized = view.trim().toLowerCase(Locale.ROOT);
    if (!List.of("pending", "reviewed", "all").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_VIEW", "unsupported review view");
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

  private List<ReviewTimelineStageResponse> buildReviewTimeline(
      ReviewRepository.AnnotationReviewRecord record) {
    List<ReviewRepository.ReviewTimelineEventRecord> events =
        reviewRepository.listAssignmentReviewTimeline(record.assignmentId());
    if (!events.isEmpty()) {
      java.util.ArrayList<ReviewTimelineStageResponse> timeline = new java.util.ArrayList<>();
      for (ReviewRepository.ReviewTimelineEventRecord event : events) {
        if ("ai_review".equals(event.eventStage())) {
          AiReviewResultResponse aiResult = toAiResult(event);
          timeline.add(new ReviewTimelineStageResponse(
              event.revisionNo(),
              "ai_review",
              "AI预审（Revision " + event.revisionNo() + "）",
              aiResult == null ? "pending" : "completed",
              "AI Agent",
              aiResult == null ? null : aiResult.decision(),
              aiResult == null ? null : aiResult.total_score(),
              aiResult == null ? "等待 AI 预审结果" : aiResult.comment(),
              null,
              formatDateTime(event.aiFinishedAt())));
          continue;
        }

        String humanDecision = event.humanDecision() == null
            ? null
            : event.humanDecision().toUpperCase(Locale.ROOT);
        timeline.add(new ReviewTimelineStageResponse(
            event.revisionNo(),
            "human_review",
            resolveHumanTimelineTitle(event.revisionNo(), humanDecision),
            humanDecision == null ? "pending" : "completed",
            event.humanReviewerName() == null || event.humanReviewerName().isBlank()
                ? "Reviewer"
                : event.humanReviewerName(),
            humanDecision,
            null,
            humanDecision == null ? "等待 Reviewer 人工审核" : null,
            event.humanReason(),
            formatDateTime(event.humanReviewedAt())));
      }
      return timeline;
    }

    AiReviewResultResponse aiResult = toAiResult(record);
    ReviewTimelineStageResponse aiStage = new ReviewTimelineStageResponse(
        record.revisionNo(),
        "ai_review",
        "AI预审（Revision " + record.revisionNo() + "）",
        aiResult == null ? "pending" : "completed",
        "AI Agent",
        aiResult == null ? null : aiResult.decision(),
        aiResult == null ? null : aiResult.total_score(),
        aiResult == null ? "等待 AI 预审结果" : aiResult.comment(),
        null,
        formatDateTime(record.aiFinishedAt()));

    String humanDecision = record.humanDecision() == null
        ? null
        : record.humanDecision().toUpperCase(Locale.ROOT);
    ReviewTimelineStageResponse humanStage = new ReviewTimelineStageResponse(
        record.revisionNo(),
        "human_review",
        resolveHumanTimelineTitle(record.revisionNo(), humanDecision),
        humanDecision == null ? "pending" : "completed",
        record.humanReviewerName() == null || record.humanReviewerName().isBlank()
            ? "Reviewer"
            : record.humanReviewerName(),
        humanDecision,
        null,
        humanDecision == null ? "等待 Reviewer 人工审核" : null,
        record.humanReason(),
        formatDateTime(record.humanReviewedAt()));
    return List.of(aiStage, humanStage);
  }

  private String resolveHumanTimelineTitle(int revisionNo, String decision) {
    if ("ESCALATE".equals(decision)) {
      return revisionNo <= 1 ? "初审升级" : "复审升级";
    }
    return resolveReviewStageLabel(revisionNo);
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

  private AiReviewResultResponse toAiResult(ReviewRepository.ReviewTimelineEventRecord record) {
    if (record.aiDecision() == null || record.aiDecision().isBlank()) {
      return null;
    }
    return new AiReviewResultResponse(
        Map.of(),
        record.aiTotalScore() == null ? 0 : record.aiTotalScore(),
        record.aiDecision(),
        record.aiComment() == null ? "" : record.aiComment(),
        List.of(),
        List.of(),
        null,
        null);
  }

  private String buildAiResultVersion(ReviewRepository.AnnotationReviewRecord record) {
    String ruleName = record.aiRuleName();
    String ruleVersion = record.aiRuleVersion();
    String modelName = record.aiModelName();
    String rulePart = ruleName == null || ruleName.isBlank()
        ? ""
        : ruleVersion == null || ruleVersion.isBlank()
            ? ruleName
            : ruleName + " v" + ruleVersion;
    if (modelName == null || modelName.isBlank()) {
      return rulePart.isBlank() ? null : rulePart;
    }
    return rulePart.isBlank() ? modelName : rulePart + " · " + modelName;
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

  private record RevisionSchema(String schemaSnapshotJson, ArrayNode fields) {}
}
