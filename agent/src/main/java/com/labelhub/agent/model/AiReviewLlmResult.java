package com.labelhub.agent.model;

import com.fasterxml.jackson.databind.JsonNode;

public record AiReviewLlmResult(
    JsonNode scores,
    Double totalScore,
    String decision,
    String comment,
    JsonNode riskFlags,
    JsonNode evidence,
    JsonNode rawResponse,
    String modelName,
    int latencyMs) {}
