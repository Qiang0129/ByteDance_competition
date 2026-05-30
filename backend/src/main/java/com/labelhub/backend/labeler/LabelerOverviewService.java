package com.labelhub.backend.labeler;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
public class LabelerOverviewService {

  private static final int DAILY_TARGET = 30;
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

  private final LabelerOverviewRepository repository;

  public LabelerOverviewService(LabelerOverviewRepository repository) {
    this.repository = repository;
  }

  public LabelerOverviewResponse getOverview(Authentication authentication) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    long submittedToday = repository.countSubmittedToday(labeler.id());
    long avgDurationSec = repository.averageDurationSec(labeler.id());
    long todayAvgDurationSec = repository.averageDurationTodaySec(labeler.id());
    long submittedAssignments = repository.countSubmittedAssignments(labeler.id());
    long acceptedAssignments = repository.countAcceptedAssignments(labeler.id());

    LabelerOverviewResponse.HeroStats heroStats = new LabelerOverviewResponse.HeroStats(
        repository.countWeeklySubmitted(labeler.id()),
        submittedAssignments == 0 ? 0D : (double) acceptedAssignments / submittedAssignments,
        roundMoney(repository.sumMonthlyRewardEstimate(labeler.id())));
    LabelerOverviewResponse.Kpis kpis = new LabelerOverviewResponse.Kpis(
        repository.countActiveTasks(labeler.id()),
        submittedToday,
        repository.countReturnedItems(labeler.id()),
        avgDurationSec);
    LabelerOverviewResponse.TodayProgress todayProgress = new LabelerOverviewResponse.TodayProgress(
        DAILY_TARGET,
        submittedToday,
        repository.countAiPassedToday(labeler.id()),
        repository.countHumanConfirmedToday(labeler.id()),
        progressPercent(submittedToday),
        todayAvgDurationSec,
        estimateFinishTime(submittedToday, todayAvgDurationSec));

    return new LabelerOverviewResponse(
        heroStats,
        kpis,
        todayProgress,
        repository.getReviewDistribution(labeler.id()),
        repository.listRecentBatches(labeler.id(), 3).stream()
            .map(this::toRecentBatch)
            .toList(),
        repository.listSupportedMediaTypes(labeler.id()).stream()
            .filter(value -> value != null && !value.isBlank())
            .map(this::toSupportedItemType)
            .toList());
  }

  private LabelerOverviewResponse.RecentBatch toRecentBatch(
      LabelerOverviewRepository.RecentBatchRecord record) {
    int totalQuota = Math.max(record.totalQuota(), 0);
    int remainingQuota = Math.max(totalQuota - Math.max(record.quotaUsed(), 0), 0);
    String taskType = record.taskType() == null || record.taskType().isBlank()
        ? "Annotation Task"
        : record.taskType();
    return new LabelerOverviewResponse.RecentBatch(
        Long.toString(record.taskId()),
        Long.toString(record.assignmentId()),
        record.title(),
        record.description() == null || record.description().isBlank()
            ? "请按任务模板完成当前标注批次。"
            : record.description(),
        taskType,
        toTaskTypeKey(taskType),
        remainingQuota,
        totalQuota,
        formatDateTime(record.deadline()),
        record.rewardPerItem(),
        formatDateTime(record.updatedAt()));
  }

  private LabelerOverviewResponse.SupportedItemType toSupportedItemType(String mediaType) {
    String key = mediaType.trim().toLowerCase(Locale.ROOT);
    String label = switch (key) {
      case "image" -> "Image";
      case "video" -> "Video";
      case "markdown" -> "Markdown";
      case "text" -> "Text";
      default -> key;
    };
    return new LabelerOverviewResponse.SupportedItemType(key, label);
  }

  private int progressPercent(long submittedToday) {
    if (DAILY_TARGET <= 0) {
      return 0;
    }
    return Math.min(100, (int) Math.round(submittedToday * 100.0 / DAILY_TARGET));
  }

  private String estimateFinishTime(long submittedToday, long avgDurationSec) {
    long remaining = Math.max(DAILY_TARGET - submittedToday, 0);
    if (remaining == 0 || avgDurationSec <= 0) {
      return "";
    }
    return TIME.format(LocalDateTime.now().plusSeconds(remaining * avgDurationSec));
  }

  private double roundMoney(double value) {
    return Math.round(value * 100.0) / 100.0;
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
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
