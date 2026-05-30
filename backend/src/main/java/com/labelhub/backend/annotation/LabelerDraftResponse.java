package com.labelhub.backend.annotation;

public record LabelerDraftResponse(
    String assignmentId,
    String taskId,
    String itemId,
    String title,
    String taskTitle,
    String taskType,
    String taskTypeKey,
    String schemaVersionId,
    String schemaVersion,
    String updatedAt,
    boolean editable) {}
