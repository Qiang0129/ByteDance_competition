package com.labelhub.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;

public record AiReviewJobClaimResponse(
    AiReviewJobResponse job,
    String taskId,
    String taskTitle,
    String annotationId,
    String runToken,
    JsonNode rawPayload,
    JsonNode answerJson,
    JsonNode schemaSnapshot,
    JsonNode ruleSnapshot) {}
