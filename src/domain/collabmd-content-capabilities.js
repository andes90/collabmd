import {
  BASE_FILE_EXTENSION,
  DRAWIO_FILE_EXTENSION,
  EXCALIDRAW_FILE_EXTENSION,
  HTML_FILE_EXTENSIONS,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MARKDOWN_FILE_EXTENSIONS,
  MERMAID_FILE_EXTENSIONS,
  PDF_FILE_EXTENSION,
  PLANTUML_FILE_EXTENSIONS,
  STRUCTURIZR_FILE_EXTENSIONS,
  getVaultFileKind,
  supportsCommentsForFilePath,
} from './file-kind.js';

const EXCALIDRAW_DESIGN_GUIDE = [
  'Plan: State the question the diagram answers, its audience, the essential entities, and what each connection means. Choose a flowchart for steps/decisions or a layered layout for responsibilities/dependencies. Keep one main idea per diagram; split dense detail into another diagram. Do not invent relationships to fill space.',
  'Layout: Choose left-to-right or top-to-bottom reading order. Place containers before labels and connectors. Align related nodes and use consistent sizes and gaps. As starting points, use 200 x 88 nodes, 80-120 units between columns, and 60-80 between rows; enlarge these for the actual text. Reserve clear connector lanes. Route arrows around unrelated shapes, minimize crossings, and make direction unambiguous. These are defaults, not constraints on an existing design.',
  'Labels and bindings: Prefer short entity names and verb phrases for relationships. Start around 20-unit body text and 28-unit titles, with one font family. Enlarge the container or add deliberate line breaks instead of shrinking text to fit. Create labels as separate text elements using containerId; creation still requires explicit x/y and correctly sized bounds. Bind connectors with startElementId/endElementId and set points relative to the arrow x/y, near the appropriate shape edges. Binding identifies the relationship; it does not plan the route. Allow padding around labels and keep relationship labels away from arrowheads.',
  'Visual hierarchy: Use a clear title, restrained strokes, and at most two or three semantic fill colors with readable dark labels on light fills. Use shape, position, or text as well as color to distinguish roles. Reuse colors for the same meaning. Give related elements groupIds when they should move together. Keep text above its container in paint order. Avoid decorative elements that compete with the information.',
  'Existing diagrams: In WebMCP, get active context first. Inspect the existing scene and preserve its style, IDs, layout, and unrelated elements. Use edit_excalidraw with the returned revision. Prefer translate for moving containers/groups and their related text; inspect attached connector routes after movement. Use reorder for paint order and same-ID replace for a type change. Bound-text placement normalization re-centers labels; use it only when that is intended. On a revision conflict, inspect again and reconsider the edit.',
  'Verify and refine: Create or edit with verify: { render: true } to receive inspection and an image for that exact revision. Check diagnostics for clipping, unintended overlaps, occlusion, text placement, and connectors crossing components. Examine the image for reading order, legibility, correct relationships, and clear arrow direction; structural validity alone does not establish visual quality. Fix concrete problems with revision-guarded edits and verify again. Use verify: { render: false } for intermediate create/edit checks when an image would add no information; use verify_excalidraw with render: true for the final image. Stop when the requested meaning is clear and no material layout issue remains; do not redraw solely to chase cosmetic variation.',
  'Rendering limits: Remote collabmd-basic-svg previews approximate Excalidraw and report preview-not-pixel-identical; WebMCP uses the official browser renderer. If an image is unavailable, report that visual quality was not checked instead of claiming it was verified.',
  'Examples below are complete MCP tools/call payloads using this server\'s schema. Choose a new Vault-relative path and adapt labels, geometry, and relationships. For WebMCP, call the corresponding collabmd_ tool with the arguments object. Reuse this guide during the task; fetching it before every edit is unnecessary.',
].join('\n\n');

