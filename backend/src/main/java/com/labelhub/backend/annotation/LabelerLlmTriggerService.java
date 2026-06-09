package com.labelhub.backend.annotation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.ai.AiModelConfigCrypto;
import com.labelhub.backend.ai.AiModelConfigRepository;
import com.labelhub.backend.annotation.AnnotationRepository.AssignmentItemRecord;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.prompt.PromptTemplateLoader;
import com.labelhub.backend.task.TaskDeadlineSettlementService;
import com.labelhub.backend.workflow.AuditLogRepository;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.io.BufferedReader;
import java.io.EOFException;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.StringReader;
import java.io.Writer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@Service
public class LabelerLlmTriggerService {

  private static final int MAX_CONTEXT_TEXT_LENGTH = 6000;
  private static final int MAX_PROMPT_LENGTH = 3000;
  private static final int MAX_PREVIEW_LENGTH = 240;

  private final AnnotationRepository annotationRepository;
  private final AiModelConfigRepository modelConfigRepository;
  private final AiModelConfigCrypto crypto;
  private final AuditLogRepository auditLogRepository;
  private final TaskDeadlineSettlementService deadlineSettlementService;
  private final PromptTemplateLoader promptTemplateLoader;
  private final ObjectMapper objectMapper;

  public LabelerLlmTriggerService(
      AnnotationRepository annotationRepository,
      AiModelConfigRepository modelConfigRepository,
      AiModelConfigCrypto crypto,
      AuditLogRepository auditLogRepository,
      TaskDeadlineSettlementService deadlineSettlementService,
      PromptTemplateLoader promptTemplateLoader,
      ObjectMapper objectMapper) {
    this.annotationRepository = annotationRepository;
    this.modelConfigRepository = modelConfigRepository;
    this.crypto = crypto;
    this.auditLogRepository = auditLogRepository;
    this.deadlineSettlementService = deadlineSettlementService;
    this.promptTemplateLoader = promptTemplateLoader;
    this.objectMapper = objectMapper;
  }

