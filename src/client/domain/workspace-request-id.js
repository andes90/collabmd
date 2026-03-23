export function createWorkspaceRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
