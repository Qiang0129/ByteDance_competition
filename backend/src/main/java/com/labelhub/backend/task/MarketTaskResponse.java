package com.labelhub.backend.task;

public record MarketTaskResponse(
    String taskId,
    String title,
    String taskType,
    String description,
    String schemaVersionId,
    int remainingQuota,
    int totalQuota,
    String deadline,
    Double rewardPerItem) {}
