package com.labelhub.backend.export;

import java.util.List;

public record ExportTaskOptionsResponse(
    String taskId,
    String taskTitle,
    long acceptedCount,
    long exportableCount,
    List<ExportFieldOptionResponse> fields) {}
