const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function isWordCharacterAt(value, index) {
  if (index < 0 || index >= value.length) return false;
  let start = index;
  const codeUnit = value.charCodeAt(index);
  if (index > 0 && codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) start -= 1;
  return WORD_CHARACTER.test(String.fromCodePoint(value.codePointAt(start)));
}

export function isWholeWordMatch(value, start, end) {
  return !isWordCharacterAt(value, start - 1) && !isWordCharacterAt(value, end);
}
