package com.labelhub.backend.dataset;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateDatasetRequest(
    @NotBlank(message = "taskId is required")
    String taskId,

    @NotBlank(message = "name is required")
    @Size(max = 255, message = "name must be at most 255 characters")
    String name,

    @NotBlank(message = "kind is required")
    String kind) {}
