package com.labelhub.backend.schema;

public record SchemaSummaryResponse(
    String versionId,
    String versionNumber,
    String name,
    String taskId,
    String taskTitle,
    String status,
    int fieldCount,
    String updatedAt,
    String createdBy) {}
