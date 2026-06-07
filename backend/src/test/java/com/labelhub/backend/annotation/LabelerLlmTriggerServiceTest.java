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
import java.util.List;
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
    assertThat(result.path("normalizedDisplayValue").asText()).isEqualTo("通过");
    assertThat(result.path("results").get(0).path("normalizedDisplayValue").asText()).isEqualTo("通过");
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

  @Test
  void normalizeModelOutputShouldReturnResultsForMultipleTargetFields() {
    Object context = invokeResolveContext(
        assignmentWithMultipleTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("quality", "reason", "keywords"),
            objectMapper.createObjectNode()));

    ObjectNode result = invokeNormalizeModelOutput(
        """
        {
          "displayText": "建议通过并补充原因",
          "results": [
            { "targetFieldName": "quality", "displayText": "选择通过", "value": "通过" },
            { "targetFieldName": "reason", "displayText": "理由", "value": "回答完整且格式正确" },
            { "targetFieldName": "keywords", "displayText": "标签", "value": ["完整", "格式正确"] }
          ]
        }
        """,
        context);

    assertThat(result.path("displayText").asText()).isEqualTo("建议通过并补充原因");
    assertThat(result.path("results")).hasSize(3);
    assertThat(result.path("results").get(0).path("targetFieldName").asText()).isEqualTo("quality");
    assertThat(result.path("results").get(0).path("normalizedValue").asText()).isEqualTo("pass");
    assertThat(result.path("results").get(0).path("normalizedDisplayValue").asText()).isEqualTo("通过");
    assertThat(result.path("results").get(1).path("normalizedValue").asText()).isEqualTo("回答完整且格式正确");
    assertThat(result.path("results").get(2).path("normalizedValue")).hasSize(2);
    assertThat(result.path("results").get(2).path("normalizedDisplayValue").asText()).isEqualTo("完整、格式正确");
    assertThat(result.has("normalizedValue")).isFalse();
  }

  @Test
  void buildUserPromptShouldIncludeTaskInstructionAndOutputInstruction() {
    Object context = invokeResolveContext(
        assignmentWithSemanticInstructions(),
        new LlmTriggerRequest("ai_helper", "quality", objectMapper.createObjectNode()));

    String prompt = invokeBuildUserPrompt(context);

    assertThat(prompt).contains("偏好评测任务");
    assertThat(prompt).contains("建议文案必须使用通过或不通过");
    assertThat(prompt).contains("\"value\":\"pass\"");
    assertThat(prompt).contains("\"label\":\"通过\"");
  }

  @Test
  void buildUserPromptShouldIncludeReactionRules() {
    Object context = invokeResolveContext(
        assignmentWithConditionalTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("choice_1", "note_1"),
            objectMapper.createObjectNode()));

    String prompt = invokeBuildUserPrompt(context);

    assertThat(prompt).contains("reactionRules");
    assertThat(prompt).contains("choice_1");
    assertThat(prompt).contains("note_1");
    assertThat(prompt).contains("visibleRequired");
    assertThat(prompt).contains("\"value\":\"option_b\"");
    assertThat(prompt).contains("\"valueLabel\":\"B\"");
  }

  @Test
  void normalizeModelOutputShouldRejectMissingTargetResultForMultipleFields() {
    Object context = invokeResolveContext(
        assignmentWithMultipleTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("quality", "reason"),
            objectMapper.createObjectNode()));

    assertThatThrownBy(() -> invokeNormalizeModelOutput(
        """
        {
          "displayText": "只返回一个字段",
          "results": [
            { "targetFieldName": "quality", "value": "pass" }
          ]
        }
        """,
        context))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("INVALID_LLM_TRIGGER_RESULT");
  }

  @Test
  void normalizeModelOutputShouldFilterHiddenConditionalTarget() {
    Object context = invokeResolveContext(
        assignmentWithConditionalTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("choice_1", "note_1"),
            objectMapper.createObjectNode()));

    ObjectNode result = invokeNormalizeModelOutput(
        """
        {
          "displayText": "建议选择 A",
          "results": [
            { "targetFieldName": "choice_1", "displayText": "选择 A", "value": "A" },
            { "targetFieldName": "note_1", "displayText": "理由", "value": "A 不需要理由" }
          ]
        }
        """,
        context);

    assertThat(result.path("results")).hasSize(1);
    assertThat(result.path("results").get(0).path("targetFieldName").asText()).isEqualTo("choice_1");
    assertThat(result.path("results").get(0).path("normalizedValue").asText()).isEqualTo("option_a");
  }

  @Test
  void normalizeModelOutputShouldKeepVisibleConditionalTarget() {
    Object context = invokeResolveContext(
        assignmentWithConditionalTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("choice_1", "note_1"),
            objectMapper.createObjectNode()));

    ObjectNode result = invokeNormalizeModelOutput(
        """
        {
          "displayText": "建议选择 B 并填写理由",
          "results": [
            { "targetFieldName": "choice_1", "displayText": "选择 B", "value": "B" },
            { "targetFieldName": "note_1", "displayText": "理由", "value": "B 覆盖更完整" }
          ]
        }
        """,
        context);

    assertThat(result.path("results")).hasSize(2);
    assertThat(result.path("results").get(0).path("normalizedValue").asText()).isEqualTo("option_b");
    assertThat(result.path("results").get(1).path("targetFieldName").asText()).isEqualTo("note_1");
    assertThat(result.path("results").get(1).path("normalizedValue").asText()).isEqualTo("B 覆盖更完整");
  }

  @Test
  void normalizeModelOutputShouldRejectMissingVisibleConditionalTarget() {
    Object context = invokeResolveContext(
        assignmentWithConditionalTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("choice_1", "note_1"),
            objectMapper.createObjectNode()));

    assertThatThrownBy(() -> invokeNormalizeModelOutput(
        """
        {
          "displayText": "建议选择 B",
          "results": [
            { "targetFieldName": "choice_1", "displayText": "选择 B", "value": "B" }
          ]
        }
        """,
        context))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("INVALID_LLM_TRIGGER_RESULT");
  }

  @Test
  void normalizeModelOutputShouldAllowCurrentAnswerToShowConditionalTarget() {
    ObjectNode currentAnswer = objectMapper.createObjectNode().put("choice_1", "option_b");
    Object context = invokeResolveContext(
        assignmentWithConditionalTargets(),
        new LlmTriggerRequest(
            "ai_helper",
            null,
            List.of("note_1"),
            currentAnswer));

    ObjectNode result = invokeNormalizeModelOutput(
        """
        {
          "displayText": "补充理由",
          "results": [
            { "targetFieldName": "note_1", "displayText": "理由", "value": "当前已选择 B，需要说明原因" }
          ]
        }
        """,
        context);

    assertThat(result.path("results")).hasSize(1);
    assertThat(result.path("results").get(0).path("targetFieldName").asText()).isEqualTo("note_1");
    assertThat(result.path("results").get(0).path("normalizedValue").asText()).isEqualTo("当前已选择 B，需要说明原因");
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

  private String invokeBuildUserPrompt(Object context) {
    try {
      Method method = LabelerLlmTriggerService.class.getDeclaredMethod(
          "buildUserPrompt",
          context.getClass());
      method.setAccessible(true);
      return (String) method.invoke(service, context);
    } catch (ReflectiveOperationException exception) {
      Throwable cause = exception.getCause();
      if (cause instanceof RuntimeException runtimeException) {
        throw runtimeException;
      }
      throw new AssertionError("failed to invoke buildUserPrompt", exception);
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

  private AssignmentItemRecord assignmentWithMultipleTargets() {
    return assignmentWithSchema("""
        {
          "fields": [
            {
              "id": "f1",
              "kind": "llm-trigger",
              "fieldName": "ai_helper",
              "label": "AI 帮助",
              "componentProps": {
                "targetFields": ["quality", "reason", "keywords"],
                "promptTemplate": "请同时给出审核结论、原因和标签",
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
            },
            {
              "id": "f3",
              "kind": "text-multi",
              "fieldName": "reason",
              "label": "理由"
            },
            {
              "id": "f4",
              "kind": "tags",
              "fieldName": "keywords",
              "label": "标签",
              "options": [
                { "value": "complete", "label": "完整" },
                { "value": "format_ok", "label": "格式正确" }
              ]
            }
          ]
        }
        """);
  }

  private AssignmentItemRecord assignmentWithConditionalTargets() {
    return assignmentWithSchema("""
        {
          "fields": [
            {
              "id": "f1",
              "kind": "llm-trigger",
              "fieldName": "ai_helper",
              "label": "AI 帮助",
              "componentProps": {
                "targetFields": ["choice_1", "note_1"],
                "promptTemplate": "请根据题目选择 A 或 B，必要时填写理由",
                "contextPaths": ["prompt"]
              }
            },
            {
              "id": "f2",
              "kind": "single-choice",
              "fieldName": "choice_1",
              "label": "单选",
              "options": [
                { "value": "option_a", "label": "A" },
                { "value": "option_b", "label": "B" }
              ],
              "reactions": [
                {
                  "sourceField": "choice_1",
                  "operator": "eq",
                  "value": "option_b",
                  "targetField": "note_1",
                  "action": "visibleRequired"
                }
              ]
            },
            {
              "id": "f3",
              "kind": "text-multi",
              "fieldName": "note_1",
              "label": "理由"
            }
          ]
        }
        """);
  }

  private AssignmentItemRecord assignmentWithSemanticInstructions() {
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
                "taskInstruction": "这是偏好评测任务，PREFERRED=A 表示 A 优于 B，但目标字段要判断是否通过。",
                "promptTemplate": "请根据任务语义判断是否通过",
                "outputInstruction": "建议文案必须使用通过或不通过，不要展示 option_a。",
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
