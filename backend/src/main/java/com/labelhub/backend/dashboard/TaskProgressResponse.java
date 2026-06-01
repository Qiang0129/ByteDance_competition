package com.labelhub.backend.dashboard;

public record TaskProgressResponse(
    String taskId,
    String title,
    long total,
    long approved,
    long returned,
    long pending) {}
