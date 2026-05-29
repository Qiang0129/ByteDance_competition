package com.labelhub.backend.review;

public record DisputeItemResponse(
    String disputeId,
    String annotationId,
    String taskId,
    String taskTitle,
    String reason,
    String raisedBy,
    String raisedAt,
    String status,
    int rounds) {}