const EXCALIDRAW_CREATION_EXAMPLES = [
  {
    name: 'create_excalidraw',
    arguments: {
      path: 'diagrams/request-flow.excalidraw',
      elements: [
        { id: 'title', type: 'text', x: 40, y: 32, text: 'Request review', fontSize: 28 },
        { id: 'request', type: 'rectangle', x: 40, y: 96, width: 200, height: 88, backgroundColor: '#e7f5ff' },
        { id: 'review', type: 'rectangle', x: 360, y: 96, width: 200, height: 88, backgroundColor: '#e7f5ff' },
        { id: 'respond', type: 'rectangle', x: 680, y: 96, width: 200, height: 88, backgroundColor: '#e7f5ff' },
        { id: 'request-label', type: 'text', x: 98, y: 127.5, text: 'Request', containerId: 'request' },
        { id: 'review-label', type: 'text', x: 424, y: 127.5, text: 'Review', containerId: 'review' },
        { id: 'respond-label', type: 'text', x: 738, y: 127.5, text: 'Respond', containerId: 'respond' },
        { id: 'request-review', type: 'arrow', x: 244, y: 140, points: [[0, 0], [112, 0]], startElementId: 'request', endElementId: 'review' },
        { id: 'review-respond', type: 'arrow', x: 564, y: 140, points: [[0, 0], [112, 0]], startElementId: 'review', endElementId: 'respond' },
      ],
      verify: { render: true },
    },
  },
  {
    name: 'create_excalidraw',
    arguments: {
      path: 'diagrams/service-layers.excalidraw',
      elements: [
        { id: 'title', type: 'text', x: 40, y: 32, text: 'Service layers', fontSize: 28 },
        { id: 'presentation', type: 'rectangle', x: 40, y: 96, width: 360, height: 96, backgroundColor: '#e7f5ff' },
        { id: 'application', type: 'rectangle', x: 40, y: 256, width: 360, height: 96, backgroundColor: '#e7f5ff' },
        { id: 'storage', type: 'rectangle', x: 40, y: 416, width: 360, height: 96, backgroundColor: '#e7f5ff' },
        { id: 'presentation-label', type: 'text', x: 148, y: 131.5, text: 'Presentation', containerId: 'presentation' },
        { id: 'application-label', type: 'text', x: 154, y: 291.5, text: 'Application', containerId: 'application' },
        { id: 'storage-label', type: 'text', x: 178, y: 451.5, text: 'Storage', containerId: 'storage' },
        { id: 'presentation-application', type: 'arrow', x: 220, y: 196, points: [[0, 0], [0, 56]], startElementId: 'presentation', endElementId: 'application' },
        { id: 'application-storage', type: 'arrow', x: 220, y: 356, points: [[0, 0], [0, 56]], startElementId: 'application', endElementId: 'storage' },
      ],
      verify: { render: true },
    },
  },
].map((example) => JSON.stringify(example));

