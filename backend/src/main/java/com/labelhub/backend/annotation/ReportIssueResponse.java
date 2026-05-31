package com.labelhub.backend.annotation;

public record ReportIssueResponse(
    String issueId,
    String assignmentId,
    String taskId,
    String itemId,
    String category,
    String description,
    String status,
    String createdAt) {}
