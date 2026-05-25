package com.labelhub.backend.dataset;

import java.util.Map;

public record DatasetResponse(
    String id,
    String taskId,
    String taskTitle,
    String name,
    String kind,
    String description,
    int itemCount,
    long size,
    String importedAt,
    Map<String, Integer> mediaDistribution,
    String resourceUrl,
    String version,
    String importStatus,
    int errorCount,
    String errorSummary) {}
