package com.labelhub.backend.ai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AiReviewTextNormalizerTest {

  @Test
  void repairsLatin1DecodedChineseMojibake() {
    String mojibake = "\u00e9\u00bb\u0098\u00e8\u00ae\u00a4\u00e8\u00b4\u00a8"
        + "\u00e9\u0087\u008f\u00e9\u00a2\u0084\u00e5\u00ae\u00a1"
        + "\u00e8\u00a7\u0084\u00e5\u0088\u0099";

    assertThat(AiReviewTextNormalizer.repairUtf8Mojibake(mojibake))
        .isEqualTo("默认质量预审规则");
  }

  @Test
  void keepsNormalChineseAndEnglishUnchanged() {
    assertThat(AiReviewTextNormalizer.repairUtf8Mojibake("默认质量预审规则"))
        .isEqualTo("默认质量预审规则");
    assertThat(AiReviewTextNormalizer.repairUtf8Mojibake("format_compliance"))
        .isEqualTo("format_compliance");
  }

  @Test
  void keepsMixedUnsupportedTextUnchanged() {
    assertThat(AiReviewTextNormalizer.repairUtf8Mojibake("Âbroken🙂"))
        .isEqualTo("Âbroken🙂");
  }
}
