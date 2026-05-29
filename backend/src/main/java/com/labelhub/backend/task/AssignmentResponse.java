package com.labelhub.backend.task;

public record AssignmentResponse(
    String assignmentId,
    String taskId,
    String itemId,
    String status,
    String lockedUntil,
    String schemaVersionId,
    String taskTitle,
    String taskType,
    String taskTypeKey,
    String ownerName,
    String publishedAt,
    String deadline,
    int quotaUsed,
    int quotaTotal,
    String claimedAt,
    String submittedAt,
    String updatedAt) {}
