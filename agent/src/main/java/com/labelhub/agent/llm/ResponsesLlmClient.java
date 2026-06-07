package com.labelhub.agent.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.agent.client.BackendClient;
import com.labelhub.agent.config.AgentProperties;
import com.labelhub.agent.model.AiReviewJobClaimResponse;
import com.labelhub.agent.model.AiReviewLlmResult;
import com.labelhub.agent.model.AiModelRuntimeConfig;
import com.labelhub.agent.parser.AiReviewOutputParser;
import com.labelhub.agent.prompt.PromptTemplateLoader;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestClient;

@Component
public class ResponsesLlmClient {

  private static final Logger log = LoggerFactory.getLogger(ResponsesLlmClient.class);

  private final BackendClient backendClient;
  private final AgentProperties properties;
  private final ObjectMapper objectMapper;
  private final AiReviewOutputParser outputParser;
  private final PromptTemplateLoader promptTemplateLoader;

  public ResponsesLlmClient(
      BackendClient backendClient,
      AgentProperties properties,
      ObjectMapper objectMapper,
      AiReviewOutputParser outputParser,
      PromptTemplateLoader promptTemplateLoader) {
    this.backendClient = backendClient;
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.outputParser = outputParser;
    this.promptTemplateLoader = promptTemplateLoader;
  }

  public AiReviewLlmResult review(AiReviewJobClaimResponse job) {
    RuntimeConfig runtimeConfig = resolveRuntimeConfig();
    if (runtimeConfig.apiKey() == null || runtimeConfig.apiKey().isBlank()) {
      throw new IllegalStateException("LABELHUB_LLM_API_KEY is required");
    }
    if (!"responses".equalsIgnoreCase(runtimeConfig.wireApi())) {
      throw new IllegalStateException("Only Responses API wire mode is supported in this worker");
    }
    String prompt = buildPrompt(job);
    ObjectNode request = buildResponsesRequest(prompt, job.ruleSnapshot(), runtimeConfig);
    Instant start = Instant.now();
    JsonNode response = buildLlmClient(runtimeConfig).post()
        .uri(resolveResponsesUrl(runtimeConfig))
        .body(request)
        .retrieve()
        .body(JsonNode.class);
    long latencyMs = Duration.between(start, Instant.now()).toMillis();
    return outputParser.parse(
        response == null ? objectMapper.createObjectNode() : response,
        latencyMs,
        runtimeConfig.model());
  }

  private RuntimeConfig resolveRuntimeConfig() {
    try {
      AiModelRuntimeConfig config = backendClient.getModelRuntimeConfig();
      if (config != null && hasText(config.apiKey()) && hasText(config.apiBaseUrl()) && hasText(config.modelName())) {
        return new RuntimeConfig(
            trimTrailingSlash(config.apiBaseUrl()),
            config.useFullUrl(),
            config.modelName(),
            hasText(config.reasoningEffort()) ? config.reasoningEffort() : properties.getLlm().getReasoningEffort(),
            hasText(config.wireApi()) ? config.wireApi() : properties.getLlm().getWireApi(),
            config.apiKey());
      }
      throw new IllegalStateException("Backend model runtime config is incomplete");
    } catch (RestClientResponseException exception) {
      if (exception.getStatusCode().value() == 404) {
        return fallbackRuntimeConfig();
      }
      throw exception;
    } catch (Exception exception) {
      if (exception instanceof RuntimeException runtimeException) {
        throw runtimeException;
      }
      throw new IllegalStateException("Backend model runtime config unavailable", exception);
    }
  }

  private RuntimeConfig fallbackRuntimeConfig() {
    log.info("No active backend model runtime config, falling back to LABELHUB_LLM_*");
    return new RuntimeConfig(
        trimTrailingSlash(properties.getLlm().getBaseUrl()),
        false,
        properties.getLlm().getModel(),
        properties.getLlm().getReasoningEffort(),
        properties.getLlm().getWireApi(),
        properties.getLlm().getApiKey());
  }

