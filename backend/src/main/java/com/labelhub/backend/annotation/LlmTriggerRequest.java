package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;

public record LlmTriggerRequest(
    String triggerFieldName,
    String targetFieldName,
    JsonNode currentAnswerJson) {}
