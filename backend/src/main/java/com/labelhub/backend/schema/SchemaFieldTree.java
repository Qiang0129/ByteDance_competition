package com.labelhub.backend.schema;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;

/**
 * Schema 字段树工具。
 * group 使用 children 承载子字段，multi-tab 使用 componentProps.tabs[].children 承载子字段；
 * 后端校验、答案过滤、导出和 LLM 触发都应通过这里读取完整字段链路。
 */
public final class SchemaFieldTree {

  private SchemaFieldTree() {}

  public static List<JsonNode> flattenFieldList(JsonNode fields) {
    List<JsonNode> result = new ArrayList<>();
    appendFields(result, fields);
    return result;
  }

  public static ArrayNode flattenFields(ObjectMapper objectMapper, JsonNode fields) {
    ArrayNode result = objectMapper.createArrayNode();
    for (JsonNode field : flattenFieldList(fields)) {
      result.add(stripNestedFieldContainers(field));
    }
    return result;
  }

  public static JsonNode findField(JsonNode fields, String fieldName) {
    if (fieldName == null || fieldName.isBlank()) {
      return null;
    }
    for (JsonNode field : flattenFieldList(fields)) {
      if (fieldName.equals(text(field, "fieldName"))) {
        return field;
      }
    }
    return null;
  }

  private static void appendFields(List<JsonNode> result, JsonNode fields) {
    if (fields == null || !fields.isArray()) {
      return;
    }
    for (JsonNode field : fields) {
      if (!field.isObject()) {
        continue;
      }
      result.add(field);
      if ("multi-tab".equals(text(field, "kind"))) {
        JsonNode tabs = field.path("componentProps").path("tabs");
        if (tabs.isArray()) {
          for (JsonNode tab : tabs) {
            appendFields(result, tab.path("children"));
          }
        }
        if (!tabs.isArray() || tabs.isEmpty()) {
          appendFields(result, field.path("children"));
        }
      } else {
        appendFields(result, field.path("children"));
      }
    }
  }

  private static JsonNode stripNestedFieldContainers(JsonNode field) {
    if (field == null || !field.isObject()) {
      return field;
    }
    ObjectNode copy = ((ObjectNode) field).deepCopy();
    copy.remove("children");
    JsonNode componentProps = copy.path("componentProps");
    JsonNode tabs = componentProps.path("tabs");
    if (componentProps.isObject() && tabs.isArray()) {
      ArrayNode strippedTabs = ((ArrayNode) tabs).arrayNode();
      for (JsonNode tab : tabs) {
        if (!tab.isObject()) {
          strippedTabs.add(tab.deepCopy());
          continue;
        }
        ObjectNode strippedTab = ((ObjectNode) tab).deepCopy();
        strippedTab.remove("children");
        strippedTabs.add(strippedTab);
      }
      ((ObjectNode) componentProps).set("tabs", strippedTabs);
    }
    return copy;
  }

  private static String text(JsonNode node, String field) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return "";
    }
    JsonNode value = node.get(field);
    String text = value.isTextual() ? value.asText() : value.toString();
    return text == null ? "" : text.trim();
  }
}
