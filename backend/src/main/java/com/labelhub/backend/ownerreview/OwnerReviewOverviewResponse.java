package com.labelhub.backend.ownerreview;

import java.util.List;

public record OwnerReviewOverviewResponse(
    int rangeDays,
    long pendingAnnotations,
    long todayApproved,
    long todayReturned,
    long todayDisputes,
    double samplingCoverage,
    double consistencyRate,
    double returnRate,
    List<ReviewerWorkloadResponse> reviewerWorkloads) {}
