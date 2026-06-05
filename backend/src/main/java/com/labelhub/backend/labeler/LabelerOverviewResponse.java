package com.labelhub.backend.labeler;

import java.util.List;

public record LabelerOverviewResponse(
    HeroStats heroStats,
    Kpis kpis,
    TodayProgress todayProgress,
    ReviewDistribution reviewDistribution,
    List<RecentBatch> recentBatches,
    List<SupportedItemType> supportedItemTypes,
    List<PendingTypeDistribution> pendingTypeDistribution) {

  public record HeroStats(
      long weeklySubmitted,
      double reviewPassRate,
      double monthlyRewardEstimate) {}

  public record Kpis(
      long activeTasks,
      long submittedToday,
      long returnedItems,
      long avgDurationSec,
      double todayReward) {}

  public record TodayProgress(
      int target,
      long submitted,
      long aiPassed,
      long humanConfirmed,
      int percent,
      long avgDurationSec,
      String estimatedFinishTime) {}

  public record ReviewDistribution(
      long aiPass,
      long aiNeedHuman,
      long aiReject,
      long humanPass,
      long humanReturned) {}

  public record RecentBatch(
      String taskId,
      String assignmentId,
      String title,
      String description,
      String taskType,
      String taskTypeKey,
      int remainingQuota,
      int totalQuota,
      String deadline,
      Double rewardPerItem,
      String updatedAt) {}

  public record SupportedItemType(
      String key,
      String label) {}

  public record PendingTypeDistribution(
      String key,
      String label,
      long count) {}
}
