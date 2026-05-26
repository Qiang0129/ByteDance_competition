package com.labelhub.backend.task;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateTaskRequest(
    @NotBlank(message = "title is required")
    @Size(max = 255, message = "title is too long")
    String title,
    List<String> tags,
    String reward,
    @Min(value = 1, message = "quota must be greater than 0")
    Integer quota,
    String deadline,
    String datasetId,
    String strategy,
    @Min(value = 1, message = "maxClaimPerUser must be greater than 0")
    Integer maxClaimPerUser,
    List<String> assignedLabelerIds,
    String schema,
    String schemaVersionId,
    Boolean aiReviewEnabled,
    String description,
    String taskType,
    String status) {}
