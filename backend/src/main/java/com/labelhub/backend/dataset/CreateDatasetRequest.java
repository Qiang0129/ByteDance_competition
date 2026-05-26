package com.labelhub.backend.dataset;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateDatasetRequest(
    String taskId,

    @NotBlank(message = "name is required")
    @Size(max = 255, message = "name must be at most 255 characters")
    String name,

    @NotBlank(message = "kind is required")
    @Size(max = 64, message = "kind must be at most 64 characters")
    String kind) {}
