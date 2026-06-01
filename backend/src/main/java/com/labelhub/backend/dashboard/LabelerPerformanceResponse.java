package com.labelhub.backend.dashboard;

public record LabelerPerformanceResponse(
    String labelerId,
    String name,
    String role,
    String avatar,
    double score,
    long submitted,
    long approved,
    long returned,
    long avgDurationSec) {}
