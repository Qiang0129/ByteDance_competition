package com.labelhub.backend.dashboard;

public record DashboardOverviewResponse(
    String rangeStart,
    String rangeEnd,
    Kpis kpis) {

  public record Kpis(
      long activeTasks,
      long activeLabelers,
      long pendingReview,
      long submittedToday,
      double aiPassRate,
      long avgDurationSec,
      Deltas deltas) {}

  public record Deltas(
      double activeTasks,
      double activeLabelers,
      double pendingReview,
      double submittedToday,
      double aiPassRate,
      double avgDurationSec) {}
}
