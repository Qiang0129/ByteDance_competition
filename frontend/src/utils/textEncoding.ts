const MOJIBAKE_MARKERS =
  /[\u0080-\u009fÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ�]/;
const CJK_PATTERN = /[\u3400-\u9fff]/g;
const WINDOWS_1252_REVERSE: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function looksLikeMojibake(value: string) {
  return MOJIBAKE_MARKERS.test(value);
}

function decodeLatin1AsUtf8(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const code = value.charCodeAt(index);
    if (code <= 0xff) {
      bytes[index] = code;
    } else if (WINDOWS_1252_REVERSE[char] !== undefined) {
      bytes[index] = WINDOWS_1252_REVERSE[char];
    } else {
      throw new Error('unsupported mojibake character');
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * 修复中文 UTF-8 被误按 Latin-1/Windows-1252 解读后形成的 mojibake。
 * 仅在原文具有典型乱码特征、且修复后中文字符明显增加时替换，避免影响正常英文 key。
 */
export function repairUtf8Mojibake(value: string) {
  if (!looksLikeMojibake(value)) {
    return value;
  }

  try {
    const repaired = decodeLatin1AsUtf8(value);
    if (repaired.includes('\uFFFD')) {
      return value;
    }

    const originalCjkCount = countMatches(value, CJK_PATTERN);
    const repairedCjkCount = countMatches(repaired, CJK_PATTERN);
    if (repairedCjkCount > originalCjkCount && !looksLikeMojibake(repaired)) {
      return repaired;
    }
  } catch {
    return value;
  }

  return value;
}
