package com.labelhub.backend.task;

import java.time.LocalDateTime;

public record AssignmentRecord(
    long id,
    long taskId,
    long itemId,
    long labelerId,
    String status,
    LocalDateTime lockedUntil,
    LocalDateTime claimedAt,
    LocalDateTime submittedAt,
    LocalDateTime updatedAt,
    Long schemaVersionId,
    String taskTitle,
    String ownerName,
    Integer taskQuota,
    int taskQuotaUsed,
    LocalDateTime taskCreatedAt,
    LocalDateTime taskDeadline,
    LocalDateTime taskPublishedAt,
    String rewardRuleJson) {}
