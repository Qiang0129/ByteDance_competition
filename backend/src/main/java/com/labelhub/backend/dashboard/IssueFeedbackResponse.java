package com.labelhub.backend.dashboard;

public record IssueFeedbackResponse(
    String issueId,
    String assignmentId,
    String taskId,
    String taskTitle,
    String itemId,
    String labelerId,
    String labelerName,
    String category,
    String categoryLabel,
    String description,
    String status,
    String createdAt) {}
