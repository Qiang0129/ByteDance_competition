package com.labelhub.backend.dashboard;

public record DisputeStatsResponse(
    int rangeDays,
    long disputed,
    long resolved,
    long pending,
    double samplingRatio,
    double consistencyRate) {}
