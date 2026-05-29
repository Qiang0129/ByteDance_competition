package com.labelhub.backend.review;

import com.fasterxml.jackson.databind.JsonNode;

public record AnnotationToReviewResponse(
    String annotationId,
    String assignmentId,
    String itemId,
    String schemaVersionId,
    String labelerName,
    String submittedAt,
    JsonNode answerJson,
    JsonNode rawPayload,
    AiReviewResultResponse aiResult,
    String decision,
    int revisionNo,
    boolean isDispute) {}
