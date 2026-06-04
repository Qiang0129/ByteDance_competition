package com.labelhub.backend.review;

import java.util.List;

public record ReviewerReportSummaryResponse(
    int rangeDays,
    double approveRate,
    double returnRate,
    double disputeRate,
    double aiConsistencyRate,
    long reviewedTotal,
    List<ReviewerReportTrendPointResponse> trend) {}
