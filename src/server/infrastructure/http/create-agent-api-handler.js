import { getAgentToolDefinition } from '../../../domain/agent-tool-definitions.js';
import { encodeAgentToolImage } from '../../shared/agent-tool-image.js';
import { readRequestId } from './http-request-helpers.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

const WEBMCP_TOOL_PATH = '/api/agent/tools/';

function createAgentError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sendAgentError(req, res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  if (statusCode >= 500) console.error('[agent] Request failed:', error.message);
  jsonResponse(req, res, statusCode, {
    code: error?.code || 'AGENT_REQUEST_FAILED',
    error: statusCode >= 500 ? 'Agent request failed' : error.message,
    ...(Number.isFinite(error?.retryAfterMs) ? { retryAfterMs: error.retryAfterMs } : {}),
  });
}

async function createWebMcpActor({ agentConnectionService, authService, config, req }) {
  let subject;
  if (config.auth.strategy === 'none') {
    subject = {
      collaborator: null,
      subjectId: req.socket?.remoteAddress || 'unknown',
      subjectType: 'anonymous',
    };
  } else {
    const user = authService.getAuthenticatedUser?.(req) ?? null;
    subject = await agentConnectionService.resolveManagementSubject(user);
  }
  const actorId = `webmcp:${subject.subjectType}:${subject.subjectId}`;
  return {
    collaborator: subject.collaborator,
    connectionId: actorId,
    origin: 'webmcp',
    rateLimitKey: actorId,
    requestId: readRequestId(req),
    scopes: ['vault:edit', 'vault:read'],
    sourceRef: 'webmcp',
  };
}

async function mapWebMcpResult(definition, value) {
  if (definition.resultKind !== 'image') return value;
  const { data, mimeType, structuredContent } = await encodeAgentToolImage(value);
  return {
    ...structuredContent,
    image: { data, encoding: 'base64', mimeType },
  };
}

export function createAgentApiHandler({
  agentConnectionService,
  agentContentService,
  authService,
  config,
  rateLimiter,
}) {
  return async function handleAgentApi(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith('/api/agent')) return false;

    try {
      if (requestUrl.pathname.startsWith(WEBMCP_TOOL_PATH)) {
        if (req.method !== 'POST') {
          throw createAgentError('AGENT_METHOD_NOT_ALLOWED', 'WebMCP tools require POST', 405);
        }
        const name = decodeURIComponent(requestUrl.pathname.slice(WEBMCP_TOOL_PATH.length));
        const definition = getAgentToolDefinition(name);
        if (!definition?.webMcp) {
          throw createAgentError('AGENT_TOOL_NOT_FOUND', 'WebMCP tool not found', 404);
        }
        const input = await parseJsonBody(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw createAgentError('AGENT_INPUT_INVALID', 'WebMCP tool input must be an object', 400);
        }
        const actor = await createWebMcpActor({
          agentConnectionService,
          authService,
          config,
          req,
        });
        rateLimiter(actor.rateLimitKey);
        const cancellation = new AbortController();
        const abort = () => cancellation.abort();
        req.once('aborted', abort);
        try {
          const value = await agentContentService[definition.method](actor, {
            ...input,
            signal: cancellation.signal,
          });
          jsonResponse(req, res, 200, await mapWebMcpResult(definition, value));
        } finally {
          req.off('aborted', abort);
        }
        return true;
      }

      if (!config.agentAccess?.enabled) {
        jsonResponse(req, res, 404, { error: 'Agent Access is not enabled' });
        return true;
      }
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
