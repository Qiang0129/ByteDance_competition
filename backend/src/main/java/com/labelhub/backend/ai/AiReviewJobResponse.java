package com.labelhub.backend.ai;

public record AiReviewJobResponse(
    String jobId,
    String annotationId,
    String taskId,
    String taskTitle,
    String ruleId,
    String ruleName,
    String status,
    String decision,
    Double totalScore,
    Integer itemIndex,
    Integer itemTotal,
    int retryCount,
    String errorSummary,
    String createdAt,
    String availableAt,
    String startedAt,
    String finishedAt) {}
