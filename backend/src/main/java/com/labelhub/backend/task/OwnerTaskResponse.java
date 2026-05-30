package com.labelhub.backend.task;

import java.util.List;

public record OwnerTaskResponse(
    String taskId,
    String title,
    String taskType,
    String schemaVersion,
    String schemaVersionId,
    String owner,
    String state,
    String assignStrategy,
    String datasetId,
    int quotaUsed,
    int quotaTotal,
    Integer maxClaimPerUser,
    List<String> assignedLabelerIds,
    String createdAt,
    String deadline,
    String reward,
    List<String> tags,
    String description,
    boolean aiReviewEnabled,
    String aiReviewRuleId,
    String aiReviewRuleName) {}
