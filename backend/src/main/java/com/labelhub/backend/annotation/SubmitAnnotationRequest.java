package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record SubmitAnnotationRequest(
    String schemaVersionId,
    JsonNode answerJson,
    Integer draftVersion) {}
