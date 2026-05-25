package com.labelhub.backend.task;

import java.util.List;

public record MarketTaskResponse(
    String taskId,
    String title,
    String taskType,
    String taskTypeKey,
    String description,
    List<String> tags,
    String schemaVersionId,
    int remainingQuota,
    int totalQuota,
    String deadline,
    Double rewardPerItem,
    String rewardCap,
    String assignStrategy,
    List<String> mediaTypes,
    String ownerName,
    boolean aiReviewEnabled,
    String aiReviewRule,
    String publishedAt,
    Integer maxClaimPerUser,
    boolean claimedByMe) {}
