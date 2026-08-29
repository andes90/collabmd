import { resolveApiUrl } from '../domain/runtime-paths.js';
import { parseApiResponse } from './api-client-utils.js';

export const agentConnectionApiClient = {
  listConnections() {
    return fetch(resolveApiUrl('/agent/connections'))
      .then((response) => parseApiResponse(response, 'Failed to load Agent Connections'));
  },

  createConnection(payload) {
    return fetch(resolveApiUrl('/agent/connections'), {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).then((response) => parseApiResponse(response, 'Failed to create Agent Connection'));
  },

  revokeConnection(connectionId) {
    return fetch(resolveApiUrl(`/agent/connections/${encodeURIComponent(connectionId)}`), {
      method: 'DELETE',
    }).then((response) => parseApiResponse(response, 'Failed to revoke Agent Connection'));
  },
};
