function objectSchema(properties = {}, required = Object.keys(properties)) {
  return { additionalProperties: false, properties, required, type: 'object' };
}

const REVISION_SCHEMA = {
  description: 'Lowercase SHA-256 revision returned by read_document.',
  pattern: '^[a-f0-9]{64}$',
  type: 'string',
};

const DOCUMENT_SCHEMA = objectSchema({
  kind: { type: 'string' },
  mtimeMs: { minimum: 0, type: 'number' },
  path: { type: 'string' },
  size: { minimum: 0, type: 'number' },
});

const SEARCH_SNIPPET_SCHEMA = objectSchema({
  column: { minimum: 1, type: 'integer' },
  line: { minimum: 1, type: 'integer' },
  matchEnd: { minimum: 0, type: 'integer' },
  matchStart: { minimum: 0, type: 'integer' },
  text: { type: 'string' },
});

const SEARCH_FILE_SCHEMA = objectSchema({
  file: { type: 'string' },
  kind: { type: 'string' },
  matchCount: { minimum: 0, type: 'integer' },
  snippets: { items: SEARCH_SNIPPET_SCHEMA, type: 'array' },
  truncated: { type: 'boolean' },
});

const SYNTAX_GUIDE_SCHEMA = objectSchema({
  examples: { items: { type: 'string' }, type: 'array' },
  extensions: { items: { type: 'string' }, type: 'array' },
  guide: { type: 'string' },
  kind: { type: 'string' },
});

