package com.labelhub.backend.dashboard;

public record TaskMilestoneResponse(
    String taskId,
    String title,
    long total,
    long approved,
    long returned,
    long pending,
    String status,
    String reviewStatus,
    String currentPhase) {}
