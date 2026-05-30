package com.labelhub.backend.ai;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record AiReviewRuleRequest(
    @NotBlank(message = "name is required")
    String name,
    String scopeTaskId,
    @NotBlank(message = "promptTemplate is required")
    String promptTemplate,
    @NotNull(message = "dimensions is required")
    List<AiReviewDimension> dimensions,
    double passThreshold,
    double needHumanThreshold,
    int maxRetry,
    int retryBackoffSec,
    String status) {}
