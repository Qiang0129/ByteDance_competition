package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public record LlmTriggerRequest(
    String triggerFieldName,
    String targetFieldName,
    List<String> targetFieldNames,
    JsonNode currentAnswerJson) {

  public LlmTriggerRequest(String triggerFieldName, String targetFieldName, JsonNode currentAnswerJson) {
    this(triggerFieldName, targetFieldName, null, currentAnswerJson);
  }
}
