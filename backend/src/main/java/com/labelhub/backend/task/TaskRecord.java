package com.labelhub.backend.task;

import java.time.LocalDateTime;

public record TaskRecord(
    long id,
    String title,
    String description,
    String status,
    long ownerId,
    String ownerName,
    Long datasetId,
    Integer quota,
    int quotaUsed,
    LocalDateTime deadline,
    String rewardRuleJson,
    LocalDateTime createdAt,
    LocalDateTime publishedAt,
    LocalDateTime deletedAt,
    Long schemaVersionId,
    Integer schemaVersion) {}
