import { resolveApiUrl } from '../domain/runtime-paths.js';

async function parseResponse(response, fallback) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

export class AgentConnectionApiClient {
  listConnections() {
    return fetch(resolveApiUrl('/agent/connections'))
      .then((response) => parseResponse(response, 'Failed to load Agent Connections'));
  }

  createConnection(payload) {
    return fetch(resolveApiUrl('/agent/connections'), {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).then((response) => parseResponse(response, 'Failed to create Agent Connection'));
  }

  revokeConnection(connectionId) {
    return fetch(resolveApiUrl(`/agent/connections/${encodeURIComponent(connectionId)}`), {
      method: 'DELETE',
    }).then((response) => parseResponse(response, 'Failed to revoke Agent Connection'));
  }
}
