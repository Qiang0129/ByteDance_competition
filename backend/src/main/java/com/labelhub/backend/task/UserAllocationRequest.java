package com.labelhub.backend.task;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record UserAllocationRequest(
    @NotBlank(message = "userId is required")
    String userId,
    @Min(value = 1, message = "itemCount must be greater than 0")
    Integer itemCount) {}
