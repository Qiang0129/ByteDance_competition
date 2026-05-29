package com.labelhub.backend.review;

public record ReviewerOverviewResponse(
    int rangeDays,
    long pendingBatches,
    long todayApproved,
    long todayReturned,
    long todayDisputes,
    long reviewedTotal,
    double consistencyRate,
    double samplingCoverage) {}
