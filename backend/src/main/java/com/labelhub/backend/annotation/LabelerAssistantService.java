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
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@Service
public class LabelerAssistantService {

  private static final int MAX_QUESTION_LENGTH = 500;
  private static final int MAX_HISTORY_ITEMS = 8;
  private static final int MAX_HISTORY_CONTENT_LENGTH = 1000;
  private static final int MAX_CONTEXT_TEXT_LENGTH = 6000;
  private static final int MAX_PREVIEW_LENGTH = 240;

  private final AnnotationRepository annotationRepository;
  private final AiModelConfigRepository modelConfigRepository;
  private final AiModelConfigCrypto crypto;
  private final AuditLogRepository auditLogRepository;
  private final TaskDeadlineSettlementService deadlineSettlementService;
  private final ObjectMapper objectMapper;
  private final PromptTemplateLoader promptTemplateLoader;

  public LabelerAssistantService(
      AnnotationRepository annotationRepository,
      AiModelConfigRepository modelConfigRepository,
      AiModelConfigCrypto crypto,
      AuditLogRepository auditLogRepository,
      TaskDeadlineSettlementService deadlineSettlementService,
      ObjectMapper objectMapper,
      PromptTemplateLoader promptTemplateLoader) {
    this.annotationRepository = annotationRepository;
    this.modelConfigRepository = modelConfigRepository;
    this.crypto = crypto;
    this.auditLogRepository = auditLogRepository;
    this.deadlineSettlementService = deadlineSettlementService;
    this.objectMapper = objectMapper;
    this.promptTemplateLoader = promptTemplateLoader;
  }

