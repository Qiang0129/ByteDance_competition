package com.labelhub.agent.parser;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.agent.model.AiReviewLlmResult;
import java.util.Iterator;
import org.springframework.stereotype.Component;

@Component
public class AiReviewOutputParser {

  private final ObjectMapper objectMapper;

  public AiReviewOutputParser(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public AiReviewLlmResult parse(JsonNode responseJson, long latencyMs, String modelName) {
    JsonNode result = parseOutputJson(responseJson);
    return new AiReviewLlmResult(
        objectOrEmpty(result.path("scores")),
        result.path("totalScore").isNumber() ? result.path("totalScore").asDouble() : null,
        text(result, "decision"),
        text(result, "comment"),
        arrayOrEmpty(result.path("riskFlags")),
        arrayOrEmpty(result.path("evidence")),
        responseJson,
        modelName,
        Math.toIntExact(Math.min(latencyMs, Integer.MAX_VALUE)));
  }

  private JsonNode parseOutputJson(JsonNode responseJson) {
    String outputText = text(responseJson, "output_text");
    if (outputText == null || outputText.isBlank()) {
      outputText = findFirstText(responseJson);
    }
    if (outputText == null || outputText.isBlank()) {
      throw new IllegalStateException("LLM response does not contain output text");
    }
    try {
      return objectMapper.readTree(outputText);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("LLM response text is not valid JSON", exception);
    }
  }

  private String findFirstText(JsonNode node) {
    if (node == null || node.isNull()) {
      return null;
    }
    if (node.isObject()) {
      JsonNode text = node.get("text");
      if (text != null && text.isTextual() && !text.asText().isBlank()) {
        return text.asText();
      }
      Iterator<JsonNode> values = node.elements();
      while (values.hasNext()) {
        String found = findFirstText(values.next());
        if (found != null && !found.isBlank()) {
          return found;
        }
      }
    }
    if (node.isArray()) {
      for (JsonNode child : node) {
        String found = findFirstText(child);
        if (found != null && !found.isBlank()) {
          return found;
        }
      }
    }
    return null;
  }

  private JsonNode objectOrEmpty(JsonNode node) {
    return node != null && node.isObject() ? node : objectMapper.createObjectNode();
  }

  private ArrayNode arrayOrEmpty(JsonNode node) {
    return node != null && node.isArray() ? (ArrayNode) node : objectMapper.createArrayNode();
  }

  private String text(JsonNode node, String field) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return null;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }
}
