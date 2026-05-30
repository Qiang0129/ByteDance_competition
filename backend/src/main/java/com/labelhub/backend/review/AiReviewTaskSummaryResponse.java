package com.labelhub.backend.review;

public record AiReviewTaskSummaryResponse(
    String taskId,
    String taskTitle,
    String taskType,
    long total,
    long passCount,
    long needHumanCount,
    long rejectCount,
    long pendingHuman,
    String updatedAt) {}
