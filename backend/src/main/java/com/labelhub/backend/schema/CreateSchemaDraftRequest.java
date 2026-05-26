package com.labelhub.backend.schema;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateSchemaDraftRequest(
    @NotBlank(message = "name is required")
    @Size(max = 255, message = "name must be at most 255 characters")
    String name,

    String description,

    String taskId,

    @NotNull(message = "fields is required")
    JsonNode fields) {}
