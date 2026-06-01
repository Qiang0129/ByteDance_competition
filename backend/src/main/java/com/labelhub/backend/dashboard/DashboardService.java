package com.labelhub.backend.dashboard;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
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
public class DashboardService {

  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
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
    LocalDate today = LocalDate.now();
    LocalDateTime todayStart = today.atStartOfDay();
    LocalDateTime tomorrowStart = today.plusDays(1).atStartOfDay();
    LocalDateTime yesterdayStart = today.minusDays(1).atStartOfDay();

    long activeTasks = repository.countActiveTasks(owner.id());
    long activeLabelers = repository.countActiveLabelers(owner.id(), dateRange.start(), dateRange.end());
    long previousActiveLabelers = repository.countActiveLabelers(owner.id(), previous.start(), previous.end());
    long pendingReview = repository.countPendingReview(owner.id());
    long submittedToday = repository.countSubmittedAnnotations(owner.id(), todayStart, tomorrowStart);
    long submittedYesterday = repository.countSubmittedAnnotations(owner.id(), yesterdayStart, todayStart);
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
            activeLabelers,
            pendingReview,
            submittedToday,
            roundRate(aiPassRate),
            avgDurationSec,
            new DashboardOverviewResponse.Deltas(
                0D,
                percentDelta(activeLabelers, previousActiveLabelers),
                0D,
                percentDelta(submittedToday, submittedYesterday),
                percentDelta(aiPassRate, previousAiPassRate),
                percentDelta(avgDurationSec, previousAvgDurationSec))));
  }

  public DashboardItemsResponse<TaskProgressResponse> getTaskProgress(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    List<TaskProgressResponse> items = repository.listTaskProgress(owner.id(), 12).stream()
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

  public ReviewDistributionResponse getReviewDistribution(Authentication authentication, String range) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    DateRange dateRange = dashboardRange(range);
    DashboardRepository.AiDecisionCounts ai = safeAiCounts(
        repository.countAiDecisions(owner.id(), dateRange.start(), dateRange.end()));
    DashboardRepository.HumanDecisionCounts human = safeHumanCounts(
        repository.countHumanDecisions(owner.id(), dateRange.start(), dateRange.end()));
    return new ReviewDistributionResponse(
        ai.aiPass(),
        ai.aiNeedHuman(),
        ai.aiReject(),
        human.humanPass(),
        human.humanReturned());
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
            record.submitted() == 0 ? 0D : roundRate((double) record.approved() / record.submitted()),
            record.submitted(),
            record.approved(),
            record.returned(),
            record.avgDurationSec()))
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

  public DashboardItemsResponse<RecentTaskActivityResponse> getRecentActivities(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    List<RecentTaskActivityResponse> items = repository.listRecentActivities(owner.id(), 8).stream()
        .map(record -> new RecentTaskActivityResponse(
            Long.toString(record.taskId()),
            blankToDefault(record.taskTitle(), "标注任务"),
            blankToDefault(record.ownerName(), owner.displayName()),
            activityStatus(record.action(), record.toState()),
            formatDateTime(record.createdAt())))
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

  private String activityStatus(String action, String toState) {
    String normalizedAction = action == null ? "" : action.toLowerCase(Locale.ROOT);
    String normalizedState = toState == null ? "" : toState.toLowerCase(Locale.ROOT);
    if (List.of("accepted", "exported", "succeeded").contains(normalizedState)
        || normalizedAction.contains("approve")
        || normalizedAction.contains("accept")) {
      return "approved";
    }
    if (List.of("returned", "voided", "failed").contains(normalizedState)
        || normalizedAction.contains("return")
        || normalizedAction.contains("reject")
        || normalizedAction.contains("fail")) {
      return "rejected";
    }
    return "pending";
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
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
