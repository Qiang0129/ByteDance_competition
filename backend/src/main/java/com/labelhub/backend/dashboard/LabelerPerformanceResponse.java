package com.labelhub.backend.dashboard;

public record LabelerPerformanceResponse(
    String labelerId,
    String name,
    String role,
    String avatar,
    double score,
    long submittedCount,
    long approvedCount,
    long returnedCount,
    long avgDurationSec,
    double passRate) {}
