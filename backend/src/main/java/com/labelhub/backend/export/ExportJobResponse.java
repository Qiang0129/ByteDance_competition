package com.labelhub.backend.export;

public record ExportJobResponse(
    String exportId,
    String taskId,
    String taskTitle,
    String format,
    String status,
    int progress,
    Integer exportedCount,
    Long fileSizeBytes,
    String downloadUrl,
    Object mappingJson,
    String errorSummary,
    String createdAt,
    String updatedAt,
    String createdBy) {}
