package com.labelhub.backend.ownerreview;

import java.util.List;

public record OwnerReviewTaskResponse(
    String taskId,
    String taskTitle,
    String taskType,
    long totalAnnotations,
    long approvedCount,
    long returnedCount,
    long inProgress,
    long disputes,
    double samplingRatio,
    long totalReviewed,
    List<String> reviewerNames,
    String deadline,
    boolean aiReviewEnabled,
    String updatedAt) {}
