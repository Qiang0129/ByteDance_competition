package com.labelhub.backend.review;

public record DisputeItemResponse(
    String disputeId,
    String annotationId,
    String taskId,
    String taskTitle,
    String reason,
    String raisedById,
    String raisedBy,
    String raisedAt,
    String status,
    String escalationStageLabel,
    boolean canResolve,
    int rounds) {}
