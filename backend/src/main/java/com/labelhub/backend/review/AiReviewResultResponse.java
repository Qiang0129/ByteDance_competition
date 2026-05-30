package com.labelhub.backend.review;

import java.util.List;
import java.util.Map;

public record AiReviewResultResponse(
    Map<String, Double> scores,
    double total_score,
    String decision,
    String comment,
    List<String> risk_flags,
    List<String> evidence,
    String version,
    String modelName) {}
