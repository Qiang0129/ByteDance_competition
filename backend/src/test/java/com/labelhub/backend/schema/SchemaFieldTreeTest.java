package com.labelhub.backend.schema;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.Test;

class SchemaFieldTreeTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void flattenFieldListIncludesGroupAndMultiTabChildren() throws Exception {
    JsonNode fields = objectMapper.readTree("""
        [
          {
            "id": "group_1",
            "kind": "group",
            "fieldName": "group_1",
            "children": [
              {"id": "title", "kind": "text-single", "fieldName": "title"}
            ]
          },
          {
            "id": "tabs_1",
            "kind": "multi-tab",
            "fieldName": "tabs_1",
            "componentProps": {
              "tabs": [
                {
                  "id": "tab_a",
                  "label": "A",
                  "children": [
                    {"id": "quality", "kind": "single-choice", "fieldName": "quality"}
                  ]
                },
                {
                  "id": "tab_b",
                  "label": "B",
                  "children": [
                    {"id": "comment", "kind": "text-multi", "fieldName": "comment"}
                  ]
                }
              ]
            }
          }
        ]
        """);

    assertThat(SchemaFieldTree.flattenFieldList(fields))
        .extracting(field -> field.path("fieldName").asText())
        .containsExactly("group_1", "title", "tabs_1", "quality", "comment");
    assertThat(SchemaFieldTree.findField(fields, "comment").path("id").asText()).isEqualTo("comment");
  }

  @Test
  void flattenFieldsRemovesNestedContainersFromFlatOutput() throws Exception {
    JsonNode fields = objectMapper.readTree("""
        [
          {
            "id": "tabs_1",
            "kind": "multi-tab",
            "fieldName": "tabs_1",
            "children": [
              {"id": "fallback", "kind": "text-single", "fieldName": "fallback"}
            ],
            "componentProps": {
              "tabs": [
                {
                  "id": "tab_a",
                  "label": "A",
                  "children": [
                    {"id": "quality", "kind": "single-choice", "fieldName": "quality"}
                  ]
                }
              ]
            }
          }
        ]
        """);

    ArrayNode flattened = SchemaFieldTree.flattenFields(objectMapper, fields);

    assertThat(flattened).hasSize(2);
    assertThat(flattened.get(0).has("children")).isFalse();
    assertThat(flattened.get(0).path("componentProps").path("tabs").get(0).has("children")).isFalse();
    assertThat(flattened)
        .extracting(field -> field.path("fieldName").asText())
        .containsExactly("tabs_1", "quality");
  }
}
