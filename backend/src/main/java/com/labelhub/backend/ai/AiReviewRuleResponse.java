package com.labelhub.backend.ai;

import java.util.List;

public record AiReviewRuleResponse(
    String ruleId,
    String name,
    String scopeTaskId,
    String scopeTaskTitle,
    String promptTemplate,
    List<AiReviewDimension> dimensions,
    double passThreshold,
    double needHumanThreshold,
    int maxRetry,
    int retryBackoffSec,
    String status,
    int version,
    String updatedAt,
    String createdBy) {}