  public StreamingResponseBody stream(
      org.springframework.security.core.Authentication authentication,
      long assignmentId,
      LlmTriggerRequest request) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = annotationRepository.findAssignmentForLabeler(assignmentId, labeler.id())
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "ASSIGNMENT_NOT_FOUND",
            "assignment not found"));
    ensureAssignmentEditable(assignment);
    LlmTriggerContext context = resolveContext(assignment, request);
    AiModelConfigRepository.AiModelConfigRecord config;
    String apiKey;
    try {
      config = modelConfigRepository.findActive()
          .orElseThrow(() -> new ApiException(
              HttpStatus.CONFLICT,
              "LLM_TRIGGER_MODEL_CONFIG_REQUIRED",
              "active model config is required"));
      apiKey = crypto.decrypt(config.encryptedApiKey());
    } catch (ApiException exception) {
      auditTriggerCall(labeler, assignment, context, null, null, "failed", exception.getMessage());
      throw exception;
    }
    ObjectNode payload = buildChatCompletionPayload(config, context);
    return outputStream -> streamChatCompletion(outputStream, labeler, assignment, context, config, apiKey, payload);
  }

  private void ensureAssignmentEditable(AssignmentItemRecord assignment) {
    if (assignment.taskDeletedAt() != null) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_DELETED", "task has been deleted");
    }
    if ("voided".equals(normalize(assignment.assignmentStatus()))) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_VOIDED", "assignment has been voided");
    }
    String status = normalize(assignment.assignmentStatus());
    boolean editable = "returned".equals(status)
        ? "published".equals(normalize(assignment.taskStatus()))
            && !isDeadlineExpired(assignment.taskDeadline())
            && assignment.resubmitDeadline() != null
            && assignment.resubmitDeadline().isAfter(LocalDateTime.now())
        : List.of("claimed", "submitted").contains(status)
            && "published".equals(normalize(assignment.taskStatus()))
            && !isDeadlineExpired(assignment.taskDeadline());
    if (!editable) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_NOT_EDITABLE", "assignment is not editable");
    }
  }

  private LlmTriggerContext resolveContext(AssignmentItemRecord assignment, LlmTriggerRequest request) {
    if (request == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_REQUEST", "llm trigger request is required");
    }
    String triggerFieldName = trimToNull(request.triggerFieldName());
    List<String> requestedTargetFieldNames = readRequestedTargetFieldNames(request);
    if (triggerFieldName == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_REQUEST", "triggerFieldName is required");
    }
    JsonNode schema = readSchemaJson(assignment);
    ArrayNode fields = fieldsNode(schema);
    JsonNode triggerField = findField(fields, triggerFieldName);
    if (triggerField == null || !"llm-trigger".equals(text(triggerField, "kind", ""))) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_FIELD", "trigger field is not an llm trigger");
    }
    JsonNode componentProps = triggerField.path("componentProps");
    List<String> configuredTargetFieldNames = readConfiguredTargetFieldNames(componentProps);
    List<String> targetFieldNames = requestedTargetFieldNames.isEmpty()
        ? configuredTargetFieldNames
        : requestedTargetFieldNames;
    if (configuredTargetFieldNames.isEmpty() || targetFieldNames.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TARGET_FIELD", "trigger target fields are not configured");
    }
    List<TargetFieldContext> targetFields = new ArrayList<>();
    for (String targetFieldName : targetFieldNames) {
      if (!configuredTargetFieldNames.contains(targetFieldName)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TARGET_FIELD", "target field does not match trigger configuration");
      }
      JsonNode targetField = findField(fields, targetFieldName);
      if (targetField == null || !isSubmittableTarget(targetField)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TARGET_FIELD", "target field is not submittable");
      }
      targetFields.add(new TargetFieldContext(targetFieldName, targetField, semanticType(targetField)));
    }
    String taskInstruction = truncate(text(componentProps, "taskInstruction", ""), MAX_PROMPT_LENGTH);
    String promptTemplate = truncate(blankToDefault(text(componentProps, "promptTemplate", ""), defaultUserPrompt()), MAX_PROMPT_LENGTH);
    String outputInstruction = truncate(text(componentProps, "outputInstruction", ""), MAX_PROMPT_LENGTH);
    List<String> contextPaths = readContextPaths(componentProps);
    JsonNode rawPayload = buildRawPayload(assignment);
    JsonNode currentAnswer = request.currentAnswerJson() != null && request.currentAnswerJson().isObject()
        ? request.currentAnswerJson()
        : objectMapper.createObjectNode();
    return new LlmTriggerContext(
        triggerFieldName,
        assignment.taskTitle(),
        triggerField,
        targetFields,
        taskInstruction,
        promptTemplate,
        outputInstruction,
        contextPaths,
        rawPayload,
        currentAnswer,
        fields);
  }

  private ObjectNode buildChatCompletionPayload(
      AiModelConfigRepository.AiModelConfigRecord config,
      LlmTriggerContext context) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("model", config.modelName());
    ArrayNode messages = root.putArray("messages");
    messages.add(message("system", buildSystemPrompt()));
    messages.add(message("user", buildUserPrompt(context)));
    root.put("temperature", 0.2);
    root.put("stream", true);
    return root;
  }

  private String buildSystemPrompt() {
    return promptTemplateLoader.loadOrDefault("labeler-llm-trigger-system.md", """
        你是 LabelHub 的字段级 LLM 生成组件。你必须只输出 JSON。
        输出结构固定为 {"displayText":"整体建议","results":[{"targetFieldName":"字段名","displayText":"字段建议","value":"目标字段的候选值"}]}。
        single_choice 必须输出合法 options value; multi_choice/tags 必须输出合法 options value 数组; json 必须输出合法 JSON。
        options[].value 是提交值，options[].label 是标注员可见文案。displayText 必须使用 label，不要把 option_a / option_b 这类内部值当作建议文案。
        必须按 currentAnswerJson 和本次生成值共同计算 reactionRules。最终隐藏的目标字段不要返回；最终可见且属于 targetFields 的字段必须返回。
        """);
  }

  private String buildUserPrompt(LlmTriggerContext context) {
    ObjectNode payload = objectMapper.createObjectNode();
    payload.put("taskTitle", blankToDefault(context.taskTitle(), ""));
    payload.put("taskInstruction", blankToDefault(context.taskInstruction(), ""));
    payload.put("ownerPrompt", context.promptTemplate());
    payload.put("outputInstruction", blankToDefault(context.outputInstruction(), ""));
    payload.set("rawPayload", selectedRawPayload(context.rawPayload(), context.contextPaths()));
    payload.set("currentAnswerJson", context.currentAnswerJson());
    payload.set("triggerField", context.triggerField());
    payload.set("targetFields", targetFieldsPayload(context.targetFields()));
    payload.set("reactionRules", reactionRulesPayload(context.fields()));
    if (context.targetFields().size() == 1) {
      TargetFieldContext target = context.targetFields().get(0);
      payload.set("targetField", target.field());
      payload.put("targetSemanticType", target.semanticType());
    }
    return truncateForContext(writeJson(payload));
  }

  private ArrayNode targetFieldsPayload(List<TargetFieldContext> targetFields) {
    ArrayNode result = objectMapper.createArrayNode();
    for (TargetFieldContext target : targetFields) {
      ObjectNode node = objectMapper.createObjectNode();
      node.put("targetFieldName", target.fieldName());
      node.put("targetSemanticType", target.semanticType());
      node.put("label", text(target.field(), "label", target.fieldName()));
      node.set("field", target.field());
      node.set("optionMappings", optionMappings(target.field()));
      result.add(node);
    }
    return result;
  }

  private ArrayNode reactionRulesPayload(ArrayNode fields) {
    ArrayNode result = objectMapper.createArrayNode();
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String sourceFieldName = text(reaction, "sourceField", "");
        String targetFieldName = text(reaction, "targetField", "");
        JsonNode sourceField = findField(fields, sourceFieldName);
        JsonNode targetField = findField(fields, targetFieldName);
        ObjectNode node = objectMapper.createObjectNode();
        node.put("sourceField", sourceFieldName);
        node.put("sourceLabel", sourceField == null ? sourceFieldName : text(sourceField, "label", sourceFieldName));
        node.put("operator", text(reaction, "operator", ""));
        node.put("value", text(reaction, "value", ""));
        node.put("valueLabel", sourceField == null
            ? text(reaction, "value", "")
            : optionLabel(text(reaction, "value", ""), sourceField).orElse(text(reaction, "value", "")));
        node.put("targetField", targetFieldName);
        node.put("targetLabel", targetField == null ? targetFieldName : text(targetField, "label", targetFieldName));
        node.put("action", text(reaction, "action", ""));
        result.add(node);
      }
    }
    return result;
  }

  private ArrayNode optionMappings(JsonNode field) {
    ArrayNode result = objectMapper.createArrayNode();
    JsonNode options = field.path("options");
    if (!options.isArray()) {
      return result;
    }
    for (JsonNode option : options) {
      ObjectNode node = objectMapper.createObjectNode();
      node.put("value", text(option, "value", ""));
      node.put("label", text(option, "label", ""));
      result.add(node);
    }
    return result;
  }

  private void streamChatCompletion(
      OutputStream outputStream,
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      LlmTriggerContext context,
      AiModelConfigRepository.AiModelConfigRecord config,
      String apiKey,
      ObjectNode payload) {
    Writer writer = new OutputStreamWriter(outputStream, StandardCharsets.UTF_8);
    StringBuilder answer = new StringBuilder();
    try {
      HttpRequest request = HttpRequest.newBuilder()
          .uri(URI.create(resolveChatCompletionsUrl(config.apiBaseUrl(), config.useFullUrl())))
          .timeout(Duration.ofSeconds(90))
          .header(HttpHeaders.CONTENT_TYPE, "application/json")
          .header(HttpHeaders.ACCEPT, "text/event-stream")
          .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
          .POST(HttpRequest.BodyPublishers.ofString(writeJson(payload), StandardCharsets.UTF_8))
          .build();
      HttpResponse<java.io.InputStream> response = HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(10))
          .build()
          .send(request, HttpResponse.BodyHandlers.ofInputStream());
      if (response.statusCode() < 200 || response.statusCode() >= 300) {
        String errorBody = new String(response.body().readAllBytes(), StandardCharsets.UTF_8);
        safeAuditTriggerCall(labeler, assignment, context, config.modelName(), null, "failed", errorBody);
        sendEvent(writer, "error", "LLM_TRIGGER_REQUEST_FAILED");
        return;
      }
      try (BufferedReader reader = new BufferedReader(
          new java.io.InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
        String line;
        while ((line = reader.readLine()) != null) {
          if (!line.startsWith("data:")) {
            continue;
          }
          String data = line.substring("data:".length()).trim();
          if (data.isBlank()) {
            continue;
          }
          if ("[DONE]".equals(data)) {
            break;
          }
          String delta = extractStreamDelta(data);
          if (delta != null && !delta.isEmpty()) {
            answer.append(delta);
            sendEvent(writer, "delta", delta);
          }
        }
      }
      if (answer.isEmpty()) {
        safeAuditTriggerCall(labeler, assignment, context, config.modelName(), null, "failed", "empty stream answer");
        sendEvent(writer, "error", "LLM_TRIGGER_EMPTY_RESULT");
        return;
      }
      ObjectNode result = normalizeModelOutput(answer.toString(), context);
      safeAuditTriggerCall(labeler, assignment, context, config.modelName(), result, "success", null);
      sendEvent(writer, "result", writeJson(result));
      sendEvent(writer, "done", "DONE");
    } catch (IOException | InterruptedException | RuntimeException exception) {
      if (exception instanceof InterruptedException) {
        Thread.currentThread().interrupt();
      }
      if (isClientDisconnect(exception)) {
        safeAuditTriggerCall(labeler, assignment, context, config.modelName(), null, "cancelled", exception.getMessage());
        return;
      }
      if (exception instanceof ApiException apiException) {
        safeAuditTriggerCall(labeler, assignment, context, config.modelName(), null, "failed", apiException.getMessage());
        safeSendEvent(writer, "error", apiException.getCode());
        return;
      }
      safeAuditTriggerCall(labeler, assignment, context, config.modelName(), null, "failed", exception.getMessage());
      safeSendEvent(writer, "error", "LLM_TRIGGER_REQUEST_FAILED");
    }
  }

  private ObjectNode normalizeModelOutput(String raw, LlmTriggerContext context) {
    JsonNode root = parseJsonObject(extractJsonObject(raw));
    String displayText = text(root, "displayText", "");
    ObjectNode result = objectMapper.createObjectNode();
    ObjectNode mergedAnswer = context.currentAnswerJson().isObject()
        ? (ObjectNode) context.currentAnswerJson().deepCopy()
        : objectMapper.createObjectNode();
    Map<String, ObjectNode> normalizedByField = new LinkedHashMap<>();
    JsonNode rawResults = root.path("results");
    for (TargetFieldContext target : context.targetFields()) {
      JsonNode fieldSource = context.targetFields().size() == 1 && !rawResults.isArray()
          ? root
          : findResultNode(rawResults, target.fieldName());
      if (fieldSource == null || fieldSource.isMissingNode() || fieldSource.isNull() || !hasModelValue(fieldSource)) {
        continue;
      }
      ObjectNode normalized = normalizeFieldResult(fieldSource, target, displayText);
      normalizedByField.put(target.fieldName(), normalized);
      mergedAnswer.set(target.fieldName(), normalized.path("normalizedValue"));
    }
    Set<String> visibleFields = resolveVisibleFields(context.fields(), mergedAnswer);
    ArrayNode fieldResults = objectMapper.createArrayNode();
    for (TargetFieldContext target : context.targetFields()) {
      if (!visibleFields.contains(target.fieldName())) {
        continue;
      }
      ObjectNode normalized = normalizedByField.get(target.fieldName());
      if (normalized == null) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_RESULT", "model result target field is missing");
      }
      fieldResults.add(normalized);
    }
    result.put("displayText", blankToDefault(displayText, summarizeFieldResults(fieldResults)));
    result.set("results", fieldResults);
    if (fieldResults.size() == 1) {
      JsonNode first = fieldResults.get(0);
      result.put("targetFieldName", text(first, "targetFieldName", ""));
      result.put("targetSemanticType", text(first, "targetSemanticType", ""));
      result.set("normalizedValue", first.path("normalizedValue"));
      result.put("normalizedDisplayValue", text(first, "normalizedDisplayValue", formatDisplayValue(first.path("normalizedValue"))));
    }
    return result;
  }

  private boolean hasModelValue(JsonNode fieldSource) {
    return fieldSource != null
        && !fieldSource.isMissingNode()
        && !fieldSource.isNull()
        && (fieldSource.has("value") || fieldSource.has("normalizedValue"));
  }

  private ObjectNode normalizeFieldResult(JsonNode fieldSource, TargetFieldContext target, String rootDisplayText) {
    JsonNode rawValue = fieldSource.has("value") ? fieldSource.get("value") : fieldSource.path("normalizedValue");
    JsonNode normalizedValue = normalizeValue(rawValue, target.field(), target.semanticType());
    ObjectNode result = objectMapper.createObjectNode();
    result.put("targetFieldName", target.fieldName());
    result.put("targetSemanticType", target.semanticType());
    result.put("displayText", blankToDefault(text(fieldSource, "displayText", ""), blankToDefault(rootDisplayText, formatDisplayValue(normalizedValue))));
    result.set("normalizedValue", normalizedValue);
    result.put("normalizedDisplayValue", displayValue(normalizedValue, target.field(), target.semanticType()));
    return result;
  }

  private JsonNode findResultNode(JsonNode results, String targetFieldName) {
    if (!results.isArray()) {
      return null;
    }
    for (JsonNode item : results) {
      if (targetFieldName.equals(text(item, "targetFieldName", ""))) {
        return item;
      }
    }
    return null;
  }

  private String summarizeFieldResults(ArrayNode fieldResults) {
    List<String> parts = new ArrayList<>();
    for (JsonNode item : fieldResults) {
      parts.add(text(item, "targetFieldName", "") + ": " + text(item, "normalizedDisplayValue", formatDisplayValue(item.path("normalizedValue"))));
    }
    return String.join("; ", parts);
  }

  private JsonNode normalizeValue(JsonNode value, JsonNode targetField, String semanticType) {
    if (value == null || value.isMissingNode() || value.isNull()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_RESULT", "model result value is empty");
    }
    return switch (semanticType) {
      case "single_choice" -> objectMapper.getNodeFactory().textNode(normalizeSingleChoice(value, targetField));
      case "multi_choice", "tags" -> normalizeMultiChoice(value, targetField);
      case "json" -> objectMapper.getNodeFactory().textNode(normalizeJsonValue(value));
      default -> objectMapper.getNodeFactory().textNode(value.isTextual() ? value.asText() : value.toString());
    };
  }

  private String normalizeSingleChoice(JsonNode value, JsonNode targetField) {
    String raw = value.isTextual() ? value.asText() : value.toString();
    return resolveOptionValue(raw, targetField)
        .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_RESULT", "model result option is invalid"));
  }

  private ArrayNode normalizeMultiChoice(JsonNode value, JsonNode targetField) {
    ArrayNode result = objectMapper.createArrayNode();
    Set<String> seen = new HashSet<>();
    List<String> rawValues = new ArrayList<>();
    if (value.isArray()) {
      value.forEach(item -> rawValues.add(item.isTextual() ? item.asText() : item.toString()));
    } else if (value.isTextual()) {
      String raw = value.asText();
      for (String part : raw.split("[,，、\\n]")) {
        if (!part.isBlank()) {
          rawValues.add(part.trim());
        }
      }
    } else {
      rawValues.add(value.toString());
    }
    for (String raw : rawValues) {
      String optionValue = resolveOptionValue(raw, targetField)
          .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_RESULT", "model result option is invalid"));
      if (seen.add(optionValue)) {
        result.add(optionValue);
      }
    }
    return result;
  }

  private java.util.Optional<String> resolveOptionValue(String raw, JsonNode targetField) {
    JsonNode options = targetField.path("options");
    if (!options.isArray()) {
      return java.util.Optional.empty();
    }
    String normalized = raw == null ? "" : raw.trim();
    for (JsonNode option : options) {
      String value = text(option, "value", "");
      String label = text(option, "label", "");
      if (normalized.equals(value) || normalized.equals(label)) {
        return java.util.Optional.of(value);
      }
    }
    return java.util.Optional.empty();
  }

  private String displayValue(JsonNode value, JsonNode targetField, String semanticType) {
    if (value == null || value.isMissingNode() || value.isNull()) {
      return "";
    }
    return switch (semanticType) {
      case "single_choice" -> optionLabel(value.asText(), targetField).orElse(value.asText());
      case "multi_choice", "tags" -> displayMultiChoiceValue(value, targetField);
      default -> formatDisplayValue(value);
    };
  }

  private String displayMultiChoiceValue(JsonNode value, JsonNode targetField) {
    List<String> labels = new ArrayList<>();
    if (value.isArray()) {
      for (JsonNode item : value) {
        String raw = item.isTextual() ? item.asText() : item.toString();
        labels.add(optionLabel(raw, targetField).orElse(raw));
      }
      return String.join("、", labels);
    }
    String raw = value.isTextual() ? value.asText() : value.toString();
    return optionLabel(raw, targetField).orElse(raw);
  }

  private java.util.Optional<String> optionLabel(String raw, JsonNode targetField) {
    JsonNode options = targetField.path("options");
    if (!options.isArray()) {
      return java.util.Optional.empty();
    }
    String normalized = raw == null ? "" : raw.trim();
    for (JsonNode option : options) {
      String value = text(option, "value", "");
      String label = text(option, "label", "");
      if (normalized.equals(value) || normalized.equals(label)) {
        return java.util.Optional.of(label.isBlank() ? value : label);
      }
    }
    return java.util.Optional.empty();
  }

  private Set<String> resolveVisibleFields(ArrayNode fields, ObjectNode values) {
    Set<String> visible = new LinkedHashSet<>();
    for (JsonNode field : fields) {
      String fieldName = text(field, "fieldName", "");
      if (!fieldName.isBlank()) {
        visible.add(fieldName);
      }
    }
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String action = text(reaction, "action", "");
        String targetField = text(reaction, "targetField", "");
        if (!targetField.isBlank() && isDisplayRequiredAction(action)) {
          visible.remove(targetField);
        }
      }
    }
    for (JsonNode field : fields) {
      JsonNode reactions = field.path("reactions");
      if (!reactions.isArray()) {
        continue;
      }
      for (JsonNode reaction : reactions) {
        String targetField = text(reaction, "targetField", "");
        if (targetField.isBlank()) {
          continue;
        }
        JsonNode sourceField = findField(fields, text(reaction, "sourceField", ""));
        if (!matchesReaction(reaction, values.get(text(reaction, "sourceField", "")), sourceField)) {
          continue;
        }
        switch (text(reaction, "action", "")) {
          case "visible", "visibleRequired", "required" -> visible.add(targetField);
          case "hidden" -> visible.remove(targetField);
          default -> {
            // optional 只影响必填状态，LLM 结果过滤只关心可见性。
          }
        }
      }
    }
    return visible;
  }

  private boolean matchesReaction(JsonNode reaction, JsonNode value, JsonNode sourceField) {
    String operator = text(reaction, "operator", "");
    List<String> expectedValues = resolveExpectedValues(reaction, sourceField);
    return switch (operator) {
      case "eq" -> valueMatchesExpected(value, expectedValues);
      case "ne" -> !valueMatchesExpected(value, expectedValues);
      case "empty" -> isEmptyAnswerValue(value);
      case "notEmpty" -> !isEmptyAnswerValue(value);
      case "includes" -> valueIncludesExpected(value, expectedValues);
      default -> false;
    };
  }

  private List<String> resolveExpectedValues(JsonNode reaction, JsonNode sourceField) {
    LinkedHashSet<String> values = new LinkedHashSet<>();
    String raw = text(reaction, "value", "");
    values.add(raw);
    if (sourceField != null) {
      JsonNode options = sourceField.path("options");
      if (options.isArray()) {
        for (JsonNode option : options) {
          String value = text(option, "value", "");
          String label = text(option, "label", "");
          if (raw.equals(value) || raw.equals(label)) {
            values.add(value);
            values.add(label);
          }
        }
      }
    }
    return List.copyOf(values);
  }

  private boolean valueMatchesExpected(JsonNode value, List<String> expectedValues) {
    if (value == null || value.isMissingNode() || value.isNull()) {
      return expectedValues.contains("");
    }
    if (value.isArray()) {
      for (JsonNode item : value) {
        if (valueMatchesExpected(item, expectedValues)) {
          return true;
        }
      }
      return false;
    }
    String actual = value.isTextual() ? value.asText() : value.toString();
    return expectedValues.contains(actual);
  }

  private boolean valueIncludesExpected(JsonNode value, List<String> expectedValues) {
    if (value == null || value.isMissingNode() || value.isNull()) {
      return false;
    }
    if (value.isArray()) {
      for (JsonNode item : value) {
        if (valueMatchesExpected(item, expectedValues)) {
          return true;
        }
      }
      return false;
    }
    String actual = value.isTextual() ? value.asText() : value.toString();
    return expectedValues.stream().anyMatch(expected -> !expected.isBlank() && actual.contains(expected));
  }

  private boolean isEmptyAnswerValue(JsonNode value) {
    if (value == null || value.isMissingNode() || value.isNull()) {
      return true;
    }
    if (value.isArray()) {
      return value.isEmpty();
    }
    return value.isTextual() && value.asText().isBlank();
  }

  private boolean isDisplayRequiredAction(String action) {
    return "visibleRequired".equals(action) || "required".equals(action);
  }

  private String normalizeJsonValue(JsonNode value) {
    try {
      JsonNode parsed = value.isTextual() ? objectMapper.readTree(value.asText()) : value;
      return objectMapper.writeValueAsString(parsed);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_RESULT", "model result JSON is invalid");
    }
  }

  private JsonNode selectedRawPayload(JsonNode rawPayload, List<String> contextPaths) {
    if (contextPaths == null || contextPaths.isEmpty()) {
      return rawPayload;
    }
    ObjectNode selected = objectMapper.createObjectNode();
    for (String path : contextPaths) {
      JsonNode value = getValueByPath(rawPayload, path);
      if (value != null && !value.isMissingNode()) {
        selected.set(path, value);
      }
    }
    return selected;
  }

  private JsonNode getValueByPath(JsonNode source, String path) {
    if (source == null || path == null || path.isBlank()) {
      return null;
    }
    JsonNode current = source;
    for (String rawSegment : path.replaceAll("\\[(\\d+)]", ".$1").split("\\.")) {
      String segment = rawSegment.trim();
      if (segment.isBlank()) {
        continue;
      }
      if (current == null || current.isMissingNode() || current.isNull()) {
        return null;
      }
      current = current.path(segment);
    }
    return current;
  }

  private JsonNode readSchemaJson(AssignmentItemRecord assignment) {
    Long schemaId = readMetadataSchemaVersionId(assignment.rewardRuleJson());
    if (schemaId != null) {
      return annotationRepository.findSchema(schemaId)
          .map(schema -> readJson(schema.schemaJson()))
          .orElse(readJson(assignment.fallbackSchemaJson()));
    }
    return readJson(assignment.fallbackSchemaJson());
  }

  private JsonNode buildRawPayload(AssignmentItemRecord assignment) {
    JsonNode raw = readJson(assignment.rawPayloadJson());
    ObjectNode node = raw != null && raw.isObject() ? (ObjectNode) raw.deepCopy() : objectMapper.createObjectNode();
    if (!node.has("media_type")) {
      node.put("media_type", blankToDefault(assignment.mediaType(), "text"));
    }
    if (assignment.contentMarkdown() != null && !assignment.contentMarkdown().isBlank()) {
      node.put("content_markdown", assignment.contentMarkdown());
    }
    if (assignment.mediaUrl() != null && !assignment.mediaUrl().isBlank()) {
      node.put("media_url", "[masked media url]");
    }
    return node;
  }

  private ArrayNode fieldsNode(JsonNode schema) {
    JsonNode fields = schema.path("fields");
    if (fields.isArray()) {
      return (ArrayNode) fields;
    }
    return objectMapper.createArrayNode();
  }

  private JsonNode findField(ArrayNode fields, String fieldName) {
    for (JsonNode field : fields) {
      if (fieldName.equals(text(field, "fieldName", ""))) {
        return field;
      }
    }
    return null;
  }

  private boolean isSubmittableTarget(JsonNode field) {
    return List.of("text", "single_choice", "multi_choice", "tags", "file", "json")
        .contains(semanticType(field));
  }

  private String semanticType(JsonNode field) {
    String semanticType = text(field, "semanticType", "");
    if (!semanticType.isBlank()) {
      return semanticType;
    }
    return switch (text(field, "kind", "")) {
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

  private List<String> readContextPaths(JsonNode componentProps) {
    JsonNode paths = componentProps.path("contextPaths");
    if (!paths.isArray()) {
      return List.of();
    }
    List<String> result = new ArrayList<>();
    for (JsonNode path : paths) {
      if (path.isTextual() && !path.asText().isBlank()) {
        result.add(path.asText().trim());
      }
    }
    return result;
  }

  private List<String> readRequestedTargetFieldNames(LlmTriggerRequest request) {
    List<String> result = new ArrayList<>();
    if (request.targetFieldNames() != null) {
      for (String fieldName : request.targetFieldNames()) {
        addUniqueTrimmed(result, fieldName);
      }
    }
    addUniqueTrimmed(result, request.targetFieldName());
    return result;
  }

  private List<String> readConfiguredTargetFieldNames(JsonNode componentProps) {
    LinkedHashSet<String> result = new LinkedHashSet<>();
    JsonNode targetFields = componentProps.path("targetFields");
    if (targetFields.isArray()) {
      for (JsonNode item : targetFields) {
        if (item.isTextual() && !item.asText().isBlank()) {
          result.add(item.asText().trim());
        }
      }
    }
    String legacyTarget = trimToNull(text(componentProps, "targetField", ""));
    if (legacyTarget != null) {
      result.add(legacyTarget);
    }
    return List.copyOf(result);
  }

  private void addUniqueTrimmed(List<String> result, String value) {
    String trimmed = trimToNull(value);
    if (trimmed != null && !result.contains(trimmed)) {
      result.add(trimmed);
    }
  }

  private String extractStreamDelta(String data) {
    JsonNode root = readJson(data);
    JsonNode delta = root.path("choices").path(0).path("delta").path("content");
    if (delta.isTextual()) {
      return delta.asText();
    }
    JsonNode messageContent = root.path("choices").path(0).path("message").path("content");
    return messageContent.isTextual() ? messageContent.asText() : null;
  }

  private String extractJsonObject(String raw) {
    String text = raw == null ? "" : raw.trim();
    if (text.startsWith("```")) {
      text = text.replaceFirst("^```(?:json)?", "").replaceFirst("```$", "").trim();
    }
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return text.substring(start, end + 1);
    }
    return text;
  }

  private JsonNode parseJsonObject(String json) {
    try {
      JsonNode node = objectMapper.readTree(json);
      if (node != null && node.isObject()) {
        return node;
      }
    } catch (JsonProcessingException exception) {
      // 统一转成业务错误，避免把模型原文泄露到错误页。
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_LLM_TRIGGER_RESULT", "model result is not valid JSON");
  }

  private String resolveChatCompletionsUrl(String apiBaseUrl, boolean useFullUrl) {
    String base = trimTrailingSlash(apiBaseUrl);
    if (useFullUrl) {
      if (base.endsWith("/chat/completions")) {
        return base;
      }
      if (base.endsWith("/responses")) {
        return base.substring(0, base.length() - "/responses".length()) + "/chat/completions";
      }
      return base + "/chat/completions";
    }
    return base + "/chat/completions";
  }

  private ObjectNode message(String role, String content) {
    ObjectNode message = objectMapper.createObjectNode();
    message.put("role", role);
    message.put("content", content);
    return message;
  }

  private void sendEvent(Writer writer, String event, String data) throws IOException {
    writer.write("event: ");
    writer.write(event);
    writer.write("\n");
    try (BufferedReader reader = new BufferedReader(new StringReader(data == null ? "" : data))) {
      String line;
      boolean wroteLine = false;
      while ((line = reader.readLine()) != null) {
        writer.write("data: ");
        writer.write(line);
        writer.write("\n");
        wroteLine = true;
      }
      if (!wroteLine) {
        writer.write("data: \n");
      }
    }
    writer.write("\n");
    writer.flush();
  }

  private void safeSendEvent(Writer writer, String event, String data) {
    try {
      sendEvent(writer, event, data);
    } catch (IOException exception) {
      // 客户端断开时不能再向响应流写入错误页。
    }
  }

  private void auditTriggerCall(
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      LlmTriggerContext context,
      String modelName,
      JsonNode result,
      String status,
      String error) {
    ObjectNode snapshot = objectMapper.createObjectNode();
    snapshot.put("taskId", assignment.taskId());
    snapshot.put("itemId", assignment.itemId());
    snapshot.put("triggerFieldName", context.triggerFieldName());
    ArrayNode targetFieldNames = snapshot.putArray("targetFieldNames");
    ArrayNode targetSemanticTypes = snapshot.putArray("targetSemanticTypes");
    for (TargetFieldContext target : context.targetFields()) {
      targetFieldNames.add(target.fieldName());
      targetSemanticTypes.add(target.semanticType());
    }
    if (context.targetFields().size() == 1) {
      TargetFieldContext target = context.targetFields().get(0);
      snapshot.put("targetFieldName", target.fieldName());
      snapshot.put("targetSemanticType", target.semanticType());
    }
    snapshot.put("promptPreview", truncate(context.promptTemplate(), MAX_PREVIEW_LENGTH));
    snapshot.put("taskInstructionPreview", truncate(context.taskInstruction(), MAX_PREVIEW_LENGTH));
    snapshot.put("outputInstructionPreview", truncate(context.outputInstruction(), MAX_PREVIEW_LENGTH));
    snapshot.put("modelName", blankToDefault(modelName, ""));
    snapshot.put("status", status);
    if (result != null) {
      snapshot.put("resultPreview", truncate(writeJson(result), MAX_PREVIEW_LENGTH));
    }
    if (error != null && !error.isBlank()) {
      snapshot.put("errorPreview", truncate(error, MAX_PREVIEW_LENGTH));
    }
    ObjectNode root = objectMapper.createObjectNode();
    root.put("entityType", WorkflowEntityType.ASSIGNMENT.value());
    root.put("entityId", assignment.assignmentId());
    root.put("action", "labeler_llm_trigger.generate");
    root.put("operatorRole", "labeler");
    root.set("snapshot", snapshot);
    auditLogRepository.insert(
        WorkflowEntityType.ASSIGNMENT,
        assignment.assignmentId(),
        labeler.id(),
        "labeler",
        "labeler_llm_trigger.generate",
        null,
        null,
        "llm trigger " + status,
        null,
        null,
        writeJson(root));
  }

  private void safeAuditTriggerCall(
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      LlmTriggerContext context,
      String modelName,
      JsonNode result,
      String status,
      String error) {
    try {
      auditTriggerCall(labeler, assignment, context, modelName, result, status, error);
    } catch (RuntimeException exception) {
      // 审计失败不能影响已经开始的 SSE 响应。
    }
  }

  private boolean isClientDisconnect(Throwable exception) {
    Throwable current = exception;
    while (current != null) {
      if (current instanceof EOFException) {
        return true;
      }
      String message = current.getMessage();
      if (message != null) {
        String normalized = message.toLowerCase(Locale.ROOT);
        if (normalized.contains("broken pipe")
            || normalized.contains("connection reset")
            || normalized.contains("clientabortexception")
            || normalized.contains("abort")) {
          return true;
        }
      }
      current = current.getCause();
    }
    return false;
  }

  private Long readMetadataSchemaVersionId(String rewardRuleJson) {
    if (rewardRuleJson == null || rewardRuleJson.isBlank()) {
      return null;
    }
    JsonNode root = readJson(rewardRuleJson);
    JsonNode value = root.path("schemaVersionId");
    if (value.isNumber()) {
      return value.longValue();
    }
    if (value.isTextual() && !value.asText().isBlank()) {
      try {
        return Long.parseLong(value.asText());
      } catch (NumberFormatException exception) {
        return null;
      }
    }
    return null;
  }

  private AuthenticatedUser requireLabeler(org.springframework.security.core.Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    if (!principal.roles().contains("labeler")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "labeler role is required");
    }
    return principal;
  }

  private JsonNode readJson(String json) {
    if (json == null || json.isBlank()) {
      return objectMapper.createObjectNode();
    }
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException exception) {
      return objectMapper.createObjectNode();
    }
  }

  private String writeJson(JsonNode node) {
    try {
      return objectMapper.writeValueAsString(node);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to serialize llm trigger json", exception);
    }
  }

  private String text(JsonNode node, String field, String fallback) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return fallback;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private String formatDisplayValue(JsonNode node) {
    if (node == null || node.isNull()) {
      return "";
    }
    if (node.isTextual()) {
      return node.asText();
    }
    return node.toString();
  }

  private String defaultUserPrompt() {
    return "请根据当前题目和已填写答案，为配置的目标字段生成合法候选值。";
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isBlank() ? null : trimmed;
  }

  private String truncateForContext(String value) {
    return truncate(value, MAX_CONTEXT_TEXT_LENGTH);
  }

  private String truncate(String value, int maxLength) {
    if (value == null) {
      return null;
    }
    return value.length() <= maxLength ? value : value.substring(0, maxLength) + "...";
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private boolean isDeadlineExpired(LocalDateTime deadline) {
    return deadline != null && deadline.isBefore(LocalDateTime.now());
  }

  private String trimTrailingSlash(String value) {
    if (value == null) {
      return "";
    }
    String result = value.trim();
    while (result.endsWith("/") && result.length() > "https://".length()) {
      result = result.substring(0, result.length() - 1);
    }
    return result;
  }

  private record LlmTriggerContext(
      String triggerFieldName,
      String taskTitle,
      JsonNode triggerField,
      List<TargetFieldContext> targetFields,
      String taskInstruction,
      String promptTemplate,
      String outputInstruction,
      List<String> contextPaths,
      JsonNode rawPayload,
      JsonNode currentAnswerJson,
      ArrayNode fields) {}

  private record TargetFieldContext(
      String fieldName,
      JsonNode field,
      String semanticType) {}
}
