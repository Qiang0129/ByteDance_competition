package com.labelhub.backend.schema;

import java.time.LocalDateTime;

record SchemaRecord(
    long id,
    Long taskId,
    String taskTitle,
    int version,
    String schemaJson,
    String status,
    Long createdBy,
    String createdByName,
    LocalDateTime createdAt,
    LocalDateTime updatedAt,
    LocalDateTime publishedAt) {}
