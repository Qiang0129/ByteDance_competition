package com.labelhub.backend.dashboard;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
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
public class DashboardService {

  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
  private static final String[] MONTH_LABELS = {
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  };

  private final DashboardRepository repository;
  private final TaskDeadlineSettlementService settlementService;

  public DashboardService(
      DashboardRepository repository,
      TaskDeadlineSettlementService settlementService) {
    this.repository = repository;
    this.settlementService = settlementService;
  }

  public DashboardOverviewResponse getOverview(Authentication authentication, String range) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    DateRange dateRange = dashboardRange(range);
    DateRange previous = previousRange(dateRange);
    long activeTasks = repository.countActiveTasks(owner.id());
    long labelerCount = repository.countActiveUsersByRole("labeler");
    long pendingReview = repository.countPendingReview(owner.id());
    long reviewerCount = repository.countActiveUsersByRole("reviewer");
    DashboardRepository.AiDecisionCounts ai = safeAiCounts(
        repository.countAiDecisions(owner.id(), dateRange.start(), dateRange.end()));
    DashboardRepository.AiDecisionCounts previousAi = safeAiCounts(
        repository.countAiDecisions(owner.id(), previous.start(), previous.end()));
    double aiPassRate = ai.total() == 0 ? 0D : (double) ai.aiPass() / ai.total();
    double previousAiPassRate = previousAi.total() == 0 ? 0D : (double) previousAi.aiPass() / previousAi.total();
    long avgDurationSec = repository.averageDurationSec(owner.id(), dateRange.start(), dateRange.end());
    long previousAvgDurationSec = repository.averageDurationSec(owner.id(), previous.start(), previous.end());

