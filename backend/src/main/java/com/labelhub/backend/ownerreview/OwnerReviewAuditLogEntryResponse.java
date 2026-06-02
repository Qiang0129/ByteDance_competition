package com.labelhub.backend.ownerreview;

public record OwnerReviewAuditLogEntryResponse(
    String logId,
    String entityType,
    String entityId,
    String taskId,
    String taskTitle,
    String assignmentId,
    String annotationId,
    String itemId,
    Integer itemIndex,
    String labelerName,
    String itemTitle,
    String operatorName,
    String operatorRole,
    String action,
    String fromState,
    String toState,
    String reason,
    String occurredAt) {}
