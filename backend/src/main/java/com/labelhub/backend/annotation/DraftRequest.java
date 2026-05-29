package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record DraftRequest(
    JsonNode answerJson,
    String schemaDigest) {}
