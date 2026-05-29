package com.labelhub.backend.ai;

public record AiReviewJobResponse(
    String jobId,
    String annotationId,
    String status,
    int retryCount,
    String errorSummary,
    String availableAt,
    String startedAt,
    String finishedAt) {}
