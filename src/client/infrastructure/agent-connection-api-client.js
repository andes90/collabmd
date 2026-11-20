import { apiRequest } from './api-client-utils.js';

export const agentConnectionApiClient = {
  listConnections() {
    return apiRequest('/agent/connections', { fallback: 'Failed to load Agent Connections' });
  },

  createConnection(payload) {
    return apiRequest('/agent/connections', { body: payload, fallback: 'Failed to create Agent Connection', method: 'POST' });
  },

  revokeConnection(connectionId) {
    return apiRequest(`/agent/connections/${encodeURIComponent(connectionId)}`, {
      fallback: 'Failed to revoke Agent Connection',
      method: 'DELETE',
    });
  },
};
