package com.labelhub.backend.review;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ReviewerReportTrendPointResponse(
    String label,
    long approve,
    @JsonProperty("return")
    long returnCount,
    long dispute) {}
