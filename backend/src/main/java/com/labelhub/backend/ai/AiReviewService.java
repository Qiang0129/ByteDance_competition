package com.labelhub.backend.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AiReviewService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

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

  @Transactional
  public AiReviewJobResponse claimNext(Authentication authentication) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = aiReviewRepository.findNextPendingJob()
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_JOB_NOT_FOUND", "pending ai review job not found"));
    aiReviewRepository.markRunning(job.id());
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
    return toResponse(aiReviewRepository.lockJob(job.id()).orElse(job));
  }

  @Transactional
  public AiReviewJobResponse complete(
      Authentication authentication,
      long jobId,
      AiReviewCompleteRequest request) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    String decision = normalizeDecision(request == null ? null : request.decision());
    String annotationTarget = "PASS".equals(decision) ? "reviewing" : "reviewing";
    aiReviewRepository.createResult(
        job.id(),
        writeNullableJson(request == null ? null : request.scores()),
        decision,
        request == null ? null : request.comment(),
        request == null ? null : request.promptSnapshot(),
        writeNullableJson(request == null ? null : request.responseJson()));
    aiReviewRepository.markSucceeded(job.id());
    int annotationUpdated = aiReviewRepository.updateAnnotationStatus(job.annotationId(), annotationTarget);
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
        Map.of("jobId", job.id(), "status", "succeeded", "decision", decision),
        null);
    if (annotationUpdated > 0) {
      stateMachineService.audit(
          WorkflowEntityType.ANNOTATION,
          job.annotationId(),
          operator,
          resolveOperatorRole(operator),
          "ai_review.complete",
          "ai_reviewing",
          annotationTarget,
          "ai review completed",
          Map.of("annotationId", job.annotationId(), "status", "ai_reviewing"),
          Map.of("annotationId", job.annotationId(), "status", annotationTarget, "decision", decision),
          null);
    }
    return toResponse(aiReviewRepository.lockJob(job.id()).orElse(job));
  }

  @Transactional
  public AiReviewJobResponse fail(
      Authentication authentication,
      long jobId,
      AiReviewFailRequest request) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    aiReviewRepository.markFailed(job.id(), request == null ? null : request.errorSummary());
    stateMachineService.audit(
        WorkflowEntityType.AI_REVIEW_JOB,
        job.id(),
        operator,
        resolveOperatorRole(operator),
        "ai_review.fail",
        job.status(),
        "failed",
        request == null ? null : request.errorSummary(),
        Map.of("jobId", job.id(), "status", job.status()),
        Map.of("jobId", job.id(), "status", "failed"),
        null);
    return toResponse(aiReviewRepository.lockJob(job.id()).orElse(job));
  }

  @Transactional
  public AiReviewJobResponse retry(Authentication authentication, long jobId) {
    AuthenticatedUser operator = requireAiOperator(authentication);
    AiReviewRepository.AiReviewJobRecord job = lockJob(jobId);
    aiReviewRepository.retry(job.id());
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
    return toResponse(aiReviewRepository.lockJob(job.id()).orElse(job));
  }

  private AiReviewRepository.AiReviewJobRecord lockJob(long jobId) {
    return aiReviewRepository.lockJob(jobId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AI_REVIEW_JOB_NOT_FOUND", "ai review job not found"));
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

  private String writeNullableJson(JsonNode node) {
    if (node == null || node.isNull()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(node);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "json cannot be serialized");
    }
  }

  private AiReviewJobResponse toResponse(AiReviewRepository.AiReviewJobRecord record) {
    return new AiReviewJobResponse(
        Long.toString(record.id()),
        Long.toString(record.annotationId()),
        record.status(),
        record.retryCount(),
        record.errorSummary(),
        formatDateTime(record.availableAt()),
        formatDateTime(record.startedAt()),
        formatDateTime(record.finishedAt()));
  }

  private String resolveOperatorRole(AuthenticatedUser operator) {
    if (operator.roles().contains("system_agent")) {
      return "system_agent";
    }
    if (operator.roles().contains("reviewer")) {
      return "reviewer";
    }
    return "owner";
  }

  private AuthenticatedUser requireAiOperator(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    if (principal.roles().stream().noneMatch(role -> List.of("system_agent", "reviewer", "owner").contains(role))) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "ai review operator role is required");
    }
    return principal;
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }
}
