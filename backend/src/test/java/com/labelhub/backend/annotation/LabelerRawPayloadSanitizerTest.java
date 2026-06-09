package com.labelhub.backend.annotation;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class LabelerRawPayloadSanitizerTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void shouldHideAnswerMetadataButKeepQuestionContext() {
    ObjectNode raw = objectMapper.createObjectNode();
    raw.put("prompt", "Compare two answers");
    raw.put("response_a", "A is detailed");
    raw.put("response_b", "B is brief");
    raw.put("model_answer", "Candidate answer");
    raw.put("preferred", "A");
    raw.put("annotator_note", "A is better");
    raw.put("margin", "large");
    raw.put("safety_flag", false);

    ObjectNode sanitized = LabelerRawPayloadSanitizer.sanitize(raw);

    assertThat(sanitized.has("preferred")).isFalse();
    assertThat(sanitized.has("annotator_note")).isFalse();
    assertThat(sanitized.has("margin")).isFalse();
    assertThat(sanitized.has("safety_flag")).isFalse();
    assertThat(sanitized.path("prompt").asText()).isEqualTo("Compare two answers");
    assertThat(sanitized.path("response_a").asText()).isEqualTo("A is detailed");
    assertThat(sanitized.path("response_b").asText()).isEqualTo("B is brief");
    assertThat(sanitized.path("model_answer").asText()).isEqualTo("Candidate answer");
  }

  @Test
  void shouldHideNestedAnswerMetadataWithCommonKeyStyles() {
    ObjectNode raw = objectMapper.createObjectNode();
    ObjectNode metadata = raw.putObject("metadata");
    metadata.put("groundTruth", "A");
    metadata.put("correct-answer", "A");
    metadata.put("expected_answer", "A");
    metadata.put("visible_context", "keep");
    raw.putArray("checks")
        .addObject()
        .put("reference_answer", "A");

    ObjectNode sanitized = LabelerRawPayloadSanitizer.sanitize(raw);
    ObjectNode sanitizedMetadata = (ObjectNode) sanitized.path("metadata");

    assertThat(sanitizedMetadata.has("groundTruth")).isFalse();
    assertThat(sanitizedMetadata.has("correct-answer")).isFalse();
    assertThat(sanitizedMetadata.has("expected_answer")).isFalse();
    assertThat(sanitizedMetadata.path("visible_context").asText()).isEqualTo("keep");
    assertThat(sanitized.path("checks").get(0).has("reference_answer")).isFalse();
  }
}
