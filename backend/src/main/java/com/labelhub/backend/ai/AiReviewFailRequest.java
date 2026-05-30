package com.labelhub.backend.ai;

public record AiReviewFailRequest(
    String runToken,
    String errorSummary) {}
