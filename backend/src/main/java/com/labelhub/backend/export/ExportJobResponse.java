package com.labelhub.backend.export;

public record ExportJobResponse(
    String exportId,
    String taskId,
    String format,
    String status,
    int progress,
    String errorSummary,
    String createdAt,
    String updatedAt) {}
