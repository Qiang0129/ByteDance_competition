package com.labelhub.backend.dataset;

import java.time.LocalDateTime;

public record DatasetRecord(
    long id,
    Long taskId,
    String taskTitle,
    Long fileId,
    String fileName,
    Long fileSize,
    String datasetType,
    String importStatus,
    int totalCount,
    int successCount,
    int errorCount,
    String errorSummary,
    LocalDateTime createdAt,
    LocalDateTime updatedAt) {}
