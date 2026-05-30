package com.labelhub.agent.model;

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
    int attempts,
    String lastError,
    String createdAt,
    String availableAt,
    String startedAt,
    String finishedAt) {}
