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
  private final DashboardIssueFeedbackRepository issueFeedbackRepository;
  private final TaskDeadlineSettlementService settlementService;

  public DashboardService(
      DashboardRepository repository,
      DashboardIssueFeedbackRepository issueFeedbackRepository,
      TaskDeadlineSettlementService settlementService) {
    this.repository = repository;
    this.issueFeedbackRepository = issueFeedbackRepository;
    this.settlementService = settlementService;
  }

  public DashboardOverviewResponse getOverview(Authentication authentication, String range) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    return buildOverview(owner.id(), range);
  }

  private DashboardOverviewResponse buildOverview(long ownerId, String range) {
    DateRange dateRange = dashboardRange(range);
    DateRange previous = previousRange(dateRange);
    long activeTasks = repository.countActiveTasks(ownerId);
    long labelerCount = repository.countActiveUsersByRole("labeler");
    long pendingReview = repository.countPendingReview(ownerId);
    long reviewerCount = repository.countActiveUsersByRole("reviewer");
    DashboardRepository.AiDecisionCounts ai = safeAiCounts(
        repository.countAiDecisions(ownerId, dateRange.start(), dateRange.end()));
    DashboardRepository.AiDecisionCounts previousAi = safeAiCounts(
        repository.countAiDecisions(ownerId, previous.start(), previous.end()));
    double aiPassRate = ai.total() == 0 ? 0D : (double) ai.aiPass() / ai.total();
    double previousAiPassRate = previousAi.total() == 0 ? 0D : (double) previousAi.aiPass() / previousAi.total();
    long avgDurationSec = repository.averageDurationSec(ownerId, dateRange.start(), dateRange.end());
    long previousAvgDurationSec = repository.averageDurationSec(ownerId, previous.start(), previous.end());

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

  public DashboardItemsResponse<TaskMilestoneResponse> getTaskMilestones(
      Authentication authentication,
      Integer limit) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int safeLimit = normalizeLimit(limit, 4, 12);
    return buildTaskMilestonesResponse(owner.id(), safeLimit);
  }

  private DashboardItemsResponse<TaskMilestoneResponse> buildTaskMilestonesResponse(long ownerId, int limit) {
    List<TaskMilestoneResponse> items = repository.listTaskMilestones(ownerId, limit).stream()
        .map(record -> {
          long total = Math.max(record.total(), 0);
          long approved = Math.max(record.approved(), 0);
          long returned = Math.max(record.returned(), 0);
          long pending = Math.max(total - approved - returned, 0);
          return new TaskMilestoneResponse(
              Long.toString(record.taskId()),
              blankToDefault(record.title(), "标注任务"),
              total,
              approved,
              returned,
              pending,
              blankToDefault(record.status(), "unknown"),
              blankToDefault(record.reviewStatus(), "not_started"),
              resolveTaskPhase(record.status(), record.reviewStatus(), pending));
        })
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DashboardItemsResponse<DeadlineAlertResponse> getDeadlineAlerts(
      Authentication authentication,
      Integer limit) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int safeLimit = normalizeLimit(limit, 4, 12);
    return buildDeadlineAlertsResponse(owner.id(), safeLimit);
  }

  private DashboardItemsResponse<DeadlineAlertResponse> buildDeadlineAlertsResponse(long ownerId, int limit) {
    List<DeadlineAlertResponse> items = repository.listDeadlineAlerts(ownerId, limit).stream()
        .map(record -> new DeadlineAlertResponse(
            Long.toString(record.taskId()),
            blankToDefault(record.title(), "标注任务"),
            Math.max(record.pending(), 0),
            formatDateTime(record.deadline()),
            Math.max(record.hoursLeft(), 0),
            deadlineRiskLevel(record.hoursLeft())))
        .toList();
    return new DashboardItemsResponse<>(items);
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

  private String buildDashboardExportCsv(
      String range,
      int reviewYear,
      int submissionYear,
      DashboardOverviewResponse overview,
      List<TaskProgressResponse> taskProgress,
      ReviewDistributionResponse reviewDistribution,
      List<RoleBreakdownResponse> roleBreakdown,
      DisputeStatsResponse disputes7,
      DisputeStatsResponse disputes14,
      DisputeStatsResponse disputes30,
      List<TaskMilestoneResponse> taskMilestones,
      List<DeadlineAlertResponse> deadlineAlerts,
      List<LabelerPerformanceResponse> performance,
      List<SubmissionTimelineMonthResponse> submissionTimeline,
      long openIssueFeedback) {
    long reviewTotal = reviewDistribution.aiPass()
        + reviewDistribution.aiNeedHuman()
        + reviewDistribution.aiReject()
        + reviewDistribution.humanPass()
        + reviewDistribution.humanReturned()
        + reviewDistribution.humanDisputed();
    StringBuilder csv = new StringBuilder("\uFEFF");
    csv.append(csvRow("LabelHub 数据看板导出"));
    csv.append(csvRow("导出范围", rangeLabel(range), "审核分布年份", Integer.toString(reviewYear),
        "月度提交率年份", Integer.toString(submissionYear)));
    csv.append(csvRow());

    csv.append(csvRow("概览 KPI"));
    csv.append(csvRow("指标", "值", "环比"));
    csv.append(csvRow("活跃任务", Long.toString(overview.kpis().activeTasks()),
        percentDeltaText(overview.kpis().deltas().activeTasks())));
    csv.append(csvRow("标注员数量", Long.toString(overview.kpis().labelerCount()), ""));
    csv.append(csvRow("待人工审核", Long.toString(overview.kpis().pendingReview()),
        percentDeltaText(overview.kpis().deltas().pendingReview())));
    csv.append(csvRow("审核员数量", Long.toString(overview.kpis().reviewerCount()), ""));
    csv.append(csvRow("AI 通过率", rateText(overview.kpis().aiPassRate()),
        percentDeltaText(overview.kpis().deltas().aiPassRate())));
    csv.append(csvRow("平均耗时(秒)", Long.toString(overview.kpis().avgDurationSec()),
        percentDeltaText(overview.kpis().deltas().avgDurationSec())));
    csv.append(csvRow("题目反馈待查看", Long.toString(openIssueFeedback), ""));
    csv.append(csvRow());

    csv.append(csvRow("任务进度"));
    csv.append(csvRow("任务 ID", "任务标题", "总量", "通过", "打回", "待处理"));
    for (TaskProgressResponse item : taskProgress) {
      csv.append(csvRow(
          item.taskId(),
          item.title(),
          Long.toString(item.total()),
          Long.toString(item.approved()),
          Long.toString(item.returned()),
          Long.toString(item.pending())));
    }
    csv.append(csvRow());

    csv.append(csvRow("审核分布"));
    csv.append(csvRow("年份", "分类", "数量", "占比"));
    appendReviewDistributionRows(csv, reviewYear, reviewDistribution, reviewTotal);
    csv.append(csvRow());

    csv.append(csvRow("角色分布"));
    csv.append(csvRow("角色", "人数"));
    for (RoleBreakdownResponse item : roleBreakdown) {
      csv.append(csvRow(item.role(), Long.toString(item.memberCount())));
    }
    csv.append(csvRow());

    csv.append(csvRow("争议统计"));
    csv.append(csvRow("范围", "争议数", "已解决", "待处理", "抽检比例", "双审一致率"));
    appendDisputeRow(csv, disputes7);
    appendDisputeRow(csv, disputes14);
    appendDisputeRow(csv, disputes30);
    csv.append(csvRow());

    csv.append(csvRow("任务关键节点"));
    csv.append(csvRow("任务 ID", "任务标题", "总量", "通过", "打回", "待处理", "任务状态", "审核状态", "当前阶段"));
    for (TaskMilestoneResponse item : taskMilestones) {
      csv.append(csvRow(
          item.taskId(),
          item.title(),
          Long.toString(item.total()),
          Long.toString(item.approved()),
          Long.toString(item.returned()),
          Long.toString(item.pending()),
          item.status(),
          item.reviewStatus(),
          taskPhaseLabel(item.currentPhase())));
    }
    csv.append(csvRow());

    csv.append(csvRow("临近截止预警"));
    csv.append(csvRow("任务 ID", "任务标题", "待处理", "截止时间", "剩余小时", "风险等级"));
    for (DeadlineAlertResponse item : deadlineAlerts) {
      csv.append(csvRow(
          item.taskId(),
          item.title(),
          Long.toString(item.pending()),
          item.deadline(),
          Long.toString(item.hoursLeft()),
          riskLevelLabel(item.riskLevel())));
    }
    csv.append(csvRow());

    csv.append(csvRow("标注员绩效"));
    csv.append(csvRow("标注员 ID", "姓名", "角色", "提交数", "通过数", "打回数", "通过率", "平均耗时(秒)", "综合得分"));
    for (LabelerPerformanceResponse item : performance) {
      csv.append(csvRow(
          item.labelerId(),
          item.name(),
          item.role(),
          Long.toString(item.submittedCount()),
          Long.toString(item.approvedCount()),
          Long.toString(item.returnedCount()),
          rateText(item.passRate()),
          Long.toString(item.avgDurationSec()),
          rateText(item.score())));
    }
    csv.append(csvRow());

    csv.append(csvRow("月度提交率"));
    csv.append(csvRow("月份", "准时", "延迟", "缺席", "合计"));
    for (SubmissionTimelineMonthResponse item : submissionTimeline) {
      long total = item.onTime() + item.late() + item.absent();
      csv.append(csvRow(
          item.month(),
          Long.toString(item.onTime()),
          Long.toString(item.late()),
          Long.toString(item.absent()),
          Long.toString(total)));
    }
    return csv.toString();
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
    String filename = "review-distribution-" + safeYear + ".csv";

    return csvDownloadResponse(csv, filename);
  }

  public ResponseEntity<Resource> downloadDashboardExport(
      Authentication authentication,
      String range,
      Integer reviewYear) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    String safeRange = normalizeRangeCode(range);
    int safeReviewYear = normalizeYear(reviewYear);
    int submissionYear = LocalDate.now().getYear();

    DashboardOverviewResponse overview = buildOverview(owner.id(), safeRange);
    List<TaskProgressResponse> taskProgress = buildTaskProgressResponse(owner.id(), 12).items();
    List<TaskMilestoneResponse> taskMilestones = buildTaskMilestonesResponse(owner.id(), 4).items();
    List<DeadlineAlertResponse> deadlineAlerts = buildDeadlineAlertsResponse(owner.id(), 4).items();
    ReviewDistributionResponse reviewDistribution = buildReviewDistribution(owner.id(), yearRange(safeReviewYear));
    List<LabelerPerformanceResponse> performance = buildLabelerPerformanceResponse(owner.id(), safeRange).items();
    List<SubmissionTimelineMonthResponse> submissionTimeline =
        buildSubmissionTimelineResponse(owner.id(), submissionYear).items();
    List<RoleBreakdownResponse> roleBreakdown = buildRoleBreakdownResponse(owner.id()).items();
    DisputeStatsResponse disputes7 = buildDisputesResponse(owner.id(), 7);
    DisputeStatsResponse disputes14 = buildDisputesResponse(owner.id(), 14);
    DisputeStatsResponse disputes30 = buildDisputesResponse(owner.id(), 30);
    long openIssueFeedback = issueFeedbackRepository.countIssueFeedback(owner.id(), "open");

    String csv = buildDashboardExportCsv(
        safeRange,
        safeReviewYear,
        submissionYear,
        overview,
        taskProgress,
        reviewDistribution,
        roleBreakdown,
        disputes7,
        disputes14,
        disputes30,
        taskMilestones,
        deadlineAlerts,
        performance,
        submissionTimeline,
        openIssueFeedback);
    String filename = "dashboard-export-" + safeRange + "-" + safeReviewYear + ".csv";
    return csvDownloadResponse(csv, filename);
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
    return buildLabelerPerformanceResponse(owner.id(), range);
  }

  private DashboardItemsResponse<LabelerPerformanceResponse> buildLabelerPerformanceResponse(
      long ownerId,
      String range) {
    DateRange dateRange = dashboardRange(range);
    List<LabelerPerformanceResponse> items = repository
        .listLabelerPerformance(ownerId, dateRange.start(), dateRange.end(), 10)
        .stream()
        .map(record -> {
          double passRate = record.submitted() == 0 ? 0D : roundRate((double) record.approved() / record.submitted());
          return new LabelerPerformanceResponse(
              Long.toString(record.labelerId()),
              blankToDefault(record.labelerName(), "Labeler"),
              blankToDefault(record.role(), "通用标注"),
              null,
              passRate,
              Math.max(record.submitted(), 0),
              Math.max(record.approved(), 0),
              Math.max(record.returned(), 0),
              Math.max(record.avgDurationSec(), 0),
              passRate);
        })
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DashboardItemsResponse<SubmissionTimelineMonthResponse> getSubmissionTimeline(
      Authentication authentication,
      Integer year) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    int safeYear = normalizeYear(year);
    return buildSubmissionTimelineResponse(owner.id(), safeYear);
  }

  private DashboardItemsResponse<SubmissionTimelineMonthResponse> buildSubmissionTimelineResponse(
      long ownerId,
      int year) {
    List<SubmissionTimelineMonthResponse> items = repository.listSubmissionTimeline(ownerId, year).stream()
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
    return buildRoleBreakdownResponse(owner.id());
  }

  private DashboardItemsResponse<RoleBreakdownResponse> buildRoleBreakdownResponse(long ownerId) {
    List<RoleBreakdownResponse> items = repository.listRoleBreakdown(ownerId).stream()
        .map(record -> new RoleBreakdownResponse(
            blankToDefault(record.role(), "通用标注"),
            record.memberCount()))
        .toList();
    return new DashboardItemsResponse<>(items);
  }

  public DisputeStatsResponse getDisputes(Authentication authentication, Integer days) {
    AuthenticatedUser owner = requireOwner(authentication);
    settleExpiredTasks();
    return buildDisputesResponse(owner.id(), days);
  }

  private DisputeStatsResponse buildDisputesResponse(long ownerId, Integer days) {
    int safeDays = normalizeDays(days);
    LocalDateTime end = LocalDate.now().plusDays(1).atStartOfDay();
    LocalDateTime start = end.minusDays(safeDays);
    DashboardRepository.DisputeStatsRecord record = repository.getDisputeStats(ownerId, start, end);
    if (record == null) {
      record = new DashboardRepository.DisputeStatsRecord(0, 0, 0D, 0D);
    }
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
    String normalized = normalizeRangeCode(range);
    int days = switch (normalized) {
      case "7d" -> 7;
      case "90d" -> 90;
      default -> 30;
    };
    LocalDateTime end = LocalDate.now().plusDays(1).atStartOfDay();
    return new DateRange(end.minusDays(days), end);
  }

  private String normalizeRangeCode(String range) {
    if (range == null || range.isBlank()) {
      return "30d";
    }
    String normalized = range.trim().toLowerCase(Locale.ROOT);
    if (List.of("7d", "30d", "90d").contains(normalized)) {
      return normalized;
    }
    throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_DASHBOARD_RANGE",
        "dashboard range must be one of 7d, 30d, 90d");
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

  private int normalizeLimit(Integer limit, int defaultLimit, int maxLimit) {
    int normalized = limit == null ? defaultLimit : limit;
    if (normalized < 1 || normalized > maxLimit) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_DASHBOARD_LIMIT",
          "dashboard limit is out of range");
    }
    return normalized;
  }

  private String resolveTaskPhase(String status, String reviewStatus, long pending) {
    String normalizedStatus = status == null ? "" : status.trim().toLowerCase(Locale.ROOT);
    String normalizedReview = reviewStatus == null ? "" : reviewStatus.trim().toLowerCase(Locale.ROOT);
    if (List.of("ended", "exported", "delivered").contains(normalizedStatus) || pending == 0) {
      return "delivered";
    }
    if (normalizedReview.startsWith("human_") || "completed".equals(normalizedReview)) {
      return "human_review";
    }
    if ("ai_prereviewing".equals(normalizedReview)) {
      return "ai_review";
    }
    return "published";
  }

  private String deadlineRiskLevel(long hoursLeft) {
    if (hoursLeft <= 12) {
      return "critical";
    }
    if (hoursLeft <= 24) {
      return "warn";
    }
    return "normal";
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
    appendReviewDistributionRows(csv, year, distribution, total);
    return csv.toString();
  }

  private void appendReviewDistributionRows(
      StringBuilder csv,
      int year,
      ReviewDistributionResponse distribution,
      long total) {
    String period = year + " 年";
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
  }

  private void appendDisputeRow(StringBuilder csv, DisputeStatsResponse disputes) {
    csv.append(csvRow(
        "近 " + disputes.rangeDays() + " 日",
        Long.toString(disputes.disputed()),
        Long.toString(disputes.resolved()),
        Long.toString(disputes.pending()),
        rateText(disputes.samplingRatio()),
        rateText(disputes.consistencyRate())));
  }

  private String rangeLabel(String range) {
    return switch (range) {
      case "7d" -> "近 7 日";
      case "90d" -> "近 90 日";
      default -> "近 30 日";
    };
  }

  private String rateText(double value) {
    return String.format(Locale.ROOT, "%.2f%%", value * 100D);
  }

  private String percentDeltaText(double value) {
    return String.format(Locale.ROOT, "%+.1f%%", value);
  }

  private String taskPhaseLabel(String phase) {
    return switch (phase == null ? "" : phase) {
      case "published" -> "已发布";
      case "ai_review" -> "AI 预审";
      case "human_review" -> "人工审核";
      case "delivered" -> "已交付";
      default -> blankToDefault(phase, "-");
    };
  }

  private String riskLevelLabel(String riskLevel) {
    return switch (riskLevel == null ? "" : riskLevel) {
      case "critical" -> "高风险";
      case "warn" -> "预警";
      case "normal" -> "正常";
      default -> blankToDefault(riskLevel, "-");
    };
  }

  private String percentText(long value, long total) {
    double percent = total == 0 ? 0D : (double) value * 100D / total;
    return String.format(Locale.ROOT, "%.2f%%", percent);
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

  private String monthLabel(int monthNo) {
    if (monthNo < 1 || monthNo > 12) {
      return "";
    }
    return MONTH_LABELS[monthNo - 1];
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private String formatDateTime(LocalDateTime value) {
    return value == null ? null : value.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
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