const CAPABILITIES = Object.freeze({
  base: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [BASE_FILE_EXTENSION],
    guide: 'YAML Base definition. Embed a file with ![[query.base]] or an inline query with a fenced base block. Create and edit with create_document and apply_text_edits. After writing, use query_base to inspect filtered rows.',
    examples: ['```base\nfilters:\n  and: []\n```', '![[tasks.base]]'],
  },
  drawio: {
    agentCreatable: false,
    agentEditable: false,
    editable: true,
    extensions: [DRAWIO_FILE_EXTENSION],
    guide: 'diagrams.net XML managed by the embedded draw.io editor. Embed with ![[architecture.drawio]]. Agent writes are disabled.',
    examples: ['![[architecture.drawio]]'],
  },
  excalidraw: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [EXCALIDRAW_FILE_EXTENSION],
    guide: 'Excalidraw scene JSON managed by the canvas editor. Use create_excalidraw and edit_excalidraw rather than raw text edits. Element order is back-to-front; create supports beforeElementId and afterElementId, while edit supports relationship-aware translation, reorder, same-ID replacement, and bound-text placement normalization. Container or group translation also moves bound text and grouped members. Standalone auto-resizing text recalculates its bounds when text metrics change; bound text whose font, size, line height, or content changes is re-centered and remeasured vertically. Line, arrow, and freedraw dimensions are derived from points. Creation and editing support inline inspection and optional rendering; verify_excalidraw can return compact layout diagnostics without an image. Remote fallback renders report preview-not-pixel-identical. Supported agent element types: rectangle, ellipse, diamond, text, arrow, line, and freedraw. Embed with ![[drawing.excalidraw]].',
    examples: ['![[drawing.excalidraw]]'],
  },
  html: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [...HTML_FILE_EXTENSIONS],
    guide: 'Standalone HTML file. Raw HTML inside Markdown is escaped; use a standalone .html or .htm file when HTML is required.',
    examples: ['<!doctype html>\n<html lang="en"><body><h1>Title</h1></body></html>'],
  },
  image: {
    agentCreatable: false,
    agentEditable: false,
    editable: false,
    extensions: [...IMAGE_ATTACHMENT_EXTENSIONS],
    guide: 'Binary or SVG attachment. Reference from Markdown with a relative image path. Use attachment upload rather than create_document.',
    examples: ['![Diagram](assets/diagram.png)'],
  },
  markdown: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [...MARKDOWN_FILE_EXTENSIONS],
    guide: 'Markdown-it syntax with YAML frontmatter, headings, tables, task lists, fenced code, linkified URLs, [[wiki-links]], aliases, and embeds. Use $...$ for inline math and $$...$$ on its own lines for display math (KaTeX). Use ![[file.ext]] for Base, draw.io, Excalidraw, Mermaid, or PlantUML Vault embeds. Use ![Label](https://...) for public video embeds: valid YouTube URLs or direct public HTTPS URLs ending in .mp4, .webm, or .ogg. Use relative Markdown image paths for Vault image attachments. Raw HTML is disabled.',
    examples: [
      '---\ntags: [docs]\n---\n# Title\n\n- [ ] Task\n\n[[Other Note|Alias]]',
      '![[diagram.mmd]]\n![[diagram.puml]]\n![[drawing.excalidraw]]\n![[architecture.drawio]]\n![[query.base]]',
      '![Demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n![Demo](https://cdn.example.com/demo.webm)\n![Diagram](assets/diagram.png)',
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```',
      'Inline math $E = mc^2$ and display math:\n\n$$\n\\frac{a}{b}\n$$',
    ],
  },
  mermaid: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [...MERMAID_FILE_EXTENSIONS],
    guide: 'Standalone Mermaid source. Markdown also supports fenced mermaid blocks and ![[diagram.mmd]] embeds.',
    examples: ['flowchart LR\n  A[Start] --> B[Done]'],
  },
  pdf: {
    agentCreatable: false,
    agentEditable: false,
    editable: false,
    extensions: [PDF_FILE_EXTENSION],
    guide: 'Readonly PDF Vault Content. Agent text tools do not read or write PDF bytes.',
    examples: [],
  },
  plantuml: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [...PLANTUML_FILE_EXTENSIONS],
    guide: 'Standalone PlantUML source, normally enclosed by @startuml and @enduml. Markdown supports plantuml or puml fences and ![[diagram.puml]] embeds.',
    examples: ['@startuml\nAlice -> Bob : Hello\n@enduml'],
  },
  structurizr: {
    agentCreatable: true,
    agentEditable: true,
    editable: true,
    extensions: [...STRUCTURIZR_FILE_EXTENSIONS],
    guide: 'Structurizr DSL C4 workspace. Preview requires configured Structurizr renderer.',
    examples: ['workspace {\n  model {\n    user = person "User"\n    system = softwareSystem "System"\n    user -> system "Uses"\n  }\n  views { systemContext system { include * } }\n}'],
  },
});

function resolveKind(kindOrPath) {
  const normalized = String(kindOrPath ?? '').trim().toLowerCase();
  return Object.hasOwn(CAPABILITIES, normalized) ? normalized : getVaultFileKind(normalized);
}

export function getCollabMdContentCapability(kindOrPath) {
  const kind = resolveKind(kindOrPath);
  if (!kind || !CAPABILITIES[kind]) return null;
  const capability = CAPABILITIES[kind];
  const commentPath = capability.extensions[0] ? `file${capability.extensions[0]}` : '';
  return {
    ...capability,
    commentsSupported: commentPath ? supportsCommentsForFilePath(commentPath) : false,
    kind,
    readable: capability.editable,
    searchable: kind !== 'image' && kind !== 'pdf',
  };
}

export function listCollabMdContentCapabilities() {
  return Object.keys(CAPABILITIES).map(getCollabMdContentCapability);
}

export function getCollabMdSyntaxGuide(kind) {
  const capability = getCollabMdContentCapability(kind);
  return capability ? {
    examples: capability.kind === 'excalidraw'
      ? [...EXCALIDRAW_CREATION_EXAMPLES, ...capability.examples]
      : capability.examples,
    extensions: capability.extensions,
    guide: capability.kind === 'excalidraw'
      ? `${capability.guide}\n\n${EXCALIDRAW_DESIGN_GUIDE}`
      : capability.guide,
    kind: capability.kind,
  } : null;
}

export function isAgentReadablePath(path) {
  return Boolean(getCollabMdContentCapability(path)?.readable);
}

export function isAgentEditablePath(path) {
  const capability = getCollabMdContentCapability(path);
  return Boolean(capability?.agentEditable && capability.kind !== 'excalidraw');
}

export function isAgentCreatablePath(path) {
  const capability = getCollabMdContentCapability(path);
  return Boolean(capability?.agentCreatable && capability.kind !== 'excalidraw');
}
