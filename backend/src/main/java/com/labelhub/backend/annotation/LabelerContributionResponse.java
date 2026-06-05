package com.labelhub.backend.annotation;

public record LabelerContributionResponse(
    long submittedCount,
    long approvedCount,
    long returnedCount,
    long rejectedCount,
    long disputedCount) {}
