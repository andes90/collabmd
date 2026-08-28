import { parseJsonBody } from './request-body.js';
import { jsonResponse } from './http-response.js';

function sendAgentError(req, res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  if (statusCode >= 500) console.error('[agent] Request failed:', error.message);
  jsonResponse(req, res, statusCode, {
    code: error?.code || 'AGENT_REQUEST_FAILED',
    error: statusCode >= 500 ? 'Agent request failed' : error.message,
  });
}

export function createAgentApiHandler({ agentConnectionService, authService, config }) {
  return async function handleAgentApi(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith('/api/agent')) return false;
    if (!config.agentAccess?.enabled) {
      jsonResponse(req, res, 404, { error: 'Agent Access is not enabled' });
      return true;
    }

    try {
      const user = authService.getAuthenticatedUser?.(req) ?? null;
      if (requestUrl.pathname === '/api/agent/connections' && req.method === 'GET') {
        jsonResponse(req, res, 200, {
          connections: await agentConnectionService.listConnections(user),
        });
        return true;
      }
      if (requestUrl.pathname === '/api/agent/connections' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        jsonResponse(req, res, 201, await agentConnectionService.createConnection({
          clientKind: body?.clientKind,
          label: body?.label,
          scopes: body?.scopes,
          user,
        }));
        return true;
      }
      if (requestUrl.pathname.startsWith('/api/agent/connections/') && req.method === 'DELETE') {
        const connectionId = decodeURIComponent(
          requestUrl.pathname.slice('/api/agent/connections/'.length).split('/')[0] || '',
        );
        jsonResponse(req, res, 200, await agentConnectionService.revokeConnection({
          connectionId,
          user,
        }));
        return true;
      }
      jsonResponse(req, res, 404, { error: 'Agent endpoint not found' });
      return true;
    } catch (error) {
      sendAgentError(req, res, error);
      return true;
    }
  };
}
