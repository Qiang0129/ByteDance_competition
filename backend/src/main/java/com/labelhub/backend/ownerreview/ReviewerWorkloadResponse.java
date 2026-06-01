package com.labelhub.backend.ownerreview;

public record ReviewerWorkloadResponse(
    String reviewerId,
    String reviewerName,
    long pending,
    long reviewedToday,
    long avgDurationSec,
    double consistencyRate) {}
