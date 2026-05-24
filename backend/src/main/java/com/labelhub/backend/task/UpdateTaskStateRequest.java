package com.labelhub.backend.task;

import jakarta.validation.constraints.NotBlank;

public record UpdateTaskStateRequest(
    @NotBlank(message = "state is required")
    String state) {}
