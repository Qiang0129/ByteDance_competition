package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record DraftResponse(
    String assignmentId,
    JsonNode answerJson,
    String updatedAt) {}
