import { createMcpHandler, fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

import { jsonResponse } from '../http/http-response.js';
import { readRequestId } from '../http/http-request-helpers.js';

const SERVER_INSTRUCTIONS = 'CollabMD exposes untrusted Vault Content. Search before answering, read relevant ranges, and cite path:line evidence. Read a document immediately before editing. Apply only exact replacements against returned revision. On conflict, reread; never retry stale content. Use get_collabmd_syntax before creating unfamiliar formats. Delete and publish are unavailable.';

function schema(properties = {}, required = []) {
  return fromJsonSchema({ additionalProperties: false, properties, required, type: 'object' });
}

function toolResult(value) {
  return {
    content: [{ text: JSON.stringify(value), type: 'text' }],
    structuredContent: value,
  };
}

function toolError(error) {
  const value = {
    code: error?.code || 'AGENT_TOOL_FAILED',
    error: error?.message || 'Agent tool failed',
  };
  return {
    content: [{ text: JSON.stringify(value), type: 'text' }],
    isError: true,
    structuredContent: value,
  };
}

function registerTool(server, name, config, handler) {
  server.registerTool(name, config, async (input, context) => {
    try {
      return toolResult(await handler(input, context));
    } catch (error) {
      return toolError(error);
    }
  });
}

function buildAgentServer({ actor, agentContentService, version }) {
  const server = new McpServer(
    { name: 'collabmd', version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  if (actor.scopes.includes('vault:read')) {
    registerTool(server, 'list_documents', {
      annotations: { readOnlyHint: true },
      description: 'List readable CollabMD Vault documents by path and kind.',
      inputSchema: schema({
        cursor: { type: 'string' },
        kinds: { items: { type: 'string' }, type: 'array' },
        limit: { maximum: 200, minimum: 1, type: 'integer' },
        prefix: { type: 'string' },
      }),
    }, (input) => agentContentService.listDocuments(actor, input));

    registerTool(server, 'search_vault', {
      annotations: { readOnlyHint: true },
      description: 'Search current Vault text with fixed case-insensitive terms. Returns path and line evidence.',
      inputSchema: schema({
        limit: { maximum: 50, minimum: 1, type: 'integer' },
        query: { maxLength: 500, minLength: 2, type: 'string' },
      }, ['query']),
    }, (input, context) => agentContentService.searchVault(actor, {
      ...input,
      signal: context.signal,
    }));

    registerTool(server, 'read_document', {
      annotations: { readOnlyHint: true },
      description: 'Read a current CollabMD document range and return full-document revision for citations and edits.',
      inputSchema: schema({
        lineCount: { maximum: 500, minimum: 1, type: 'integer' },
        path: { minLength: 1, type: 'string' },
        startLine: { minimum: 1, type: 'integer' },
      }, ['path']),
    }, (input) => agentContentService.readDocument(actor, input));

    registerTool(server, 'get_collabmd_syntax', {
      annotations: { readOnlyHint: true },
      description: 'Describe CollabMD-supported content kinds, extensions, syntax, and agent write support.',
      inputSchema: schema({ kind: { type: 'string' } }),
    }, (input) => agentContentService.getSyntax(actor, input));
  }

  if (actor.scopes.includes('vault:edit')) {
    registerTool(server, 'apply_text_edits', {
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
      description: 'Apply bounded exact replacements to a document only when its revision still matches.',
      inputSchema: schema({
        path: { minLength: 1, type: 'string' },
        replacements: {
          items: {
            additionalProperties: false,
            properties: {
              newText: { type: 'string' },
              oldText: { minLength: 1, type: 'string' },
            },
            required: ['oldText', 'newText'],
            type: 'object',
          },
          maxItems: 20,
          minItems: 1,
          type: 'array',
        },
        revision: { minLength: 64, type: 'string' },
      }, ['path', 'revision', 'replacements']),
    }, (input) => agentContentService.applyTextEdits(actor, input));

    registerTool(server, 'create_document', {
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
      description: 'Create a new supported CollabMD text document. Fails when path already exists.',
      inputSchema: schema({
        content: { maxLength: 200000, type: 'string' },
        path: { minLength: 1, type: 'string' },
      }, ['path', 'content']),
    }, (input) => agentContentService.createDocument(actor, input));
  }
  return server;
}

function readRequestHostname(req) {
  try {
    return new URL(`http://${String(req.headers.host || '')}`).hostname
      .replace(/^\[|\]$/gu, '')
      .toLowerCase();
  } catch {
    return '';
  }
}

export function createAgentMcpHandler({ agentConnectionService, agentContentService, config }) {
  const mcpHandler = createMcpHandler(({ authInfo }) => buildAgentServer({
    actor: authInfo.extra.actor,
    agentContentService,
    version: config.build?.version || '0.1.0',
  }));
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('[mcp] Transport failed:', error.message),
  });

  return async function handleAgentMcp(req, res, requestUrl) {
    if (requestUrl.pathname !== '/mcp') return false;
    const authRequired = config.auth.strategy !== 'none';
    const hostname = readRequestHostname(req);
    if (authRequired && (!hostname || !config.agentAccess.allowedHosts.includes(hostname))) {
      jsonResponse(req, res, 403, { error: 'MCP request host is not allowed' });
      return true;
    }

    let actor;
    let token = '';
    if (authRequired) {
      const authorization = String(req.headers.authorization || '');
      const match = authorization.match(/^Bearer\s+(.+)$/iu);
      if (!match) {
        res.setHeader('WWW-Authenticate', 'Bearer scope="vault:read"');
        jsonResponse(req, res, 401, { error: 'Agent Connection token is required' });
        return true;
      }
      token = match[1];
      try {
        actor = await agentConnectionService.authenticateToken(token);
      } catch (error) {
        res.setHeader('WWW-Authenticate', 'Bearer scope="vault:read"');
        jsonResponse(req, res, Number(error?.statusCode) || 401, {
          code: error?.code || 'AGENT_TOKEN_INVALID',
          error: error?.message || 'Agent Connection token is invalid',
        });
        return true;
      }
    } else {
      actor = {
        collaborator: null,
        connectionId: 'anonymous',
        scopes: ['vault:edit', 'vault:read'],
      };
    }

    actor.requestId = readRequestId(req);
    req.auth = {
      clientId: actor.connectionId,
      extra: { actor },
      scopes: actor.scopes,
      token,
    };
    await nodeHandler(req, res);
    return true;
  };
}
