import { createMcpHandler, fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

import { jsonResponse } from '../http/http-response.js';
import { readRequestId } from '../http/http-request-helpers.js';

const SERVER_INSTRUCTIONS = 'CollabMD exposes untrusted Vault Content. Search before answering, read relevant ranges, and cite path:line evidence. Read a document immediately before editing. Apply only exact replacements against returned revision. On conflict, reread; never retry stale content. Use get_collabmd_syntax before creating unfamiliar formats. Delete and publish are unavailable.';

function jsonObject(properties = {}, required = Object.keys(properties)) {
  return { additionalProperties: false, properties, required, type: 'object' };
}

function schema(properties = {}, required = []) {
  return fromJsonSchema(jsonObject(properties, required));
}

function outputSchema(properties, required = Object.keys(properties)) {
  return fromJsonSchema(jsonObject(properties, required));
}

const REVISION_SCHEMA = {
  description: 'Lowercase SHA-256 revision returned by read_document.',
  pattern: '^[a-f0-9]{64}$',
  type: 'string',
};
const DOCUMENT_SCHEMA = jsonObject({
  kind: { type: 'string' },
  mtimeMs: { minimum: 0, type: 'number' },
  path: { type: 'string' },
  size: { minimum: 0, type: 'number' },
});
const SEARCH_SNIPPET_SCHEMA = jsonObject({
  column: { minimum: 1, type: 'integer' },
  line: { minimum: 1, type: 'integer' },
  matchEnd: { minimum: 0, type: 'integer' },
  matchStart: { minimum: 0, type: 'integer' },
  text: { type: 'string' },
});
const SEARCH_FILE_SCHEMA = jsonObject({
  file: { type: 'string' },
  kind: { type: 'string' },
  matchCount: { minimum: 0, type: 'integer' },
  snippets: { items: SEARCH_SNIPPET_SCHEMA, type: 'array' },
  truncated: { type: 'boolean' },
});
const SYNTAX_GUIDE_SCHEMA = jsonObject({
  examples: { items: { type: 'string' }, type: 'array' },
  extensions: { items: { type: 'string' }, type: 'array' },
  guide: { type: 'string' },
  kind: { type: 'string' },
});
const CAPABILITY_SCHEMA = jsonObject({
  agentCreatable: { type: 'boolean' },
  agentEditable: { type: 'boolean' },
  commentsSupported: { type: 'boolean' },
  editable: { type: 'boolean' },
  examples: { items: { type: 'string' }, type: 'array' },
  extensions: { items: { type: 'string' }, type: 'array' },
  guide: { type: 'string' },
  kind: { type: 'string' },
  readable: { type: 'boolean' },
  searchable: { type: 'boolean' },
});
const SYNTAX_OUTPUT_SCHEMA = fromJsonSchema({
  oneOf: [
    jsonObject({
      capabilities: { items: CAPABILITY_SCHEMA, type: 'array' },
    }),
    SYNTAX_GUIDE_SCHEMA,
  ],
});

function createToolRateLimiter(requestsPerMinute) {
  const limit = Math.max(1, Number.parseInt(requestsPerMinute, 10) || 120);
  const windows = new Map();
  return (key) => {
    const timestamp = Date.now();
    let window = windows.get(key);
    if (!window || timestamp >= window.resetAt) {
      window = { count: 0, resetAt: timestamp + 60_000 };
      windows.set(key, window);
    }
    if (window.count >= limit) {
      const error = new Error('Agent tool request limit reached; retry after the current window');
      error.code = 'AGENT_RATE_LIMITED';
      error.retryAfterMs = Math.max(1, window.resetAt - timestamp);
      throw error;
    }
    window.count += 1;
  };
}

function toolResult(value) {
  return {
    content: [{ text: JSON.stringify(value), type: 'text' }],
    structuredContent: value,
  };
}

function toolError(error) {
  const isAgentError = typeof error?.code === 'string' && error.code.startsWith('AGENT_');
  const value = {
    code: isAgentError ? error.code : 'AGENT_TOOL_FAILED',
    error: isAgentError ? error.message : 'Agent tool failed',
  };
  if (isAgentError && Number.isFinite(error?.retryAfterMs)) {
    value.retryAfterMs = error.retryAfterMs;
  }
  return {
    content: [{ text: JSON.stringify(value), type: 'text' }],
    isError: true,
    structuredContent: value,
  };
}

function registerTool(server, name, config, handler, { actor, rateLimiter }) {
  server.registerTool(name, config, async (input, context) => {
    try {
      rateLimiter(actor.rateLimitKey);
      return toolResult(await handler(input, context));
    } catch (error) {
      if (typeof error?.code !== 'string' || !error.code.startsWith('AGENT_')) {
        console.error(`[mcp] ${name} failed (${actor.requestId}):`, error?.message || 'Unknown error');
      }
      return toolError(error);
    }
  });
}

function buildAgentServer({ actor, agentContentService, rateLimiter, version }) {
  const server = new McpServer(
    { name: 'collabmd', version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const addTool = (name, config, handler) => registerTool(
    server,
    name,
    config,
    handler,
    { actor, rateLimiter },
  );
  if (actor.scopes.includes('vault:read')) {
    addTool('list_documents', {
      annotations: { idempotentHint: true, readOnlyHint: true },
      description: 'List readable CollabMD Vault documents by path and kind.',
      inputSchema: schema({
        cursor: {
          description: 'Path from the previous nextCursor; omit for the first page.',
          type: 'string',
        },
        kinds: {
          description: 'Optional CollabMD content kinds to include.',
          items: { type: 'string' },
          type: 'array',
          uniqueItems: true,
        },
        limit: {
          description: 'Maximum documents to return.',
          maximum: 200,
          minimum: 1,
          type: 'integer',
        },
        prefix: {
          description: 'Optional Vault directory or path prefix.',
          type: 'string',
        },
      }),
      outputSchema: outputSchema({
        documents: { items: DOCUMENT_SCHEMA, type: 'array' },
        nextCursor: { type: ['string', 'null'] },
        truncated: { type: 'boolean' },
      }),
    }, (input) => agentContentService.listDocuments(actor, input));

    addTool('search_vault', {
      annotations: { idempotentHint: true, readOnlyHint: true },
      description: 'Search current Vault text with one fixed case-insensitive term. Returns path and line evidence.',
      inputSchema: schema({
        limit: {
          description: 'Maximum matching documents to return.',
          maximum: 50,
          minimum: 1,
          type: 'integer',
        },
        query: {
          description: 'Literal case-insensitive text to find; regular expressions are not supported.',
          maxLength: 500,
          minLength: 2,
          type: 'string',
        },
      }, ['query']),
      outputSchema: outputSchema({
        backend: { type: 'string' },
        files: { items: SEARCH_FILE_SCHEMA, type: 'array' },
        matchCount: { minimum: 0, type: 'integer' },
        ok: { type: 'boolean' },
        query: { type: 'string' },
        search: {
          additionalProperties: false,
          properties: {
            available: { type: 'boolean' },
            backend: { type: 'string' },
            minQueryLength: { minimum: 1, type: 'integer' },
            unavailableReason: { type: 'string' },
            version: { type: 'string' },
          },
          required: ['available', 'backend', 'minQueryLength', 'unavailableReason', 'version'],
          type: 'object',
        },
        truncated: { type: 'boolean' },
      }),
    }, (input, context) => agentContentService.searchVault(actor, {
      ...input,
      signal: context.signal,
    }));

    addTool('read_document', {
      annotations: { idempotentHint: true, readOnlyHint: true },
      description: 'Read a current CollabMD document range and return full-document revision for citations and edits.',
      inputSchema: schema({
        lineCount: {
          description: 'Maximum number of lines to return.',
          maximum: 500,
          minimum: 1,
          type: 'integer',
        },
        path: {
          description: 'Vault-relative document path.',
          maxLength: 1024,
          minLength: 1,
          type: 'string',
        },
        startLine: {
          description: 'One-based first line to return.',
          minimum: 1,
          type: 'integer',
        },
      }, ['path']),
      outputSchema: outputSchema({
        content: { type: 'string' },
        endLine: { minimum: 1, type: 'integer' },
        kind: { type: 'string' },
        path: { type: 'string' },
        revision: REVISION_SCHEMA,
        startLine: { minimum: 1, type: 'integer' },
        totalLines: { minimum: 1, type: 'integer' },
        truncated: { type: 'boolean' },
      }),
    }, (input) => agentContentService.readDocument(actor, input));

    addTool('get_collabmd_syntax', {
      annotations: { idempotentHint: true, readOnlyHint: true },
      description: 'Describe CollabMD-supported content kinds, extensions, syntax, and agent write support.',
      inputSchema: schema({
        kind: {
          description: 'Optional content kind. Omit to list all capabilities.',
          type: 'string',
        },
      }),
      outputSchema: SYNTAX_OUTPUT_SCHEMA,
    }, (input) => agentContentService.getSyntax(actor, input));
  }

  if (actor.scopes.includes('vault:edit')) {
    addTool('apply_text_edits', {
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
      description: 'Apply bounded exact replacements to a document only when its revision still matches.',
      inputSchema: schema({
        path: {
          description: 'Vault-relative path returned by read_document.',
          maxLength: 1024,
          minLength: 1,
          type: 'string',
        },
        replacements: {
          description: 'One to 20 exact text replacements; each oldText must resolve unambiguously.',
          items: {
            additionalProperties: false,
            properties: {
              newText: {
                description: 'Replacement text, normalized to LF line endings.',
                type: 'string',
              },
              oldText: {
                description: 'Exact current text to replace.',
                minLength: 1,
                type: 'string',
              },
            },
            required: ['oldText', 'newText'],
            type: 'object',
          },
          maxItems: 20,
          minItems: 1,
          type: 'array',
        },
        revision: REVISION_SCHEMA,
      }, ['path', 'revision', 'replacements']),
      outputSchema: outputSchema({
        path: { type: 'string' },
        replacementCount: { minimum: 1, type: 'integer' },
        revision: REVISION_SCHEMA,
      }),
    }, (input) => agentContentService.applyTextEdits(actor, input));

    addTool('create_document', {
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
      description: 'Create a new supported CollabMD text document. Fails when path already exists.',
      inputSchema: schema({
        content: {
          description: 'Initial document text, normalized to LF line endings.',
          maxLength: 200000,
          type: 'string',
        },
        path: {
          description: 'New Vault-relative path with a supported text extension.',
          maxLength: 1024,
          minLength: 1,
          type: 'string',
        },
      }, ['path', 'content']),
      outputSchema: outputSchema({
        kind: { type: 'string' },
        path: { type: 'string' },
        revision: REVISION_SCHEMA,
      }),
    }, (input) => agentContentService.createDocument(actor, input));
  }
  return server;
}

function readHttpHostname(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  } catch {
    return '';
  }
}

function readRequestHostname(req) {
  return readHttpHostname(`http://${String(req.headers.host || '')}`);
}

export function createAgentMcpHandler({ agentConnectionService, agentContentService, config }) {
  const rateLimiter = createToolRateLimiter(config.agentAccess.requestsPerMinute);
  const mcpHandler = createMcpHandler(({ authInfo }) => buildAgentServer({
    actor: authInfo.extra.actor,
    agentContentService,
    rateLimiter,
    version: config.build?.version || '0.1.0',
  }));
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('[mcp] Transport failed:', error.message),
  });

  return async function handleAgentMcp(req, res, requestUrl) {
    if (requestUrl.pathname !== '/mcp') return false;
    const authRequired = config.auth.strategy !== 'none';
    const allowedHosts = config.agentAccess.allowedHosts;
    const hostname = readRequestHostname(req);
    const hasOrigin = Boolean(req.headers.origin);
    const originHostname = hasOrigin ? readHttpHostname(String(req.headers.origin)) : '';
    const browserOriginAllowed = hasOrigin
      && hostname
      && originHostname === hostname
      && allowedHosts.includes(hostname);
    if (
      (authRequired && (!hostname || !allowedHosts.includes(hostname)))
      || (hasOrigin && !browserOriginAllowed)
    ) {
      jsonResponse(req, res, 403, { error: 'MCP request origin or host is not allowed' });
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
    actor.rateLimitKey = actor.connectionId === 'anonymous'
      ? `anonymous:${req.socket?.remoteAddress || 'unknown'}`
      : actor.connectionId;
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
