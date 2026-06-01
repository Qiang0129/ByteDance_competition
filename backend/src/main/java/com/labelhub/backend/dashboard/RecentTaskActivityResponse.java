package com.labelhub.backend.dashboard;

public record RecentTaskActivityResponse(
    String taskId,
    String taskTitle,
    String ownerName,
    String status,
    String updatedAt) {}
