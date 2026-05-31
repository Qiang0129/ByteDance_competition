package com.labelhub.backend.review;

import com.fasterxml.jackson.databind.JsonNode;

public record ReviewDecisionRequest(
    String decision,
    String reason,
    String note,
    Boolean escalate,
    JsonNode answerJson) {}