  private RestClient buildLlmClient(RuntimeConfig runtimeConfig) {
    SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
    requestFactory.setConnectTimeout(Duration.ofSeconds(10));
    requestFactory.setReadTimeout(Duration.ofMillis(properties.getLlm().getTimeoutMs()));
    return RestClient.builder()
        .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + runtimeConfig.apiKey())
        .requestFactory(requestFactory)
        .build();
  }

  private String resolveResponsesUrl(RuntimeConfig runtimeConfig) {
    if (runtimeConfig.useFullUrl()) {
      return runtimeConfig.apiBaseUrl();
    }
    return trimTrailingSlash(runtimeConfig.apiBaseUrl()) + "/responses";
  }

  private ObjectNode buildResponsesRequest(String prompt, JsonNode ruleSnapshot, RuntimeConfig runtimeConfig) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("model", runtimeConfig.model());
    ObjectNode reasoning = root.putObject("reasoning");
    reasoning.put("effort", runtimeConfig.reasoningEffort());
    root.put("input", prompt);
    ObjectNode text = root.putObject("text");
    ObjectNode format = text.putObject("format");
    format.put("type", "json_schema");
    format.put("name", "labelhub_ai_review_result");
    format.put("strict", true);
    format.set("schema", buildOutputSchema(ruleSnapshot));
    return root;
  }

  private ObjectNode buildOutputSchema(JsonNode ruleSnapshot) {
    ObjectNode schema = objectMapper.createObjectNode();
    schema.put("type", "object");
    ObjectNode propertiesNode = schema.putObject("properties");
    ObjectNode scores = propertiesNode.putObject("scores");
    scores.put("type", "object");
    ObjectNode scoreProperties = scores.putObject("properties");
    ArrayNode scoreRequired = scores.putArray("required");
    JsonNode dimensions = ruleSnapshot.path("dimensions");
    if (dimensions.isArray()) {
      for (JsonNode dimension : dimensions) {
        String key = dimension.path("key").asText("");
        if (key.isBlank()) {
          continue;
        }
        ObjectNode scoreSchema = scoreProperties.putObject(key);
        scoreSchema.put("type", "number");
        scoreSchema.put("minimum", 0);
        scoreSchema.put("maximum", 100);
        scoreRequired.add(key);
      }
    }
    scores.put("additionalProperties", false);
    ObjectNode totalScore = propertiesNode.putObject("totalScore");
    totalScore.put("type", "number");
    totalScore.put("minimum", 0);
    totalScore.put("maximum", 100);
    ObjectNode decision = propertiesNode.putObject("decision");
    decision.put("type", "string");
    ArrayNode enums = decision.putArray("enum");
    enums.add("PASS");
    enums.add("REJECT");
    enums.add("NEED_HUMAN_REVIEW");
    propertiesNode.putObject("comment").put("type", "string");
    arrayOfString(propertiesNode.putObject("riskFlags"));
    arrayOfString(propertiesNode.putObject("evidence"));
    ArrayNode required = schema.putArray("required");
    required.add("scores");
    required.add("totalScore");
    required.add("decision");
    required.add("comment");
    required.add("riskFlags");
    required.add("evidence");
    schema.put("additionalProperties", false);
    return schema;
  }

  private void arrayOfString(ObjectNode node) {
    node.put("type", "array");
    node.putObject("items").put("type", "string");
  }

  private String buildPrompt(AiReviewJobClaimResponse job) {
    String rulePrompt = job.ruleSnapshot().path("promptTemplate").asText("");
    String template = hasText(rulePrompt)
        ? rulePrompt
        : promptTemplateLoader.loadOrDefault("ai-review-default.md", defaultPrompt());
    String scoringInstructions = promptTemplateLoader.loadOrDefault(
        "ai-review-scoring-instructions.md",
        defaultScoringInstructions());
    return template
        .replace("{{taskTitle}}", safe(job.taskTitle()))
        .replace("{{rawPayload}}", pretty(job.rawPayload()))
        .replace("{{answer}}", pretty(job.answerJson()))
        .replace("{{schema}}", pretty(job.schemaSnapshot()))
        .replace("{{rule}}", pretty(job.ruleSnapshot()))
        + "\n\n"
        + scoringInstructions;
  }

  private String defaultPrompt() {
    return """
        你是 LabelHub 的 AI 预审员。你的任务是审核“标注员提交的标注答案”是否正确、完整、合规，
        而不是单独评价题目原始数据或模型回答本身的质量。

        请根据题目原始数据、标注答案、表单 schema 和评分规则，按 0~100 分给出每个维度的分数、总分、风险标签、证据和最终判定。

        comment 需要解释标注答案的主要问题或通过原因。

        当前任务：
        - taskTitle: {{taskTitle}}

        题目原始数据：
        {{rawPayload}}

        标注员答案：
        {{answer}}

        表单 schema：
        {{schema}}

        评分规则：
        {{rule}}
        """;
  }

  private String defaultScoringInstructions() {
    return """
        评分口径：
        - 评分对象必须是标注员提交的标注答案质量，不是原始数据或模型回答本身质量。
        - 每个维度按 `rule.dimensions[].maxScore` 计分；当前默认每项满分 100 分。
        - `totalScore` 必须是按 `weight` 加权后的 0~100 综合分。
        - `decision` 必须与阈值一致：`totalScore >= rule.passThreshold` 时输出 `PASS`；`rule.needHumanThreshold <= totalScore < rule.passThreshold` 时输出 `NEED_HUMAN_REVIEW`；`totalScore < rule.needHumanThreshold` 时输出 `REJECT`。
        - 如果标注员误判、漏标、错选或理由不足，应降低相关维度分数。
        - 禁止出现高分但 `REJECT`，或低分但 `PASS` 的矛盾输出。

        请只输出符合 JSON Schema 的 JSON，不要输出 Markdown。
        """;
  }

  private String pretty(JsonNode node) {
    try {
      return objectMapper.writerWithDefaultPrettyPrinter()
          .writeValueAsString(node == null ? objectMapper.nullNode() : node);
    } catch (Exception exception) {
      return String.valueOf(node);
    }
  }

  private String safe(String value) {
    return value == null ? "" : value;
  }

  private boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private String trimTrailingSlash(String value) {
    if (value == null || value.isBlank()) {
      return "";
    }
    String result = value.trim();
    while (result.endsWith("/") && result.length() > "https://".length()) {
      result = result.substring(0, result.length() - 1);
    }
    return result;
  }

  private record RuntimeConfig(
      String apiBaseUrl,
      boolean useFullUrl,
      String model,
      String reasoningEffort,
      String wireApi,
      String apiKey) {}
}