    return new DashboardOverviewResponse(
        DATE.format(dateRange.start().toLocalDate()),
        DATE.format(dateRange.end().toLocalDate()),
        new DashboardOverviewResponse.Kpis(
            activeTasks,
            labelerCount,
            pendingReview,
            reviewerCount,
            roundRate(aiPassRate),
            avgDurationSec,
            new DashboardOverviewResponse.Deltas(
                0D,
                0D,
                percentDelta(aiPassRate, previousAiPassRate),
                percentDelta(avgDurationSec, previousAvgDurationSec))));
  }

  public DashboardItemsResponse<TaskProgressResponse> getTaskProgress(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    return buildTaskProgressResponse(owner.id(), 12);
  }

  public DashboardItemsResponse<TaskProgressResponse> getTaskProgressChart(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    return buildTaskProgressResponse(owner.id(), 12);
  }

  private DashboardItemsResponse<TaskProgressResponse> buildTaskProgressResponse(long ownerId, int limit) {
    List<TaskProgressResponse> items = repository.listTaskProgress(ownerId, limit).stream()
        .map(record -> {
          long total = Math.max(record.total(), 0);
          long approved = Math.max(record.approved(), 0);
          long returned = Math.max(record.returned(), 0);
          return new TaskProgressResponse(
              Long.toString(record.taskId()),
              blankToDefault(record.title(), "标注任务"),
              total,
              approved,
              returned,
              Math.max(total - approved - returned, 0));
        })
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DashboardItemsResponse<DashboardRoleUserResponse> getRoleUsers(
      Authentication authentication,
      String role) {
    requireOwner(authentication);
    String safeRole = normalizeRoleUserQuery(role);
    List<DashboardRoleUserResponse> items = repository.listActiveUsersByRole(safeRole).stream()
        .map(record -> new DashboardRoleUserResponse(
            Long.toString(record.userId()),
            blankToDefault(record.username(), "-"),
            blankToDefault(record.name(), record.username()),
            blankToDefault(record.status(), "-"),
            record.roles()))
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public ReviewDistributionResponse getReviewDistribution(Authentication authentication, String range, Integer year) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    DateRange dateRange = reviewDistributionRange(range, year);
    return buildReviewDistribution(owner.id(), dateRange);
  }

  public ResponseEntity<Resource> downloadReviewDistributionReport(Authentication authentication, Integer year) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int safeYear = normalizeYear(year);
    DateRange dateRange = yearRange(safeYear);
    ReviewDistributionResponse distribution = buildReviewDistribution(owner.id(), dateRange);
    long total = distribution.aiPass()
        + distribution.aiNeedHuman()
        + distribution.aiReject()
        + distribution.humanPass()
        + distribution.humanReturned()
        + distribution.humanDisputed();
    String csv = buildReviewDistributionCsv(safeYear, distribution, total);
    byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
    String filename = "review-distribution-" + safeYear + ".csv";

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

  private ReviewDistributionResponse buildReviewDistribution(long ownerId, DateRange dateRange) {
    DashboardRepository.AiDecisionCounts ai = safeAiCounts(
        repository.countAiDecisions(ownerId, dateRange.start(), dateRange.end()));
    DashboardRepository.HumanDecisionCounts human = safeHumanCounts(
        repository.countHumanDecisions(ownerId, dateRange.start(), dateRange.end()));
    DashboardRepository.DisputeStatsRecord disputes = repository.getDisputeStats(
        ownerId,
        dateRange.start(),
        dateRange.end());
    return new ReviewDistributionResponse(
        ai.aiPass(),
        ai.aiNeedHuman(),
        ai.aiReject(),
        human.humanPass(),
        human.humanReturned(),
        disputes == null ? 0L : disputes.disputed());
  }

  public DashboardItemsResponse<LabelerPerformanceResponse> getLabelerPerformance(
      Authentication authentication,
      String range) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    DateRange dateRange = dashboardRange(range);
    List<LabelerPerformanceResponse> items = repository
        .listLabelerPerformance(owner.id(), dateRange.start(), dateRange.end(), 10)
        .stream()
        .map(record -> new LabelerPerformanceResponse(
            Long.toString(record.labelerId()),
            blankToDefault(record.labelerName(), "Labeler"),
            blankToDefault(record.role(), "通用标注"),
            null,
            record.submitted() == 0 ? 0D : roundRate((double) record.approved() / record.submitted())))
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DashboardItemsResponse<SubmissionTimelineMonthResponse> getSubmissionTimeline(
      Authentication authentication,
      Integer year) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int safeYear = normalizeYear(year);
    List<SubmissionTimelineMonthResponse> items = repository.listSubmissionTimeline(owner.id(), safeYear).stream()
        .map(record -> new SubmissionTimelineMonthResponse(
            monthLabel(record.monthNo()),
            record.onTime(),
            record.late(),
            record.absent()))
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DashboardItemsResponse<RoleBreakdownResponse> getRoleBreakdown(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    List<RoleBreakdownResponse> items = repository.listRoleBreakdown(owner.id()).stream()
        .map(record -> new RoleBreakdownResponse(
            blankToDefault(record.role(), "通用标注"),
            record.memberCount()))
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DisputeStatsResponse getDisputes(Authentication authentication, Integer days) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int safeDays = normalizeDays(days);
    LocalDateTime end = LocalDate.now().plusDays(1).atStartOfDay();
    LocalDateTime start = end.minusDays(safeDays);
    DashboardRepository.DisputeStatsRecord record = repository.getDisputeStats(owner.id(), start, end);
    long resolved = Math.min(record.resolved(), record.disputed());
    long pending = Math.max(record.disputed() - resolved, 0);
    return new DisputeStatsResponse(
        safeDays,
        record.disputed(),
        resolved,
        pending,
        roundRate(record.samplingRatio()),
        roundRate(record.consistencyRate()));
  }

  private DateRange dashboardRange(String range) {
    int days;
    if (range == null || range.isBlank()) {
      days = 30;
    } else {
      String normalized = range.trim().toLowerCase(Locale.ROOT);
      days = switch (normalized) {
        case "7d" -> 7;
        case "30d" -> 30;
        case "90d" -> 90;
        default -> throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "INVALID_DASHBOARD_RANGE",
            "dashboard range must be one of 7d, 30d, 90d");
      };
    }
    LocalDateTime end = LocalDate.now().plusDays(1).atStartOfDay();
    return new DateRange(end.minusDays(days), end);
  }

  private String normalizeRoleUserQuery(String role) {
    String normalized = role == null ? "" : role.trim().toLowerCase(Locale.ROOT);
    if (!"labeler".equals(normalized) && !"reviewer".equals(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_ROLE", "仅支持查询标注员或审核员列表");
    }
    return normalized;
  }

  private DateRange reviewDistributionRange(String range, Integer year) {
    if (year != null) {
      return yearRange(normalizeYear(year));
    }
    return dashboardRange(range);
  }

  private DateRange yearRange(int year) {
    LocalDate start = LocalDate.of(year, 1, 1);
    return new DateRange(start.atStartOfDay(), start.plusYears(1).atStartOfDay());
  }

  private DateRange previousRange(DateRange range) {
    long days = java.time.Duration.between(range.start(), range.end()).toDays();
    return new DateRange(range.start().minusDays(days), range.start());
  }

  private int normalizeDays(Integer days) {
    int normalized = days == null ? 7 : days;
    if (normalized != 7 && normalized != 14 && normalized != 30) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_DASHBOARD_DAYS",
          "dashboard days must be one of 7, 14, 30");
    }
    return normalized;
  }

  private int normalizeYear(Integer year) {
    int normalized = year == null ? LocalDate.now().getYear() : year;
    if (normalized < 2000 || normalized > 2100) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_DASHBOARD_YEAR",
          "dashboard year is out of range");
    }
    return normalized;
  }

  private DashboardRepository.AiDecisionCounts safeAiCounts(DashboardRepository.AiDecisionCounts counts) {
    return counts == null ? new DashboardRepository.AiDecisionCounts(0, 0, 0, 0) : counts;
  }

  private DashboardRepository.HumanDecisionCounts safeHumanCounts(DashboardRepository.HumanDecisionCounts counts) {
    return counts == null ? new DashboardRepository.HumanDecisionCounts(0, 0) : counts;
  }

  private double percentDelta(double current, double previous) {
    if (previous == 0D) {
      return 0D;
    }
    return roundPercent((current - previous) * 100D / previous);
  }

  private double roundPercent(double value) {
    return Math.round(value * 10D) / 10D;
  }

  private double roundRate(double value) {
    return Math.round(value * 1000D) / 1000D;
  }

  private String buildReviewDistributionCsv(
      int year,
      ReviewDistributionResponse distribution,
      long total) {
    String period = year + " 年";
    StringBuilder csv = new StringBuilder("\uFEFF");
    csv.append(csvRow("统计周期", "分类", "数量", "占比"));
    csv.append(csvRow(period, "AI 通过", Long.toString(distribution.aiPass()), percentText(distribution.aiPass(), total)));
    csv.append(csvRow(
        period,
        "需人工复核",
        Long.toString(distribution.aiNeedHuman()),
        percentText(distribution.aiNeedHuman(), total)));
    csv.append(csvRow(period, "AI 拒绝", Long.toString(distribution.aiReject()), percentText(distribution.aiReject(), total)));
    csv.append(csvRow(period, "人工通过", Long.toString(distribution.humanPass()), percentText(distribution.humanPass(), total)));
    csv.append(csvRow(
        period,
        "打回修改",
        Long.toString(distribution.humanReturned()),
        percentText(distribution.humanReturned(), total)));
    csv.append(csvRow(
        period,
        "升级争议",
        Long.toString(distribution.humanDisputed()),
        percentText(distribution.humanDisputed(), total)));
    csv.append(csvRow(period, "合计", Long.toString(total), total == 0 ? "0.00%" : "100.00%"));
    return csv.toString();
  }

  private String percentText(long value, long total) {
    double percent = total == 0 ? 0D : (double) value * 100D / total;
    return String.format(Locale.ROOT, "%.2f%%", percent);
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

  private String monthLabel(int monthNo) {
    if (monthNo < 1 || monthNo > 12) {
      return "";
    }
    return MONTH_LABELS[monthNo - 1];
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private void settleExpiredTasks() {
    settlementService.settleExpiredTasks();
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

  private record DateRange(LocalDateTime start, LocalDateTime end) {}
}
