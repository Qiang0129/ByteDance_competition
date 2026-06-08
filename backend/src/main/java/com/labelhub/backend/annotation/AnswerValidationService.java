package com.labelhub.backend.annotation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class AnswerValidationService {

  private final ObjectMapper objectMapper;

  public AnswerValidationService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public JsonNode requireAnswerObject(JsonNode answerJson) {
    if (answerJson == null || !answerJson.isObject()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_ANSWER_JSON",
          "answerJson must be an object");
    }
    return answerJson;
  }

  public JsonNode filterVisibleAnswer(JsonNode answerJson, ArrayNode fields) {
    Set<String> hiddenFields = resolveHiddenFields(fields, answerJson);
    ObjectNode filtered = objectMapper.createObjectNode();
    for (JsonNode field : fields) {
      String semanticType = semanticType(field);
      if (!isSubmittableSemanticType(semanticType)) {
        continue;
      }
      String fieldName = text(field, "fieldName", "");
      if (fieldName.isBlank() || hiddenFields.contains(fieldName) || !answerJson.has(fieldName)) {
        continue;
      }
      filtered.set(fieldName, answerJson.get(fieldName));
    }
    return filtered;
  }

  public void validateAnswer(JsonNode answerJson, ArrayNode fields) {
    Set<String> hiddenFields = resolveHiddenFields(fields, answerJson);
    Set<String> conditionalRequiredFields = resolveConditionalRequiredFields(fields, answerJson);
    for (JsonNode field : fields) {
      String semanticType = semanticType(field);
      if ("display".equals(semanticType) || "layout".equals(semanticType)) {
        continue;
      }
      String fieldName = text(field, "fieldName", "");
      if (fieldName.isBlank() || hiddenFields.contains(fieldName)) {
        continue;
      }
      JsonNode value = answerJson.get(fieldName);
      String label = text(field, "label", fieldName);
      boolean required = field.path("required").asBoolean(false)
          || conditionalRequiredFields.contains(fieldName);
      if (required && isEmptyAnswer(value)) {
        throwAnswerValidation(label + " is required");
      }
      int maxLength = field.path("maxLength").asInt(0);
      if (maxLength > 0 && value != null && value.isTextual() && value.asText().length() > maxLength) {
        throwAnswerValidation(label + " exceeds max length " + maxLength);
      }
      if ("json".equals(semanticType) && value != null && value.isTextual() && !value.asText().isBlank()) {
        try {
          objectMapper.readTree(value.asText());
        } catch (JsonProcessingException exception) {
          throwAnswerValidation(label + " is not valid JSON");
        }
      }
      validateChoiceValue(semanticType, field, value, label);
      validateFileValue(semanticType, value, label);
      validateStructuredValidators(field, value, label);
    }
  }

  public boolean isValidationError(ApiException exception) {
    return Set.of(
        "ANSWER_VALIDATION_FAILED",
        "INVALID_ANSWER_JSON",
        "INVALID_JSON").contains(exception.getCode());
  }

  private Set<String> resolveHiddenFields(ArrayNode fields, JsonNode answerJson) {
    Set<String> hidden = new HashSet<>();
    applyReactionRules(fields, answerJson, hidden, null);
    return hidden;
  }

  private Set<String> resolveConditionalRequiredFields(ArrayNode fields, JsonNode answerJson) {
    Set<String> required = new HashSet<>();
    applyReactionRules(fields, answerJson, null, required);
    return required;
  }

  private void applyReactionRules(
      ArrayNode fields,
      JsonNode answerJson,
      Set<String> hidden,
      Set<String> required) {
    if (hidden != null || required != null) {
      applyDisplayRequiredDefaults(fields, hidden, required);
    }
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String sourceField = text(reaction, "sourceField", "");
        if (!matchesReaction(reaction, answerJson.get(sourceField), findField(fields, sourceField))) {
          continue;
        }
        String targetField = text(reaction, "targetField", "");
        String action = text(reaction, "action", "");
        if (hidden != null) {
          if ("hidden".equals(action)) {
            hidden.add(targetField);
          } else if ("visible".equals(action) || isDisplayRequiredAction(action)) {
            hidden.remove(targetField);
          }
        }
        if (required != null) {
          if (isDisplayRequiredAction(action)) {
            required.add(targetField);
          } else if ("optional".equals(action)) {
            required.remove(targetField);
          }
        }
      }
    }
  }

  private void applyDisplayRequiredDefaults(
      ArrayNode fields,
      Set<String> hidden,
      Set<String> required) {
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String action = text(reaction, "action", "");
        if (!isDisplayRequiredAction(action)) {
          continue;
        }
        String targetField = text(reaction, "targetField", "");
        if (targetField.isBlank()) {
          continue;
        }
        if (hidden != null) {
          hidden.add(targetField);
        }
        if (required != null && !isStaticRequired(fields, targetField)) {
          required.remove(targetField);
        }
      }
    }
  }

  private boolean matchesReaction(JsonNode reaction, JsonNode value, JsonNode sourceField) {
    String operator = text(reaction, "operator", "");
    Set<String> expectedValues = resolveExpectedValues(reaction, sourceField);
    return switch (operator) {
      case "eq" -> valueMatchesExpected(value, expectedValues);
      case "ne" -> !valueMatchesExpected(value, expectedValues);
      case "empty" -> isEmptyAnswer(value);
      case "notEmpty" -> !isEmptyAnswer(value);
      case "includes" -> includesValue(value, expectedValues);
      default -> false;
    };
  }

  private Set<String> resolveExpectedValues(JsonNode reaction, JsonNode sourceField) {
    Set<String> values = new HashSet<>();
    String raw = text(reaction, "value", "");
    if (!raw.isBlank()) {
      values.add(raw);
    }
    if (sourceField != null) {
      JsonNode options = sourceField.path("options");
      if (options.isArray()) {
        for (JsonNode option : options) {
          String optionValue = text(option, "value", "");
          String optionLabel = text(option, "label", "");
          if (raw.equals(optionValue) || raw.equals(optionLabel)) {
            if (!optionValue.isBlank()) {
              values.add(optionValue);
            }
            if (!optionLabel.isBlank()) {
              values.add(optionLabel);
            }
          }
        }
      }
    }
    return values;
  }

  private void validateChoiceValue(String semanticType, JsonNode field, JsonNode value, String label) {
    if (!List.of("single_choice", "multi_choice", "tags").contains(semanticType) || isEmptyAnswer(value)) {
      return;
    }
    Set<String> allowed = new HashSet<>();
    JsonNode options = field.path("options");
    if (options.isArray()) {
      for (JsonNode option : options) {
        String optionValue = text(option, "value", "");
        if (!optionValue.isBlank()) {
          allowed.add(optionValue);
        }
      }
    }
    if ("single_choice".equals(semanticType)) {
      if (!value.isTextual() || !allowed.contains(value.asText())) {
        throwAnswerValidation(label + " has invalid option");
      }
      return;
    }
    if (!value.isArray()) {
      throwAnswerValidation(label + " must be an array");
    }
    for (JsonNode item : value) {
      if (!item.isTextual() || !allowed.contains(item.asText())) {
        throwAnswerValidation(label + " has invalid option");
      }
    }
  }

  private void validateFileValue(String semanticType, JsonNode value, String label) {
    if (!"file".equals(semanticType) || isEmptyAnswer(value)) {
      return;
    }
    if (!value.isArray()) {
      throwAnswerValidation(label + " must be an attachment array");
    }
    if (value.size() > AssignmentAttachmentService.MAX_FILES_PER_FIELD) {
      throwAnswerValidation(label + " can contain at most " + AssignmentAttachmentService.MAX_FILES_PER_FIELD + " files");
    }
    for (JsonNode item : value) {
      if (!item.isObject()
          || !hasText(item, "fileId")
          || !hasText(item, "name")
          || !hasText(item, "mimeType")
          || !hasText(item, "checksum")
          || !isValidSize(item.path("size"))) {
        throwAnswerValidation(label + " has invalid attachment metadata");
      }
    }
  }

  private boolean hasText(JsonNode node, String field) {
    JsonNode value = node.path(field);
    return value.isTextual() && !value.asText().isBlank();
  }

  private boolean isValidSize(JsonNode value) {
    long size;
    if (value.isIntegralNumber()) {
      size = value.asLong();
    } else if (value.isTextual()) {
      try {
        size = Long.parseLong(value.asText());
      } catch (NumberFormatException exception) {
        return false;
      }
    } else {
      return false;
    }
    return size >= 0 && size <= AssignmentAttachmentService.MAX_FILE_SIZE_BYTES;
  }

  private void validateStructuredValidators(JsonNode field, JsonNode value, String label) {
    JsonNode validators = field.path("validators");
    if (validators.isArray()) {
      for (JsonNode validator : validators) {
        validateOneValidator(validator, value, label);
      }
    }
    String legacyRegex = field.path("validations").path("regex").asText("");
    if (!legacyRegex.isBlank()) {
      validateRegex(legacyRegex, value, label);
    }
    String customFn = field.path("validations").path("customFn").asText("");
    if ("noEmoji(value)".equals(customFn)) {
      validateNoEmoji(value, label);
    } else if ("isJsonObject(value)".equals(customFn)) {
      validateJsonObject(value, label);
    } else if (customFn.startsWith("lengthBetween")) {
      var matcher = Pattern.compile("lengthBetween\\(value,\\s*(\\d+),\\s*(\\d+)\\)").matcher(customFn);
      if (matcher.find()) {
        validateLengthBetween(value, label, Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)));
      }
    }
  }

  private void validateOneValidator(JsonNode validator, JsonNode value, String label) {
    String type = text(validator, "type", "");
    switch (type) {
      case "regex" -> validateRegex(text(validator, "pattern", ""), value, label);
      case "noEmoji" -> validateNoEmoji(value, label);
      case "jsonObject" -> validateJsonObject(value, label);
      case "lengthBetween" -> validateLengthBetween(
          value,
          label,
          validator.path("min").asInt(0),
          validator.path("max").asInt(Integer.MAX_VALUE));
      default -> throwAnswerValidation(label + " has unsupported validator");
    }
  }

  private void validateRegex(String pattern, JsonNode value, String label) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    try {
      if (!Pattern.compile(pattern).matcher(value.asText()).matches()) {
        throwAnswerValidation(label + " format is invalid");
      }
    } catch (PatternSyntaxException exception) {
      throwAnswerValidation(label + " validator regex is invalid");
    }
  }

  private void validateNoEmoji(JsonNode value, String label) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    if (Pattern.compile("[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]").matcher(value.asText()).find()) {
      throwAnswerValidation(label + " cannot contain emoji");
    }
  }

  private void validateJsonObject(JsonNode value, String label) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    try {
      JsonNode parsed = objectMapper.readTree(value.asText());
      if (!parsed.isObject()) {
        throwAnswerValidation(label + " must be a JSON object");
      }
    } catch (JsonProcessingException exception) {
      throwAnswerValidation(label + " is not valid JSON");
    }
  }

  private void validateLengthBetween(JsonNode value, String label, int min, int max) {
    if (isEmptyAnswer(value) || !value.isTextual()) {
      return;
    }
    int length = value.asText().length();
    if (length < min || length > max) {
      throwAnswerValidation(label + " length must be between " + min + " and " + max);
    }
  }

  private JsonNode findField(ArrayNode fields, String fieldName) {
    for (JsonNode field : fields) {
      if (fieldName.equals(text(field, "fieldName", ""))) {
        return field;
      }
    }
    return null;
  }

  private boolean isStaticRequired(ArrayNode fields, String fieldName) {
    for (JsonNode field : fields) {
      if (fieldName.equals(text(field, "fieldName", ""))) {
        return field.path("required").asBoolean(false);
      }
    }
    return false;
  }

  private boolean isDisplayRequiredAction(String action) {
    return "visibleRequired".equals(action) || "required".equals(action);
  }

  private boolean valueMatchesExpected(JsonNode value, Set<String> expectedValues) {
    return value != null && !expectedValues.isEmpty() && expectedValues.contains(value.asText());
  }

  private boolean includesValue(JsonNode value, Set<String> expectedValues) {
    if (value == null || expectedValues.isEmpty()) {
      return false;
    }
    if (value.isArray()) {
      for (JsonNode item : value) {
        if (expectedValues.contains(item.asText())) {
          return true;
        }
      }
      return false;
    }
    return expectedValues.stream().anyMatch(expected -> value.asText().contains(expected));
  }

  private boolean isEmptyAnswer(JsonNode value) {
    return value == null
        || value.isNull()
        || (value.isTextual() && value.asText().isBlank())
        || (value.isArray() && value.isEmpty());
  }

  private boolean isSubmittableSemanticType(String semanticType) {
    return List.of(
        "text",
        "single_choice",
        "multi_choice",
        "tags",
        "file",
        "json").contains(semanticType);
  }

  private String semanticType(JsonNode field) {
    String semanticType = text(field, "semanticType", "");
    if (!semanticType.isBlank()) {
      return semanticType;
    }
    return inferSemanticType(text(field, "kind", ""));
  }

  private String inferSemanticType(String kind) {
    return switch (kind) {
      case "single-choice" -> "single_choice";
      case "multi-choice" -> "multi_choice";
      case "tags" -> "tags";
      case "json-editor" -> "json";
      case "file-upload" -> "file";
      case "llm-trigger" -> "llm";
      case "show-item" -> "display";
      case "group", "multi-tab" -> "layout";
      default -> "text";
    };
  }

  private String text(JsonNode node, String field, String fallback) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return fallback;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private void throwAnswerValidation(String message) {
    throw new ApiException(HttpStatus.BAD_REQUEST, "ANSWER_VALIDATION_FAILED", message);
  }
}
