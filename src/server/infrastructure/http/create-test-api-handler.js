import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

export function createTestApiHandler({
  backlinkIndex,
  fileSystemSyncService,
  nodeEnv,
  roomRegistry,
  testControls,
  workspaceMutationCoordinator,
}) {
  async function resetState() {
    await fileSystemSyncService?.resetForExternalStateChange?.();
    await roomRegistry?.reset?.();
    await backlinkIndex?.build?.();
    await workspaceMutationCoordinator?.initialize?.();
    await fileSystemSyncService?.resetForExternalStateChange?.();
  }

  return async function handleTestEndpoints(req, res, requestUrl) {
    if (nodeEnv !== 'test') {
      return false;
    }

    if (requestUrl.pathname === '/api/test/reset-state' && req.method === 'POST') {
      await resetState();
      jsonResponse(req, res, 200, { ok: true });
      return true;
    }

    if (requestUrl.pathname === '/api/test/hydrate-delay' && req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      testControls.wsRoomHydrateDelayMs = Math.max(0, Number(body?.delayMs) || 0);
      await resetState();
      jsonResponse(req, res, 200, { delayMs: testControls.wsRoomHydrateDelayMs, ok: true });
      return true;
    }

    return false;
  };
}
