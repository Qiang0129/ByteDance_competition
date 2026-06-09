package com.labelhub.backend.ownerreview;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.PageResponse;
import com.labelhub.backend.task.TaskDeadlineSettlementService;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

  public ResponseEntity<Resource> downloadTaskAuditLog(
      Authentication authentication,
      long taskId,
      String scope) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    if (!repository.taskBelongsToOwner(owner.id(), taskId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "REVIEW_TASK_NOT_FOUND", "review task not found");
    }
    String normalizedScope = normalizeAuditExportScope(scope);
    boolean humanOnly = "human".equals(normalizedScope);
    List<OwnerReviewRepository.AuditLogRecord> logs =
        repository.listTaskAuditLogForExport(owner.id(), taskId, humanOnly);
    String csv = buildTaskAuditLogCsv(logs);
    String filename = "review-task-" + taskId + "-" + normalizedScope + "-audit-log.csv";
    return csvDownloadResponse(csv, filename);
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

  public OwnerReviewAuditItemTimelineResponse getAuditLogItemTimeline(
      Authentication authentication,
      long logId) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    OwnerReviewRepository.AuditLogRecord root = repository.findAuditLog(owner.id(), logId)
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "REVIEW_AUDIT_LOG_NOT_FOUND",
            "audit log not found"));
    if (root.assignmentId() == null) {
      throw new ApiException(
          HttpStatus.NOT_FOUND,
          "REVIEW_AUDIT_ITEM_NOT_FOUND",
          "audit log item context not found");
    }
    List<OwnerReviewAuditLogEntryResponse> items = repository
        .listAuditLogItemTimeline(owner.id(), root.assignmentId())
        .stream()
        .map(this::toAuditLogResponse)
        .toList();
    return new OwnerReviewAuditItemTimelineResponse(
        Long.toString(root.assignmentId()),
        Long.toString(root.taskId()),
        blankToDefault(root.taskTitle(), "标注任务"),
        root.annotationId() == null ? null : Long.toString(root.annotationId()),
        root.itemId() == null ? null : Long.toString(root.itemId()),
        root.itemIndex(),
        blankToDefault(root.labelerName(), "Labeler"),
        itemTitle(root),
        items);
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
        record.itemIndex(),
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
        record.assignmentId() == null ? null : Long.toString(record.assignmentId()),
        record.annotationId() == null ? null : Long.toString(record.annotationId()),
        record.itemId() == null ? null : Long.toString(record.itemId()),
        record.itemIndex(),
        blankToDefault(record.labelerName(), "Labeler"),
        itemTitle(record),
        blankToDefault(record.operatorName(), "system"),
        normalizeRoleForUi(record.operatorRole()),
        record.action(),
        record.fromState(),
        record.toState(),
        record.reason(),
        formatDateTime(record.occurredAt()));
  }

  private String itemTitle(OwnerReviewRepository.AuditLogRecord record) {
    String taskTitle = blankToDefault(record.taskTitle(), "标注任务");
    return record.itemIndex() == null || record.itemIndex() < 1
        ? taskTitle + " · 题号缺失"
        : taskTitle + " · 第 " + record.itemIndex() + " 题";
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

  private String normalizeAuditExportScope(String scope) {
    if (scope == null || scope.isBlank()) {
      return "human";
    }
    String normalized = scope.trim().toLowerCase(Locale.ROOT);
    if (!List.of("human", "full").contains(normalized)) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_REVIEW_AUDIT_EXPORT_SCOPE",
          "unsupported audit log export scope");
    }
    return normalized;
  }

  private String buildTaskAuditLogCsv(List<OwnerReviewRepository.AuditLogRecord> logs) {
    StringBuilder csv = new StringBuilder("\uFEFF");
    csv.append(csvRow(
        "日志ID",
        "任务ID",
        "任务标题",
        "题号",
        "Assignment ID",
        "Annotation ID",
        "Item ID",
        "标注员",
        "操作者",
        "操作者角色",
        "动作",
        "原状态",
        "新状态",
        "原因",
        "发生时间"));
    for (OwnerReviewRepository.AuditLogRecord log : logs) {
      csv.append(csvRow(
          Long.toString(log.logId()),
          Long.toString(log.taskId()),
          blankToDefault(log.taskTitle(), "标注任务"),
          log.itemIndex() == null ? "" : Integer.toString(log.itemIndex()),
          log.assignmentId() == null ? "" : Long.toString(log.assignmentId()),
          log.annotationId() == null ? "" : Long.toString(log.annotationId()),
          log.itemId() == null ? "" : Long.toString(log.itemId()),
          blankToDefault(log.labelerName(), "Labeler"),
          blankToDefault(log.operatorName(), "system"),
          normalizeRoleForUi(log.operatorRole()),
          blankToDefault(log.action(), ""),
          blankToDefault(log.fromState(), ""),
          blankToDefault(log.toState(), ""),
          blankToDefault(log.reason(), ""),
          formatDateTime(log.occurredAt())));
    }
    return csv.toString();
  }

  private ResponseEntity<Resource> csvDownloadResponse(String csv, String filename) {
    byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
        .contentLength(bytes.length)
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(filename, StandardCharsets.UTF_8)
                .build()
                .toString())
        .body(new ByteArrayResource(bytes));
  }

  private String csvRow(String... cells) {
    StringBuilder row = new StringBuilder();
    for (int i = 0; i < cells.length; i++) {
      if (i > 0) {
        row.append(',');
      }
      row.append(csvCell(cells[i]));
    }
    row.append('\n');
    return row.toString();
  }

  private String csvCell(String value) {
    String safe = value == null ? "" : value;
    if (safe.contains(",") || safe.contains("\"") || safe.contains("\n") || safe.contains("\r")) {
      return "\"" + safe.replace("\"", "\"\"") + "\"";
    }
    return safe;
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
