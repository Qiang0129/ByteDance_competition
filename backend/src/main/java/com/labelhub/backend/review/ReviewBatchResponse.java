package com.labelhub.backend.review;

public record ReviewBatchResponse(
    String batchId,
    String taskId,
    String taskTitle,
    String taskType,
    long pending,
    long reviewed,
    long needHumanReview,
    double samplingRatio,
    String priority,
    String status,
    String reviewerId,
    String deadline,
    String updatedAt) {}
