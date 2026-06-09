package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class LabelerRawPayloadSanitizer {

  private static final Set<String> HIDDEN_KEYS = Set.of(
      "preferred",
      "annotatornote",
      "answerkey",
      "correctanswer",
      "expectedanswer",
      "referenceanswer",
      "goldanswer",
      "goldlabel",
      "groundtruth",
      "targetlabel",
      "labelanswer",
      "rationale",
      "explanation",
      "margin",
      "safetyflag");

  private LabelerRawPayloadSanitizer() {}

  static ObjectNode sanitize(ObjectNode rawPayload) {
    ObjectNode copy = rawPayload.deepCopy();
    sanitizeObject(copy);
    return copy;
  }

  private static void sanitizeObject(ObjectNode node) {
    Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> entry = fields.next();
      if (shouldHide(entry.getKey())) {
        fields.remove();
        continue;
      }
      sanitizeNested(entry.getValue());
    }
  }

  private static void sanitizeNested(JsonNode node) {
    if (node instanceof ObjectNode objectNode) {
      sanitizeObject(objectNode);
      return;
    }
    if (node instanceof ArrayNode arrayNode) {
      for (JsonNode item : arrayNode) {
        sanitizeNested(item);
      }
    }
  }

  private static boolean shouldHide(String key) {
    return HIDDEN_KEYS.contains(normalizeKey(key));
  }

  private static String normalizeKey(String key) {
    StringBuilder normalized = new StringBuilder();
    String source = key == null ? "" : key.trim().toLowerCase(Locale.ROOT);
    for (int i = 0; i < source.length(); i += 1) {
      char current = source.charAt(i);
      if ((current >= 'a' && current <= 'z') || (current >= '0' && current <= '9')) {
        normalized.append(current);
      }
    }
    return normalized.toString();
  }
}
