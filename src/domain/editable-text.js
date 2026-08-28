export function normalizeEditableText(content) {
  return String(content ?? '').replace(/\r\n?/g, '\n');
}
