package com.labelhub.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;

public record AiReviewCompleteRequest(
    JsonNode scores,
    String decision,
    String comment,
    String promptSnapshot,
    JsonNode responseJson) {}
