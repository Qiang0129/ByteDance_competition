package com.labelhub.backend.ai;

public record AiDashboardKpiResponse(
    long totalJobs,
    long succeededJobs,
    long failedJobs,
    long pendingJobs,
    long runningJobs,
    long needHumanJobs,
    double passRate,
    double avgDurationSec) {}
