package com.labelhub.backend.ownerreview;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.PageResponse;
import com.labelhub.backend.task.TaskDeadlineSettlementService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
public class OwnerReviewService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final List<String> PASS_DECISIONS = List.of("approve", "approved", "revise", "revised");
  private static final List<String> RETURN_DECISIONS = List.of("return", "returned", "reject", "rejected");
  private static final List<String> HUMAN_DECISIONS = List.of(
      "approve", "approved", "revise", "revised", "return", "returned", "reject", "rejected", "escalate");

  private final OwnerReviewRepository repository;
  private final TaskDeadlineSettlementService settlementService;

  public OwnerReviewService(
      OwnerReviewRepository repository,
      TaskDeadlineSettlementService settlementService) {
    this.repository = repository;
    this.settlementService = settlementService;
  }

  public OwnerReviewOverviewResponse getOverview(Authentication authentication, Integer days) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int rangeDays = normalizeDays(days);
    LocalDateTime rangeEnd = LocalDate.now().plusDays(1).atStartOfDay();
    LocalDateTime rangeStart = rangeEnd.minusDays(rangeDays);
    LocalDateTime todayStart = LocalDate.now().atStartOfDay();
    LocalDateTime tomorrowStart = LocalDate.now().plusDays(1).atStartOfDay();

    long submittedInRange = repository.countSubmittedAnnotations(owner.id(), rangeStart, rangeEnd);
    long reviewedAnnotations = repository.countHumanReviewedAnnotations(owner.id(), rangeStart, rangeEnd);
    OwnerReviewRepository.ConsistencyCounts consistency =
        repository.countConsistency(owner.id(), rangeStart, rangeEnd);
    long humanReviewsInRange = repository.countHumanReviews(owner.id(), rangeStart, rangeEnd, HUMAN_DECISIONS);
    long returnedInRange = repository.countHumanReviews(owner.id(), rangeStart, rangeEnd, RETURN_DECISIONS);

    List<ReviewerWorkloadResponse> workloads = repository
        .listReviewerWorkloads(owner.id(), todayStart, tomorrowStart, 8)
        .stream()
        .map(record -> new ReviewerWorkloadResponse(
            Long.toString(record.reviewerId()),
            blankToDefault(record.reviewerName(), "Reviewer"),
            0,
            record.reviewedToday(),
            record.avgDurationSec(),
            record.consistencyTotal() == 0
                ? 0D
                : roundRate((double) record.consistencyMatched() / record.consistencyTotal())))
        .toList();

    return new OwnerReviewOverviewResponse(
        rangeDays,
        repository.countPendingAnnotations(owner.id()),
        repository.countHumanReviews(owner.id(), todayStart, tomorrowStart, PASS_DECISIONS),
        repository.countHumanReviews(owner.id(), todayStart, tomorrowStart, RETURN_DECISIONS),
        repository.countOpenOrRecentDisputes(owner.id(), rangeStart, rangeEnd),
        submittedInRange == 0 ? 0D : roundRate((double) reviewedAnnotations / submittedInRange),
        consistency.total() == 0 ? 0D : roundRate((double) consistency.matched() / consistency.total()),
        humanReviewsInRange == 0 ? 0D : roundRate((double) returnedInRange / humanReviewsInRange),
        workloads);
  }

  public PageResponse<OwnerReviewTaskResponse> listTasks(
      Authentication authentication,
      String status,
      String keyword,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    String normalizedStatus = normalizeTaskStatus(status);
    int safePage = normalizePage(page);
    int safePageSize = normalizePageSize(pageSize);
    List<OwnerReviewTaskResponse> items = repository
        .listTasks(
            owner.id(),
            normalizedStatus,
            keyword,
            safePageSize,
            (safePage - 1) * safePageSize)
        .stream()
        .map(record -> toTaskResponse(owner.id(), record))
        .toList();
    return new PageResponse<>(
        items,
        safePage,
        safePageSize,
        repository.countTasks(owner.id(), normalizedStatus, keyword));
  }

  public List<OwnerReviewReviewerResponse> listReviewers(Authentication authentication) {
    requireOwner(authentication);
    return repository.listReviewers().stream()
        .map(record -> new OwnerReviewReviewerResponse(
            Long.toString(record.reviewerId()),
            blankToDefault(record.reviewerName(), "Reviewer")))
        .toList();
  }

  public PageResponse<OwnerReviewAnnotationResponse> listTaskAnnotations(
      Authentication authentication,
      long taskId,
      String status,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    if (!repository.taskBelongsToOwner(owner.id(), taskId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "REVIEW_TASK_NOT_FOUND", "review task not found");
    }
    String normalizedStatus = normalizeAnnotationStatus(status);
    int safePage = normalizePage(page);
    int safePageSize = normalizePageSize(pageSize);
    List<OwnerReviewAnnotationResponse> items = repository
        .listTaskAnnotations(
            owner.id(),
            taskId,
            normalizedStatus,
            safePageSize,
            (safePage - 1) * safePageSize)
        .stream()
        .map(this::toAnnotationResponse)
        .toList();
    return new PageResponse<>(
        items,
        safePage,
        safePageSize,
        repository.countTaskAnnotations(owner.id(), taskId, normalizedStatus));
  }

  public PageResponse<OwnerReviewAuditLogEntryResponse> listAuditLog(
      Authentication authentication,
      Integer days,
      Long taskId,
      Long reviewerId,
      String operatorRole,
      String action,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int rangeDays = normalizeAuditDays(days);
    if (taskId != null && !repository.taskBelongsToOwner(owner.id(), taskId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "REVIEW_TASK_NOT_FOUND", "review task not found");
    }
    int safePage = normalizePage(page);
    int safePageSize = normalizePageSize(pageSize);
    LocalDateTime end = LocalDate.now().plusDays(1).atStartOfDay();
    LocalDateTime start = end.minusDays(rangeDays);
    List<OwnerReviewAuditLogEntryResponse> items = repository
        .listAuditLog(
            owner.id(),
            start,
            end,
            taskId,
            reviewerId,
            normalizeOperatorRole(operatorRole),
            blankToNull(action),
            safePageSize,
            (safePage - 1) * safePageSize)
        .stream()
        .map(this::toAuditLogResponse)
        .toList();
    return new PageResponse<>(
        items,
        safePage,
        safePageSize,
        repository.countAuditLog(
            owner.id(),
            start,
            end,
            taskId,
            reviewerId,
            normalizeOperatorRole(operatorRole),
            blankToNull(action)));
  }

  private OwnerReviewTaskResponse toTaskResponse(long ownerId, OwnerReviewRepository.TaskRecord record) {
    double samplingRatio = record.totalAnnotations() == 0
        ? 0D
        : roundRate((double) record.humanReviewedAnnotations() / record.totalAnnotations());
    return new OwnerReviewTaskResponse(
        Long.toString(record.taskId()),
        blankToDefault(record.taskTitle(), "标注任务"),
        blankToDefault(record.taskType(), "通用标注"),
        record.totalAnnotations(),
        record.approvedCount(),
        record.returnedCount(),
        record.inProgress(),
        record.disputes(),
        samplingRatio,
        record.humanReviewedAnnotations(),
        repository.listTaskReviewerNames(ownerId, record.taskId()),
        formatDateTime(record.deadline()),
        record.aiReviewEnabled(),
        formatDateTime(record.updatedAt()));
  }

  private OwnerReviewAnnotationResponse toAnnotationResponse(OwnerReviewRepository.AnnotationRecord record) {
    String status = annotationStatus(record);
    String lastDecision = normalizeDecisionForUi(record.humanDecision());
    return new OwnerReviewAnnotationResponse(
        Long.toString(record.annotationId()),
        Long.toString(record.itemId()),
        blankToDefault(record.labelerName(), "Labeler"),
        formatDateTime(record.submittedAt()),
        status,
        record.aiDecision(),
        lastDecision,
        record.reviewerName(),
        formatDateTime(record.updatedAt()),
        record.reviewCount() > 0);
  }

  private OwnerReviewAuditLogEntryResponse toAuditLogResponse(OwnerReviewRepository.AuditLogRecord record) {
    return new OwnerReviewAuditLogEntryResponse(
        Long.toString(record.logId()),
        record.entityType(),
        Long.toString(record.entityId()),
        Long.toString(record.taskId()),
        record.taskTitle(),
        blankToDefault(record.operatorName(), "system"),
        normalizeRoleForUi(record.operatorRole()),
        record.action(),
        record.fromState(),
        record.toState(),
        record.reason(),
        formatDateTime(record.occurredAt()));
  }

  private String annotationStatus(OwnerReviewRepository.AnnotationRecord record) {
    String decision = normalizeLower(record.humanDecision());
    String annotationStatus = normalizeLower(record.annotationStatus());
    String assignmentStatus = normalizeLower(record.assignmentStatus());
    if ("escalate".equals(decision)) {
      return "disputed";
    }
    if (List.of("revise", "revised").contains(decision) || "revised".equals(annotationStatus)) {
      return "revised";
    }
    if (PASS_DECISIONS.contains(decision)
        || List.of("accepted", "exported").contains(annotationStatus)
        || List.of("accepted", "exported").contains(assignmentStatus)) {
      return "approved";
    }
    if (RETURN_DECISIONS.contains(decision)
        || "returned".equals(annotationStatus)
        || "returned".equals(assignmentStatus)) {
      return "returned";
    }
    return "reviewing";
  }

  private String normalizeDecisionForUi(String decision) {
    if (decision == null || decision.isBlank()) {
      return null;
    }
    return switch (decision.trim().toLowerCase(Locale.ROOT)) {
      case "approve", "approved" -> "APPROVE";
      case "return", "returned", "reject", "rejected" -> "RETURN";
      case "revise", "revised" -> "REVISE";
      case "escalate", "escalate_to_dispute" -> "ESCALATE";
      default -> decision.trim().toUpperCase(Locale.ROOT);
    };
  }

  private String normalizeTaskStatus(String status) {
    if (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (!List.of("in_progress", "completed", "has_disputes").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_STATUS", "unsupported review status");
    }
    return normalized;
  }

  private String normalizeAnnotationStatus(String status) {
    if (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) {
      return null;
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (!List.of("reviewing", "approved", "returned", "revised", "disputed").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_STATUS", "unsupported annotation status");
    }
    return normalized;
  }

  private String normalizeOperatorRole(String role) {
    if (role == null || role.isBlank() || "all".equalsIgnoreCase(role)) {
      return null;
    }
    String normalized = role.trim().toLowerCase(Locale.ROOT);
    if (!List.of("owner", "labeler", "reviewer", "system_agent", "ai_reviewer").contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_OPERATOR_ROLE", "unsupported operator role");
    }
    return normalized;
  }

  private String normalizeRoleForUi(String role) {
    String normalized = normalizeLower(role);
    if ("ai_reviewer".equals(normalized)) {
      return "system_agent";
    }
    if (List.of("owner", "labeler", "reviewer", "system_agent").contains(normalized)) {
      return normalized;
    }
    return "system_agent";
  }

  private int normalizeDays(Integer days) {
    int normalized = days == null ? 30 : days;
    if (normalized < 1 || normalized > 365) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_DAYS", "review days must be between 1 and 365");
    }
    return normalized;
  }

  private int normalizeAuditDays(Integer days) {
    int normalized = days == null ? 7 : days;
    if (normalized < 1 || normalized > 365) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVIEW_DAYS", "review days must be between 1 and 365");
    }
    return normalized;
  }

  private int normalizePage(Integer page) {
    return page == null || page < 1 ? 1 : page;
  }

  private int normalizePageSize(Integer pageSize) {
    return pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private String normalizeLower(String value) {
    return value == null || value.isBlank() ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private double roundRate(double value) {
    return Math.round(value * 1000D) / 1000D;
  }

  private void settleExpiredTasks() {
    settlementService.settleExpiredTasks();
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
    }
    return principal;
  }
}
