package com.labelhub.backend.ai;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Pattern;

final class AiReviewTextNormalizer {

  private static final Pattern MOJIBAKE_MARKERS =
      Pattern.compile("[\\u0080-\\u009fÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ�]");
  private static final Pattern CJK_PATTERN = Pattern.compile("[\\u3400-\\u9fff]");
  private static final Map<Character, Integer> WINDOWS_1252_REVERSE = Map.ofEntries(
      Map.entry('€', 0x80),
      Map.entry('‚', 0x82),
      Map.entry('ƒ', 0x83),
      Map.entry('„', 0x84),
      Map.entry('…', 0x85),
      Map.entry('†', 0x86),
      Map.entry('‡', 0x87),
      Map.entry('ˆ', 0x88),
      Map.entry('‰', 0x89),
      Map.entry('Š', 0x8a),
      Map.entry('‹', 0x8b),
      Map.entry('Œ', 0x8c),
      Map.entry('Ž', 0x8e),
      Map.entry('‘', 0x91),
      Map.entry('’', 0x92),
      Map.entry('“', 0x93),
      Map.entry('”', 0x94),
      Map.entry('•', 0x95),
      Map.entry('–', 0x96),
      Map.entry('—', 0x97),
      Map.entry('˜', 0x98),
      Map.entry('™', 0x99),
      Map.entry('š', 0x9a),
      Map.entry('›', 0x9b),
      Map.entry('œ', 0x9c),
      Map.entry('ž', 0x9e),
      Map.entry('Ÿ', 0x9f));

  private AiReviewTextNormalizer() {}

  static String repairUtf8Mojibake(String value) {
    if (value == null || value.isBlank() || !looksLikeMojibake(value)) {
      return value;
    }
    try {
      String repaired = decodeLatin1AsUtf8(value);
      if (repaired.contains("\uFFFD")) {
        return value;
      }
      int originalCjkCount = countMatches(CJK_PATTERN, value);
      int repairedCjkCount = countMatches(CJK_PATTERN, repaired);
      if (repairedCjkCount > originalCjkCount && !looksLikeMojibake(repaired)) {
        return repaired;
      }
    } catch (IllegalArgumentException exception) {
      return value;
    }
    return value;
  }

  private static boolean looksLikeMojibake(String value) {
    return MOJIBAKE_MARKERS.matcher(value).find();
  }

  private static String decodeLatin1AsUtf8(String value) {
    byte[] bytes = new byte[value.length()];
    for (int index = 0; index < value.length(); index += 1) {
      char character = value.charAt(index);
      if (character <= 0xff) {
        bytes[index] = (byte) character;
      } else if (WINDOWS_1252_REVERSE.containsKey(character)) {
        bytes[index] = (byte) WINDOWS_1252_REVERSE.get(character).intValue();
      } else {
        throw new IllegalArgumentException("unsupported mojibake character");
      }
    }
    try {
      return StandardCharsets.UTF_8
          .newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(bytes))
          .toString();
    } catch (CharacterCodingException exception) {
      throw new IllegalArgumentException("invalid utf-8 mojibake bytes", exception);
    }
  }

  private static int countMatches(Pattern pattern, String value) {
    int count = 0;
    var matcher = pattern.matcher(value);
    while (matcher.find()) {
      count += 1;
    }
    return count;
  }
}
