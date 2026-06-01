package com.labelhub.backend.dashboard;

public record ReviewDistributionResponse(
    long aiPass,
    long aiNeedHuman,
    long aiReject,
    long humanPass,
    long humanReturned) {}
