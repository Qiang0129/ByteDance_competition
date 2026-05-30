package com.labelhub.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

public record AiReviewResultResponse(
    Map<String, Double> scores,
    double total_score,
    String decision,
    String comment,
    List<String> risk_flags,
    List<String> evidence,
    String promptSnapshot,
    JsonNode responseJson,
    String modelName,
    Integer latencyMs) {}
