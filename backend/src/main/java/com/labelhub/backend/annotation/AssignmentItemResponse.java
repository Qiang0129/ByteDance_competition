package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record AssignmentItemResponse(
    String assignmentId,
    String taskId,
    String taskTitle,
    String itemId,
    String status,
    boolean editable,
    String deadline,
    String schemaVersionId,
    JsonNode rawPayload,
    JsonNode fields,
    AssignmentPositionResponse position,
    String returnReason,
    DraftResponse draft,
    AnnotationResponse latestAnnotation) {}
