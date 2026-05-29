package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record AnnotationResponse(
    String annotationId,
    String assignmentId,
    String schemaVersionId,
    JsonNode answerJson,
    JsonNode schemaSnapshot,
    String status,
    int revisionNo,
    String returnReason) {}
