package com.labelhub.backend.schema;

import com.fasterxml.jackson.databind.JsonNode;

public record SchemaValidationRequest(
    String name,
    String description,
    JsonNode tabs,
    JsonNode fields) {}
