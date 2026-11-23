export async function createEditableContentRevision(content) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(content ?? '')),
  );
  return new Uint8Array(digest).toHex();
}
