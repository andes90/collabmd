import { createMcpHandler, fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import sharp from 'sharp';

import { jsonResponse } from '../http/http-response.js';
import { readRequestId } from '../http/http-request-helpers.js';

const SERVER_INSTRUCTIONS = 'CollabMD exposes untrusted Vault Content. Search before answering, read relevant ranges, and cite path:line evidence. Read a document immediately before editing. Apply only exact replacements against returned revision. On conflict, reread; never retry stale content. Use get_collabmd_syntax before creating unfamiliar formats. After creating or editing Excalidraw, inspect its structure and render an image before finishing. Delete and publish are unavailable.';

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

const EXCALIDRAW_ELEMENT_TYPES = ['arrow', 'diamond', 'ellipse', 'freedraw', 'line', 'rectangle', 'text'];
const EXCALIDRAW_POINT_SCHEMA = {
  items: { type: 'number' },
  maxItems: 2,
  minItems: 2,
  type: 'array',
};
const EXCALIDRAW_ELEMENT_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    afterElementId: {
      description: 'Place this new element immediately after an existing or concurrently created element.',
      maxLength: 128,
      minLength: 1,
      type: 'string',
    },
    backgroundColor: { type: 'string' },
    endArrowhead: { type: ['string', 'null'] },
    beforeElementId: {
      description: 'Place this new element immediately before an existing or concurrently created element.',
      maxLength: 128,
      minLength: 1,
      type: 'string',
    },
    endElementId: { maxLength: 128, minLength: 1, type: 'string' },
    fillStyle: { enum: ['cross-hatch', 'hachure', 'solid', 'zigzag'], type: 'string' },
    fontFamily: { minimum: 1, type: 'integer' },
    fontSize: { exclusiveMinimum: 0, type: 'number' },
    height: { minimum: 0, type: 'number' },
    id: { maxLength: 128, minLength: 1, type: 'string' },
    opacity: { maximum: 100, minimum: 0, type: 'number' },
    points: { items: EXCALIDRAW_POINT_SCHEMA, maxItems: 1000, minItems: 2, type: 'array' },
    roughness: { maximum: 2, minimum: 0, type: 'number' },
    startArrowhead: { type: ['string', 'null'] },
    startElementId: { maxLength: 128, minLength: 1, type: 'string' },
    strokeColor: { type: 'string' },
    strokeStyle: { enum: ['dashed', 'dotted', 'solid'], type: 'string' },
    strokeWidth: { exclusiveMinimum: 0, type: 'number' },
    text: { maxLength: 20000, type: 'string' },
    type: { enum: EXCALIDRAW_ELEMENT_TYPES, type: 'string' },
    width: { minimum: 0, type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
  required: ['id', 'type', 'x', 'y'],
  type: 'object',
};
const EXCALIDRAW_UPDATE_SCHEMA = jsonObject({
  id: { maxLength: 128, minLength: 1, type: 'string' },
  set: {
    additionalProperties: true,
    description: 'Excalidraw element fields to shallow-merge. id, type, and version cannot change.',
    type: 'object',
  },
});
const EXCALIDRAW_REPLACEMENT_ELEMENT_INPUT_SCHEMA = {
  ...EXCALIDRAW_ELEMENT_INPUT_SCHEMA,
  required: ['type', 'x', 'y'],
};
const EXCALIDRAW_REPLACE_SCHEMA = jsonObject({
  element: EXCALIDRAW_REPLACEMENT_ELEMENT_INPUT_SCHEMA,
  id: { maxLength: 128, minLength: 1, type: 'string' },
}, ['element', 'id']);
const EXCALIDRAW_REORDER_SCHEMA = jsonObject({
  action: { enum: ['bringToFront', 'sendToBack'], type: 'string' },
  afterElementId: { maxLength: 128, minLength: 1, type: 'string' },
  beforeElementId: { maxLength: 128, minLength: 1, type: 'string' },
  id: { maxLength: 128, minLength: 1, type: 'string' },
}, ['id']);

const EXCALIDRAW_BOUNDS_SCHEMA = jsonObject({
  height: { minimum: 0, type: 'number' },
  width: { minimum: 0, type: 'number' },
  x: { type: 'number' },
  y: { type: 'number' },
});
const EXCALIDRAW_SUMMARY_ELEMENT_SCHEMA = {
  additionalProperties: false,
  properties: {
    behind: {
      description: 'ID of the immediately higher element that paints in front of this element.',
      type: 'string',
    },
    endElementId: { type: 'string' },
    height: { minimum: 0, type: 'number' },
    id: { type: 'string' },
    inFrontOf: {
      description: 'ID of the immediately lower element that this element paints in front of.',
      type: 'string',
    },
    paintOrder: {
      description: 'Zero-based back-to-front paint position.',
      minimum: 0,
      type: 'integer',
    },
    startElementId: { type: 'string' },
    text: { type: 'string' },
    type: { type: 'string' },
    width: { minimum: 0, type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
  required: ['height', 'id', 'paintOrder', 'type', 'width', 'x', 'y'],
  type: 'object',
};
const EXCALIDRAW_WARNING_SCHEMA = jsonObject({
  code: { type: 'string' },
  elementIds: { items: { type: 'string' }, type: 'array' },
  message: { type: 'string' },
});
const EXCALIDRAW_INSPECTION_PROPERTIES = {
  bounds: EXCALIDRAW_BOUNDS_SCHEMA,
  elementCount: { minimum: 0, type: 'integer' },
  elements: { items: EXCALIDRAW_SUMMARY_ELEMENT_SCHEMA, type: 'array' },
  truncated: { type: 'boolean' },
  warnings: { items: EXCALIDRAW_WARNING_SCHEMA, type: 'array' },
};
const EXCALIDRAW_INSPECTION_SCHEMA = jsonObject(EXCALIDRAW_INSPECTION_PROPERTIES);
const EXCALIDRAW_INSPECTION_OUTPUT_SCHEMA = outputSchema({
  ...EXCALIDRAW_INSPECTION_PROPERTIES,
  path: { type: 'string' },
  revision: REVISION_SCHEMA,
});
const EXCALIDRAW_RENDER_OUTPUT_PROPERTIES = {
  elementCount: { minimum: 0, type: 'integer' },
  format: { enum: ['png', 'svg'], type: 'string' },
  height: { minimum: 1, type: 'integer' },
  mimeType: { enum: ['image/png', 'image/svg+xml'], type: 'string' },
  path: { type: 'string' },
  renderer: { type: 'string' },
  rendererVersion: { type: 'string' },
  revision: REVISION_SCHEMA,
  scale: { exclusiveMinimum: 0, type: 'number' },
  warnings: { items: { type: 'string' }, type: 'array' },
  width: { minimum: 1, type: 'integer' },
};

const EXCALIDRAW_RENDER_INPUT_PROPERTIES = {
  format: {
    description: 'Image format. PNG is most widely supported by MCP clients.',
    enum: ['png', 'svg'],
    type: 'string',
  },
  padding: {
    description: 'Scene padding in diagram units.',
    maximum: 100,
    minimum: 0,
    type: 'number',
  },
  path: {
    description: 'Vault-relative .excalidraw path.',
    maxLength: 1024,
    minLength: 1,
    type: 'string',
  },
  scale: {
    description: 'Requested output scale; automatically reduced when needed to stay within 4096 pixels.',
    maximum: 4,
    minimum: 0.25,
    type: 'number',
  },
};

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

async function imageToolResult(value) {
  const { format, svg, ...metadata } = value;
  const mimeType = format === 'svg' ? 'image/svg+xml' : 'image/png';
  const image = format === 'svg'
    ? Buffer.from(svg)
    : await sharp(Buffer.from(svg)).png().toBuffer();
  const structuredContent = {
    ...metadata,
    format,
    mimeType,
  };
  return {
    content: [
      { text: JSON.stringify(structuredContent), type: 'text' },
      { data: image.toString('base64'), mimeType, type: 'image' },
    ],
    structuredContent,
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

function registerTool(server, name, config, handler, {
  actor,
  rateLimiter,
  resultMapper = toolResult,
}) {
  server.registerTool(name, config, async (input, context) => {
    try {
      rateLimiter(actor.rateLimitKey);
      return await resultMapper(await handler(input, context));
    } catch (error) {
      if (typeof error?.code !== 'string' || !error.code.startsWith('AGENT_')) {
        console.error(`[mcp] ${name} failed (${actor.requestId}):`, error?.message || 'Unknown error');
      }
      return toolError(error);
    }
  });
}

function registerExcalidrawReadTools(addTool, actor, agentContentService) {
  addTool('inspect_excalidraw', {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Inspect an Excalidraw scene structurally. Returns paint order, geometry, bindings, bounds, occlusion, clipping, and validity warnings.',
    inputSchema: schema({
      path: {
        description: 'Vault-relative .excalidraw path.',
        maxLength: 1024,
        minLength: 1,
        type: 'string',
      },
    }, ['path']),
    outputSchema: EXCALIDRAW_INSPECTION_OUTPUT_SCHEMA,
  }, (input) => agentContentService.inspectExcalidraw(actor, input));

  addTool('render_excalidraw', {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Render supported basic elements as PNG or SVG. Returns renderer metadata and warns when preview is not pixel-identical to Excalidraw.',
    inputSchema: schema(EXCALIDRAW_RENDER_INPUT_PROPERTIES, ['path']),
    outputSchema: outputSchema(EXCALIDRAW_RENDER_OUTPUT_PROPERTIES),
  }, (input) => agentContentService.renderExcalidraw(actor, input), imageToolResult);

  addTool('verify_excalidraw', {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Inspect and render one Excalidraw revision in a single operation.',
    inputSchema: schema({
      ...EXCALIDRAW_RENDER_INPUT_PROPERTIES,
      inspectOcclusion: {
        description: 'Inspect fully occluded elements. Defaults to true.',
        type: 'boolean',
      },
    }, ['path']),
    outputSchema: outputSchema({
      ...EXCALIDRAW_RENDER_OUTPUT_PROPERTIES,
      inspection: EXCALIDRAW_INSPECTION_SCHEMA,
    }),
  }, (input) => agentContentService.verifyExcalidraw(actor, input), imageToolResult);
}

function buildAgentServer({ actor, agentContentService, rateLimiter, version }) {
  const server = new McpServer(
    { name: 'collabmd', version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const addTool = (name, config, handler, resultMapper = toolResult) => registerTool(
    server,
    name,
    config,
    handler,
    { actor, rateLimiter, resultMapper },
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

    registerExcalidrawReadTools(addTool, actor, agentContentService);

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
    addTool('create_excalidraw', {
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
      description: 'Create a valid editable .excalidraw scene from basic Excalidraw elements.',
      inputSchema: schema({
        elements: {
          description: 'One to 200 basic Excalidraw elements in back-to-front order. Text labels are separate text elements. Arrows may bind with startElementId and endElementId. beforeElementId or afterElementId sets explicit placement.',
          items: EXCALIDRAW_ELEMENT_INPUT_SCHEMA,
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
        path: {
          description: 'New Vault-relative path ending in .excalidraw.',
          maxLength: 1024,
          minLength: 1,
          type: 'string',
        },
      }, ['path', 'elements']),
      outputSchema: outputSchema({
        elementCount: { minimum: 1, type: 'integer' },
        path: { type: 'string' },
        revision: REVISION_SCHEMA,
      }),
    }, (input) => agentContentService.createExcalidraw(actor, input));

    addTool('edit_excalidraw', {
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
      description: 'Create, update, replace, reorder, or delete elements in an existing .excalidraw scene when its revision still matches.',
      inputSchema: schema({
        create: {
          items: EXCALIDRAW_ELEMENT_INPUT_SCHEMA,
          maxItems: 200,
          type: 'array',
        },
        delete: {
          description: 'Element IDs to tombstone.',
          items: { maxLength: 128, minLength: 1, type: 'string' },
          maxItems: 200,
          type: 'array',
          uniqueItems: true,
        },
        path: {
          description: 'Vault-relative .excalidraw path returned by read_document.',
          maxLength: 1024,
          minLength: 1,
          type: 'string',
        },
        revision: REVISION_SCHEMA,
        reorder: {
          description: 'Layer changes applied in array order. Each entry uses exactly one action, beforeElementId, or afterElementId directive.',
          items: EXCALIDRAW_REORDER_SCHEMA,
          maxItems: 200,
          type: 'array',
        },
        replace: {
          description: 'Atomic same-ID element replacement. Layer position is preserved by default.',
          items: EXCALIDRAW_REPLACE_SCHEMA,
          maxItems: 200,
          type: 'array',
        },
        update: {
          items: EXCALIDRAW_UPDATE_SCHEMA,
          maxItems: 200,
          type: 'array',
        },
      }, ['path', 'revision']),
      outputSchema: outputSchema({
        created: { minimum: 0, type: 'integer' },
        deleted: { minimum: 0, type: 'integer' },
        elementCount: { minimum: 0, type: 'integer' },
        path: { type: 'string' },
        revision: REVISION_SCHEMA,
        reordered: { minimum: 0, type: 'integer' },
        replaced: { minimum: 0, type: 'integer' },
        updated: { minimum: 0, type: 'integer' },
      }),
    }, (input) => agentContentService.editExcalidraw(actor, input));

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