  public StreamingResponseBody stream(
      Authentication authentication,
      long assignmentId,
      AssistantAskRequest request) {
    AuthenticatedUser labeler = requireLabeler(authentication);
    deadlineSettlementService.settleExpiredTasks();
    AssignmentItemRecord assignment = annotationRepository.findAssignmentForLabeler(assignmentId, labeler.id())
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "ASSIGNMENT_NOT_FOUND",
            "assignment not found"));
    ensureAssistantAllowed(assignment);
    String question = normalizeQuestion(request == null ? null : request.question());
    List<AssistantMessageRequest> history = normalizeHistory(request == null ? null : request.history());
    AiModelConfigRepository.AiModelConfigRecord config;
    String apiKey;
    try {
      config = modelConfigRepository.findActive()
          .orElseThrow(() -> new ApiException(
              HttpStatus.CONFLICT,
              "LLM_ASSIST_MODEL_CONFIG_REQUIRED",
              "active model config is required"));
      apiKey = crypto.decrypt(config.encryptedApiKey());
    } catch (ApiException exception) {
      auditAssistantCall(labeler, assignment, null, question, null, null, "failed", exception.getMessage());
      throw exception;
    }
    ObjectNode payload = buildChatCompletionPayload(config, assignment, question, history);
    return outputStream -> streamChatCompletion(outputStream, labeler, assignment, config, apiKey, question, payload);
  }

  private void ensureAssistantAllowed(AssignmentItemRecord assignment) {
    if (assignment.taskDeletedAt() != null) {
      throw new ApiException(HttpStatus.CONFLICT, "TASK_DELETED", "task has been deleted");
    }
    if ("voided".equals(normalize(assignment.assignmentStatus()))) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_VOIDED", "assignment has been voided");
    }
    if (!readMetadataLlmAssistEnabled(assignment.rewardRuleJson())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "LLM_ASSIST_DISABLED", "llm assistant is disabled for this task");
    }
    if (!isEditableAssignment(assignment)) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_NOT_EDITABLE", "assignment is not editable");
    }
  }

  private boolean isEditableAssignment(AssignmentItemRecord assignment) {
    String status = normalize(assignment.assignmentStatus());
    if ("returned".equals(status)) {
      return assignment.resubmitDeadline() != null && assignment.resubmitDeadline().isAfter(LocalDateTime.now());
    }
    return List.of("claimed", "submitted").contains(status)
        && "published".equals(normalize(assignment.taskStatus()))
        && !isDeadlineExpired(assignment.taskDeadline());
  }

  private boolean isDeadlineExpired(LocalDateTime deadline) {
    return deadline != null && deadline.isBefore(LocalDateTime.now());
  }

  private String normalizeQuestion(String value) {
    String question = value == null ? "" : value.trim();
    if (question.isBlank() || question.length() > MAX_QUESTION_LENGTH) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_ASSISTANT_QUESTION",
          "assistant question must be 1-500 characters");
    }
    return question;
  }

  private List<AssistantMessageRequest> normalizeHistory(List<AssistantMessageRequest> history) {
    if (history == null || history.isEmpty()) {
      return List.of();
    }
    int from = Math.max(0, history.size() - MAX_HISTORY_ITEMS);
    List<AssistantMessageRequest> normalized = new ArrayList<>();
    for (AssistantMessageRequest item : history.subList(from, history.size())) {
      if (item == null) {
        continue;
      }
      String role = normalizeRole(item.role());
      String content = truncate(trimToNull(item.content()), MAX_HISTORY_CONTENT_LENGTH);
      if (role != null && content != null) {
        normalized.add(new AssistantMessageRequest(role, content));
      }
    }
    return normalized;
  }

  private ObjectNode buildChatCompletionPayload(
      AiModelConfigRepository.AiModelConfigRecord config,
      AssignmentItemRecord assignment,
      String question,
      List<AssistantMessageRequest> history) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("model", config.modelName());
    ArrayNode messages = root.putArray("messages");
    messages.add(message("system", buildSystemPrompt(assignment)));
    for (AssistantMessageRequest item : history) {
      messages.add(message(item.role(), item.content()));
    }
    messages.add(message("user", question));
    root.put("temperature", 0.2);
    root.put("stream", true);
    return root;
  }

  private ObjectNode message(String role, String content) {
    ObjectNode message = objectMapper.createObjectNode();
    message.put("role", role);
    message.put("content", content);
    return message;
  }

  private String buildSystemPrompt(AssignmentItemRecord assignment) {
    String template = promptTemplateLoader.loadOrDefault("labeler-assistant-system.md", defaultSystemPrompt());
    return template
        .replace("{{taskId}}", String.valueOf(assignment.taskId()))
        .replace("{{taskTitle}}", blankToDefault(assignment.taskTitle(), "标注任务"))
        .replace("{{itemId}}", String.valueOf(assignment.itemId()))
        .replace("{{mediaType}}", blankToDefault(assignment.mediaType(), "text"))
        .replace("{{rawPayloadSummary}}", truncateForContext(buildRawPayloadSummary(assignment)))
        .replace("{{fieldsSummary}}", truncateForContext(buildFieldsSummary(assignment)));
  }

  private String defaultSystemPrompt() {
    return """
        你是 LabelHub 的标注员标注助手。你只能帮助标注员理解题目、Schema 字段和判断思路。
        禁止直接替标注员生成可提交的最终答案,禁止要求系统自动写入答案字段。
        回答必须简洁、可操作,并明确这是参考建议。

        当前任务:
        - taskId: {{taskId}}
        - taskTitle: {{taskTitle}}
        - itemId: {{itemId}}
        - mediaType: {{mediaType}}

        原题数据与多模态文本:
        {{rawPayloadSummary}}

        表单字段:
        {{fieldsSummary}}
        """;
  }

  private String buildRawPayloadSummary(AssignmentItemRecord assignment) {
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
    return writeJson(node);
  }

  private String buildFieldsSummary(AssignmentItemRecord assignment) {
    Long schemaId = readMetadataSchemaVersionId(assignment.rewardRuleJson());
    if (schemaId == null && assignment.fallbackSchemaVersionId() != null) {
      schemaId = assignment.fallbackSchemaVersionId();
    }
    if (schemaId == null) {
      return "[]";
    }
    return annotationRepository.findSchema(schemaId)
        .map(schema -> {
          JsonNode schemaJson = readJson(schema.schemaJson());
          JsonNode fields = schemaJson.path("fields");
          return fields.isMissingNode() ? "[]" : writeJson(fields);
        })
        .orElse("[]");
  }

  private void streamChatCompletion(
      OutputStream outputStream,
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      AiModelConfigRepository.AiModelConfigRecord config,
      String apiKey,
      String question,
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
        safeAuditAssistantCall(labeler, assignment, config.modelName(), question, null, null, "failed", errorBody);
        sendEvent(writer, "error", "LLM_ASSIST_REQUEST_FAILED");
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
        safeAuditAssistantCall(labeler, assignment, config.modelName(), question, null, null, "failed", "empty stream answer");
        sendEvent(writer, "error", "LLM_ASSIST_REQUEST_FAILED");
        return;
      }
      safeAuditAssistantCall(labeler, assignment, config.modelName(), question, answer.toString(), null, "success", null);
      sendEvent(writer, "done", "DONE");
    } catch (IOException | InterruptedException | RuntimeException exception) {
      if (exception instanceof InterruptedException) {
        Thread.currentThread().interrupt();
      }
      if (isClientDisconnect(exception)) {
        safeAuditAssistantCall(
            labeler,
            assignment,
            config.modelName(),
            question,
            answer.isEmpty() ? null : answer.toString(),
            null,
            "cancelled",
            exception.getMessage());
        return;
      }
      safeAuditAssistantCall(labeler, assignment, config.modelName(), question, answer.isEmpty() ? null : answer.toString(), null, "failed", exception.getMessage());
      safeSendEvent(writer, "error", "LLM_ASSIST_REQUEST_FAILED");
    }
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

  private String extractStreamDelta(String data) {
    JsonNode root = readJson(data);
    JsonNode delta = root.path("choices").path(0).path("delta").path("content");
    if (delta.isTextual()) {
      return delta.asText();
    }
    JsonNode messageContent = root.path("choices").path(0).path("message").path("content");
    return messageContent.isTextual() ? messageContent.asText() : null;
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
      // SSE 响应可能已被浏览器主动关闭,此时不能再把异常抛给 Spring 错误页。
    }
  }

  private void auditAssistantCall(
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      String modelName,
      String question,
      String answer,
      Integer tokensUsed,
      String status,
      String error) {
    ObjectNode snapshot = objectMapper.createObjectNode();
    snapshot.put("taskId", assignment.taskId());
    snapshot.put("itemId", assignment.itemId());
    snapshot.put("questionPreview", truncate(question, MAX_PREVIEW_LENGTH));
    if (answer != null) {
      snapshot.put("answerPreview", truncate(answer, MAX_PREVIEW_LENGTH));
    }
    if (tokensUsed != null) {
      snapshot.put("tokensUsed", tokensUsed);
    }
    snapshot.put("modelName", blankToDefault(modelName, ""));
    snapshot.put("status", status);
    if (error != null && !error.isBlank()) {
      snapshot.put("errorPreview", truncate(error, MAX_PREVIEW_LENGTH));
    }
    auditLogRepository.insert(
        WorkflowEntityType.ASSIGNMENT,
        assignment.assignmentId(),
        labeler.id(),
        "labeler",
        "labeler_assistant.ask",
        null,
        null,
        "llm assistant " + status,
        null,
        null,
        writeAuditSnapshot(assignment.assignmentId(), snapshot));
  }

  private void safeAuditAssistantCall(
      AuthenticatedUser labeler,
      AssignmentItemRecord assignment,
      String modelName,
      String question,
      String answer,
      Integer tokensUsed,
      String status,
      String error) {
    try {
      auditAssistantCall(labeler, assignment, modelName, question, answer, tokensUsed, status, error);
    } catch (RuntimeException exception) {
      // 审计失败不能影响已经开始的 SSE 响应,否则会触发 response committed 错误页。
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

  private String writeAuditSnapshot(long assignmentId, JsonNode snapshot) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("entityType", WorkflowEntityType.ASSIGNMENT.value());
    root.put("entityId", assignmentId);
    root.put("action", "labeler_assistant.ask");
    root.put("operatorRole", "labeler");
    root.set("snapshot", snapshot);
    return writeJson(root);
  }

  private boolean readMetadataLlmAssistEnabled(String rewardRuleJson) {
    if (rewardRuleJson == null || rewardRuleJson.isBlank()) {
      return false;
    }
    JsonNode root = readJson(rewardRuleJson);
    JsonNode value = root.path("llmAssistEnabled");
    return !value.isMissingNode() && !value.isNull() && value.asBoolean(false);
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

  private AuthenticatedUser requireLabeler(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    if (!principal.roles().contains("labeler")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "labeler role is required");
    }
    return principal;
  }

  private String normalizeRole(String role) {
    String normalized = role == null ? "" : role.trim().toLowerCase(Locale.ROOT);
    return List.of("user", "assistant").contains(normalized) ? normalized : null;
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
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
      throw new IllegalStateException("failed to serialize assistant json", exception);
    }
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

  private String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isBlank() ? null : trimmed;
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

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

}