const CAPABILITY_SCHEMA = objectSchema({
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
    autoResize: { type: 'boolean' },
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
    containerId: { maxLength: 128, minLength: 1, type: ['string', 'null'] },
    endElementId: { maxLength: 128, minLength: 1, type: 'string' },
    fillStyle: { enum: ['cross-hatch', 'hachure', 'solid', 'zigzag'], type: 'string' },
    fontFamily: { minimum: 1, type: 'integer' },
    fontSize: { exclusiveMinimum: 0, type: 'number' },
    lineHeight: { exclusiveMinimum: 0, type: 'number' },
    groupIds: {
      items: { maxLength: 128, minLength: 1, type: 'string' },
      maxItems: 20,
      type: 'array',
      uniqueItems: true,
    },
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
const EXCALIDRAW_UPDATE_SCHEMA = objectSchema({
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
const EXCALIDRAW_REPLACE_SCHEMA = objectSchema({
  element: EXCALIDRAW_REPLACEMENT_ELEMENT_INPUT_SCHEMA,
  id: { maxLength: 128, minLength: 1, type: 'string' },
}, ['element', 'id']);
const EXCALIDRAW_REORDER_SCHEMA = objectSchema({
  action: { enum: ['bringToFront', 'sendToBack'], type: 'string' },
  afterElementId: { maxLength: 128, minLength: 1, type: 'string' },
  beforeElementId: { maxLength: 128, minLength: 1, type: 'string' },
  id: { maxLength: 128, minLength: 1, type: 'string' },
}, ['id']);
const EXCALIDRAW_TRANSLATE_SCHEMA = objectSchema({
  dx: { type: 'number' },
  dy: { type: 'number' },
  ids: {
    description: 'Requested targets. Bound text, its container, and all members of referenced groups move atomically.',
    items: { maxLength: 128, minLength: 1, type: 'string' },
    maxItems: 200,
    minItems: 1,
    type: 'array',
    uniqueItems: true,
  },
});
const EXCALIDRAW_BOUNDS_SCHEMA = objectSchema({
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
    containerId: { type: 'string' },
    fontSize: { exclusiveMinimum: 0, type: 'number' },
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
    lineHeight: { exclusiveMinimum: 0, type: 'number' },
    startElementId: { type: 'string' },
    text: { type: 'string' },
    textAlign: { type: 'string' },
    type: { type: 'string' },
    verticalAlign: { type: 'string' },
    width: { minimum: 0, type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
  required: ['height', 'id', 'paintOrder', 'type', 'width', 'x', 'y'],
  type: 'object',
};
const EXCALIDRAW_WARNING_SCHEMA = objectSchema({
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
const EXCALIDRAW_INSPECTION_SCHEMA = objectSchema(EXCALIDRAW_INSPECTION_PROPERTIES);
const EXCALIDRAW_INSPECTION_OUTPUT_SCHEMA = objectSchema({
  ...EXCALIDRAW_INSPECTION_PROPERTIES,
  path: { type: 'string' },
  revision: REVISION_SCHEMA,
});
const EXCALIDRAW_RENDER_RESULT_PROPERTIES = {
  elementCount: { minimum: 0, type: 'integer' },
  format: { enum: ['png', 'svg'], type: 'string' },
  height: { minimum: 1, type: 'integer' },
  mimeType: { enum: ['image/png', 'image/svg+xml'], type: 'string' },
  renderer: { type: 'string' },
  rendererVersion: { type: 'string' },
  scale: { exclusiveMinimum: 0, type: 'number' },
  warnings: { items: { type: 'string' }, type: 'array' },
  width: { minimum: 1, type: 'integer' },
};
const EXCALIDRAW_RENDER_OUTPUT_PROPERTIES = {
  ...EXCALIDRAW_RENDER_RESULT_PROPERTIES,
  path: { type: 'string' },
  revision: REVISION_SCHEMA,
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
const EXCALIDRAW_INLINE_VERIFY_INPUT_SCHEMA = objectSchema({
  format: EXCALIDRAW_RENDER_INPUT_PROPERTIES.format,
  inspectOcclusion: {
    description: 'Inspect fully occluded elements. Defaults to true.',
    type: 'boolean',
  },
  padding: EXCALIDRAW_RENDER_INPUT_PROPERTIES.padding,
  render: {
    description: 'Also return an image rendered from the exact created or edited revision.',
    type: 'boolean',
  },
  scale: EXCALIDRAW_RENDER_INPUT_PROPERTIES.scale,
}, []);
const EXCALIDRAW_INLINE_VERIFICATION_SCHEMA = objectSchema({
  inspection: EXCALIDRAW_INSPECTION_SCHEMA,
  ...EXCALIDRAW_RENDER_RESULT_PROPERTIES,
}, ['inspection']);

export const AGENT_TOOL_DEFINITIONS = Object.freeze([
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'List readable CollabMD Vault documents by path and kind.',
    inputSchema: objectSchema({
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
    }, []),
    method: 'listDocuments',
    name: 'list_documents',
    outputSchema: objectSchema({
      documents: { items: DOCUMENT_SCHEMA, type: 'array' },
      nextCursor: { type: ['string', 'null'] },
      truncated: { type: 'boolean' },
    }),
    scope: 'vault:read',
    untrustedContentHint: true,
    webMcp: true,
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Search current Vault text with one fixed case-insensitive term. Returns path and line evidence.',
    inputSchema: objectSchema({
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
    method: 'searchVault',
    name: 'search_vault',
    outputSchema: objectSchema({
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
    scope: 'vault:read',
    untrustedContentHint: true,
    webMcp: true,
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Read a current CollabMD document range and return full-document revision for citations and edits.',
    inputSchema: objectSchema({
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
    method: 'readDocument',
    name: 'read_document',
    outputSchema: objectSchema({
      content: { type: 'string' },
      endLine: { minimum: 1, type: 'integer' },
      kind: { type: 'string' },
      path: { type: 'string' },
      revision: REVISION_SCHEMA,
      startLine: { minimum: 1, type: 'integer' },
      totalLines: { minimum: 1, type: 'integer' },
      truncated: { type: 'boolean' },
    }),
    scope: 'vault:read',
    untrustedContentHint: true,
    webMcp: true,
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Inspect an Excalidraw scene structurally. Returns paint order, geometry, bindings, bounds, occlusion, clipping, and validity warnings.',
    inputSchema: objectSchema({
      path: {
        description: 'Vault-relative .excalidraw path.',
        maxLength: 1024,
        minLength: 1,
        type: 'string',
      },
    }, ['path']),
    method: 'inspectExcalidraw',
    name: 'inspect_excalidraw',
    outputSchema: EXCALIDRAW_INSPECTION_OUTPUT_SCHEMA,
    scope: 'vault:read',
    untrustedContentHint: true,
    webMcp: true,
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Render supported basic elements as PNG or SVG. Returns renderer metadata and warns when preview is not pixel-identical to Excalidraw.',
    inputSchema: objectSchema(EXCALIDRAW_RENDER_INPUT_PROPERTIES, ['path']),
    method: 'renderExcalidraw',
    name: 'render_excalidraw',
    outputSchema: objectSchema(EXCALIDRAW_RENDER_OUTPUT_PROPERTIES),
    resultKind: 'image',
    scope: 'vault:read',
    untrustedContentHint: true,
    webMcp: true,
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Inspect and render one Excalidraw revision in a single operation.',
    inputSchema: objectSchema({
      ...EXCALIDRAW_RENDER_INPUT_PROPERTIES,
      inspectOcclusion: {
        description: 'Inspect fully occluded elements. Defaults to true.',
        type: 'boolean',
      },
    }, ['path']),
    method: 'verifyExcalidraw',
    name: 'verify_excalidraw',
    outputSchema: objectSchema({
      ...EXCALIDRAW_RENDER_OUTPUT_PROPERTIES,
      inspection: EXCALIDRAW_INSPECTION_SCHEMA,
    }),
    resultKind: 'image',
    scope: 'vault:read',
    untrustedContentHint: true,
    webMcp: true,
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description: 'Describe CollabMD-supported content kinds, extensions, syntax, and agent write support.',
    inputSchema: objectSchema({
      kind: {
        description: 'Optional content kind. Omit to list all capabilities.',
        type: 'string',
      },
    }, []),
    method: 'getSyntax',
    name: 'get_collabmd_syntax',
    outputSchema: {
      oneOf: [
        objectSchema({ capabilities: { items: CAPABILITY_SCHEMA, type: 'array' } }),
        SYNTAX_GUIDE_SCHEMA,
      ],
    },
    scope: 'vault:read',
    webMcp: true,
  },
  {
    annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
    description: 'Create a valid editable .excalidraw scene from basic Excalidraw elements, with optional same-revision verification.',
    inputSchema: objectSchema({
      elements: {
        description: 'One to 200 basic Excalidraw elements in back-to-front order. Text may bind to a container with containerId; groupIds define atomic movement groups. Arrows may bind with startElementId and endElementId. beforeElementId or afterElementId sets explicit placement.',
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
      verify: EXCALIDRAW_INLINE_VERIFY_INPUT_SCHEMA,
    }, ['path', 'elements']),
    method: 'createExcalidraw',
    name: 'create_excalidraw',
    outputSchema: objectSchema({
      elementCount: { minimum: 1, type: 'integer' },
      path: { type: 'string' },
      revision: REVISION_SCHEMA,
      verification: EXCALIDRAW_INLINE_VERIFICATION_SCHEMA,
    }),
    resultKind: 'optional-image',
    scope: 'vault:edit',
    webMcp: true,
  },
  {
    annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
    description: 'Create, update, replace, translate, reorder, or delete elements in an existing .excalidraw scene when its revision still matches.',
    inputSchema: objectSchema({
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
      translate: EXCALIDRAW_TRANSLATE_SCHEMA,
      verify: EXCALIDRAW_INLINE_VERIFY_INPUT_SCHEMA,
    }, ['path', 'revision']),
    method: 'editExcalidraw',
    name: 'edit_excalidraw',
    outputSchema: objectSchema({
      created: { minimum: 0, type: 'integer' },
      deleted: { minimum: 0, type: 'integer' },
      elementCount: { minimum: 0, type: 'integer' },
      path: { type: 'string' },
      reordered: { minimum: 0, type: 'integer' },
      replaced: { minimum: 0, type: 'integer' },
      revision: REVISION_SCHEMA,
      translated: {
        description: 'Number of explicitly requested translation targets; related bound or grouped elements may also move.',
        minimum: 0,
        type: 'integer',
      },
      updated: { minimum: 0, type: 'integer' },
      verification: EXCALIDRAW_INLINE_VERIFICATION_SCHEMA,
    }, ['created', 'deleted', 'elementCount', 'path', 'reordered', 'replaced', 'revision', 'translated', 'updated']),
    resultKind: 'optional-image',
    scope: 'vault:edit',
    webMcp: true,
  },
  {
    annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
    description: 'Apply bounded exact replacements to a document only when its revision still matches.',
    inputSchema: objectSchema({
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
    method: 'applyTextEdits',
    name: 'apply_text_edits',
    outputSchema: objectSchema({
      path: { type: 'string' },
      replacementCount: { minimum: 1, type: 'integer' },
      revision: REVISION_SCHEMA,
    }),
    scope: 'vault:edit',
    webMcp: true,
  },
  {
    annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
    description: 'Create a new supported CollabMD text document. Fails when path already exists.',
    inputSchema: objectSchema({
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
    method: 'createDocument',
    name: 'create_document',
    outputSchema: objectSchema({
      kind: { type: 'string' },
      path: { type: 'string' },
      revision: REVISION_SCHEMA,
    }),
    scope: 'vault:edit',
    webMcp: true,
  },
]);

const DEFINITIONS_BY_NAME = new Map(AGENT_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

export function getAgentToolDefinition(name) {
  return DEFINITIONS_BY_NAME.get(name) ?? null;
}

export function listAgentToolDefinitions(scopes = []) {
  const allowed = new Set(scopes);
  return AGENT_TOOL_DEFINITIONS.filter(({ scope }) => allowed.has(scope));
}

export function listWebMcpToolDefinitions() {
  return AGENT_TOOL_DEFINITIONS.filter(({ webMcp }) => webMcp);
}

export function toWebMcpToolName(name) {
  return `collabmd_${name}`;
}
