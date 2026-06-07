package com.labelhub.backend.annotation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.ai.AiModelConfigCrypto;
import com.labelhub.backend.ai.AiModelConfigRepository;
import com.labelhub.backend.annotation.AnnotationRepository.AssignmentItemRecord;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.prompt.PromptTemplateLoader;
import com.labelhub.backend.task.TaskDeadlineSettlementService;
import com.labelhub.backend.workflow.AuditLogRepository;
import java.lang.reflect.Method;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LabelerLlmTriggerServiceTest {

  private final ObjectMapper objectMapper = new ObjectMapper();
  private LabelerLlmTriggerService service;

  @BeforeEach
  void setUp() {
    service = new LabelerLlmTriggerService(
        mock(AnnotationRepository.class),
        mock(AiModelConfigRepository.class),
        mock(AiModelConfigCrypto.class),
        mock(AuditLogRepository.class),
        mock(TaskDeadlineSettlementService.class),
        new PromptTemplateLoader("agent/prompts"),
        objectMapper);
  }

  @Test
  void resolveContextShouldRejectTargetThatDoesNotMatchTriggerConfiguration() {
    AssignmentItemRecord assignment = assignmentWithSchema("""
        {
          "fields": [
            {
              "id": "f1",
              "kind": "llm-trigger",
              "fieldName": "ai_helper",
              "label": "AI 帮助",
              "componentProps": { "targetField": "quality" }
            },
            {
              "id": "f2",
              "kind": "single-choice",
              "fieldName": "quality",
              "label": "质量",
              "options": [{ "value": "pass", "label": "通过" }]
            },
            {
              "id": "f3",
              "kind": "text-single",
              "fieldName": "reason",
              "label": "原因"
            }
          ]
        }
        """);

    assertThatThrownBy(() -> invokeResolveContext(
        assignment,
        new LlmTriggerRequest("ai_helper", "reason", objectMapper.createObjectNode())))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("INVALID_LLM_TARGET_FIELD");
  }

  @Test
  void normalizeModelOutputShouldUseOptionValueForSingleChoiceLabel() {
    Object context = invokeResolveContext(
        assignmentWithChoiceTarget(),
        new LlmTriggerRequest("ai_helper", "quality", objectMapper.createObjectNode()));

    ObjectNode result = invokeNormalizeModelOutput(
        """
        { "displayText": "建议选择通过", "value": "通过" }
        """,
        context);

    assertThat(result.path("displayText").asText()).isEqualTo("建议选择通过");
    assertThat(result.path("targetFieldName").asText()).isEqualTo("quality");
    assertThat(result.path("normalizedValue").asText()).isEqualTo("pass");
  }

  @Test
  void normalizeModelOutputShouldRejectUnknownChoiceValue() {
    Object context = invokeResolveContext(
        assignmentWithChoiceTarget(),
        new LlmTriggerRequest("ai_helper", "quality", objectMapper.createObjectNode()));

    assertThatThrownBy(() -> invokeNormalizeModelOutput(
        """
        { "displayText": "建议选择未知", "value": "未知选项" }
        """,
        context))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("INVALID_LLM_TRIGGER_RESULT");
  }

  private Object invokeResolveContext(AssignmentItemRecord assignment, LlmTriggerRequest request) {
    try {
      Method method = LabelerLlmTriggerService.class.getDeclaredMethod(
          "resolveContext",
          AssignmentItemRecord.class,
          LlmTriggerRequest.class);
      method.setAccessible(true);
      return method.invoke(service, assignment, request);
    } catch (ReflectiveOperationException exception) {
      Throwable cause = exception.getCause();
      if (cause instanceof RuntimeException runtimeException) {
        throw runtimeException;
      }
      throw new AssertionError("failed to invoke resolveContext", exception);
    }
  }

  private ObjectNode invokeNormalizeModelOutput(String raw, Object context) {
    try {
      Method method = LabelerLlmTriggerService.class.getDeclaredMethod(
          "normalizeModelOutput",
          String.class,
          context.getClass());
      method.setAccessible(true);
      return (ObjectNode) method.invoke(service, raw, context);
    } catch (ReflectiveOperationException exception) {
      Throwable cause = exception.getCause();
      if (cause instanceof RuntimeException runtimeException) {
        throw runtimeException;
      }
      throw new AssertionError("failed to invoke normalizeModelOutput", exception);
    }
  }

  private AssignmentItemRecord assignmentWithChoiceTarget() {
    return assignmentWithSchema("""
        {
          "fields": [
            {
              "id": "f1",
              "kind": "llm-trigger",
              "fieldName": "ai_helper",
              "label": "AI 帮助",
              "componentProps": {
                "targetField": "quality",
                "promptTemplate": "请判断是否通过",
                "contextPaths": ["prompt"]
              }
            },
            {
              "id": "f2",
              "kind": "single-choice",
              "fieldName": "quality",
              "label": "质量",
              "options": [
                { "value": "pass", "label": "通过" },
                { "value": "fail", "label": "不通过" }
              ]
            }
          ]
        }
        """);
  }

  private AssignmentItemRecord assignmentWithSchema(String schemaJson) {
    JsonNode rawPayload = objectMapper.createObjectNode().put("prompt", "请判断回答是否合规");
    return new AssignmentItemRecord(
        101L,
        201L,
        301L,
        401L,
        "claimed",
        null,
        "测试任务",
        "published",
        LocalDateTime.now().plusDays(1),
        null,
        "{}",
        "available",
        rawPayload.toString(),
        "text",
        null,
        null,
        1L,
        1,
        schemaJson,
        "published",
        null);
  }
}
