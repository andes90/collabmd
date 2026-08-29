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

const CAPABILITIES = Object.freeze({
  base: {
    agentCreatable: false,
    agentEditable: false,
    editable: true,
    extensions: [BASE_FILE_EXTENSION],
    guide: 'YAML Base definition. Embed a file with ![[query.base]] or an inline query with a fenced base block. Agent writes are disabled until Base validation is shared.',
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
    guide: 'Excalidraw scene JSON managed by the canvas editor. Use create_excalidraw and edit_excalidraw rather than raw text edits. Element order is back-to-front; create supports beforeElementId and afterElementId, while edit supports relationship-aware translation, reorder, same-ID replace, and same-revision verification. Container or group translation also moves bound text and grouped members. Standalone auto-resizing text recalculates its bounds when text metrics change. Line, arrow, and freedraw dimensions are derived from points. Creation and editing support inline inspection and optional rendering; remote fallback renders report preview-not-pixel-identical. Supported agent element types: rectangle, ellipse, diamond, text, arrow, line, and freedraw. Embed with ![[drawing.excalidraw]].',
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
    guide: 'Markdown-it syntax with YAML frontmatter, headings, tables, task lists, fenced code, linkified URLs, [[wiki-links]], aliases, and embeds. Use ![[file.ext]] for Base, draw.io, Excalidraw, Mermaid, or PlantUML Vault embeds. Use ![Label](https://...) for public video embeds: valid YouTube URLs or direct public HTTPS URLs ending in .mp4, .webm, or .ogg. Use relative Markdown image paths for Vault image attachments. Raw HTML is disabled.',
    examples: [
      '---\ntags: [docs]\n---\n# Title\n\n- [ ] Task\n\n[[Other Note|Alias]]',
      '![[diagram.mmd]]\n![[diagram.puml]]\n![[drawing.excalidraw]]\n![[architecture.drawio]]\n![[query.base]]',
      '![Demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n![Demo](https://cdn.example.com/demo.webm)\n![Diagram](assets/diagram.png)',
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```',
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
    examples: capability.examples,
    extensions: capability.extensions,
    guide: capability.guide,
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
