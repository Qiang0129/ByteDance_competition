package com.labelhub.backend.labeler;

import java.util.List;

public record LabelerReturnedItemResponse(
    String source,
    String sourceLabel,
    String assignmentId,
    String annotationId,
    String taskId,
    String itemId,
    String title,
    String taskTitle,
    String taskType,
    String taskTypeKey,
    String schemaVersionId,
    int revisionNo,
    String updatedAt,
    String reviewerName,
    Integer reviewRoundNo,
    String humanReason,
    String aiDecision,
    String aiComment,
    Double aiTotalScore,
    List<String> aiRiskFlags,
    List<String> aiEvidence,
    boolean actionable,
    String actionText) {}
