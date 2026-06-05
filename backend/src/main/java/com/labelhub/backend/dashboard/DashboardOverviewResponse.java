package com.labelhub.backend.dashboard;

public record DashboardOverviewResponse(
    String rangeStart,
    String rangeEnd,
    Kpis kpis) {

  public record Kpis(
      long activeTasks,
      long labelerCount,
      long pendingReview,
      long reviewerCount,
      double aiPassRate,
      long avgDurationSec,
      Deltas deltas) {}

  public record Deltas(
      double activeTasks,
      double pendingReview,
      double aiPassRate,
      double avgDurationSec) {}
}
