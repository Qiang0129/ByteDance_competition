package com.labelhub.backend.ai;

public record AiReviewDimension(
    String key,
    String label,
    double weight,
    double maxScore) {}
