export function normalizeEmailAddress(value) {
  return String(value ?? '').trim().toLowerCase();
}
