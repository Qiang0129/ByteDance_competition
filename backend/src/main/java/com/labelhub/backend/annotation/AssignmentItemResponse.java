package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record AssignmentItemResponse(
    String assignmentId,
    String taskId,
    String taskTitle,
    String itemId,
    String schemaVersionId,
    JsonNode rawPayload,
    JsonNode fields,
    AssignmentPositionResponse position,
    String returnReason,
    DraftResponse draft) {}
