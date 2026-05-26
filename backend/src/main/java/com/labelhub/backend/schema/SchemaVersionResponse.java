package com.labelhub.backend.schema;

import com.fasterxml.jackson.databind.JsonNode;

public record SchemaVersionResponse(
    String versionId,
    String versionNumber,
    String taskId,
    String taskTitle,
    String name,
    String description,
    String status,
    JsonNode fields,
    String updatedAt,
    String createdBy) {}
