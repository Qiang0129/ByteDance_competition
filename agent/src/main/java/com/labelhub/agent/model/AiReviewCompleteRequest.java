package com.labelhub.agent.model;

import com.fasterxml.jackson.databind.JsonNode;

public record AiReviewCompleteRequest(
    String runToken,
    JsonNode scores,
    Double totalScore,
    String decision,
    String comment,
    JsonNode riskFlags,
    JsonNode evidence,
    String promptSnapshot,
    JsonNode responseJson,
    String modelName,
    Integer latencyMs) {}
