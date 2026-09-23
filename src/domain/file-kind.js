const MARKDOWN_FILE_EXTENSIONS = Object.freeze(['.md', '.markdown', '.mdx']);
const HTML_FILE_EXTENSIONS = Object.freeze(['.html', '.htm']);
const BASE_FILE_EXTENSION = '.base';
const CANVAS_FILE_EXTENSION = '.canvas';
const EXCALIDRAW_FILE_EXTENSION = '.excalidraw';
const DRAWIO_FILE_EXTENSION = '.drawio';
const MERMAID_FILE_EXTENSIONS = Object.freeze(['.mmd', '.mermaid']);
const PLANTUML_FILE_EXTENSIONS = Object.freeze(['.puml', '.plantuml']);
const STRUCTURIZR_FILE_EXTENSION = '.dsl';
const STRUCTURIZR_FILE_EXTENSIONS = Object.freeze([STRUCTURIZR_FILE_EXTENSION]);
const PDF_FILE_EXTENSION = '.pdf';
const IMAGE_ATTACHMENT_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const DIAGRAM_FILE_EXTENSIONS = Object.freeze([
  CANVAS_FILE_EXTENSION,
  EXCALIDRAW_FILE_EXTENSION,
  DRAWIO_FILE_EXTENSION,
  ...MERMAID_FILE_EXTENSIONS,
  ...PLANTUML_FILE_EXTENSIONS,
  ...STRUCTURIZR_FILE_EXTENSIONS,
]);
const VAULT_FILE_EXTENSIONS = Object.freeze([
  ...MARKDOWN_FILE_EXTENSIONS,
  ...HTML_FILE_EXTENSIONS,
  BASE_FILE_EXTENSION,
  ...DIAGRAM_FILE_EXTENSIONS,
  PDF_FILE_EXTENSION,
  ...IMAGE_ATTACHMENT_EXTENSIONS,
]);
const STRIP_VAULT_EXTENSION_PATTERN = /\.(?:md|markdown|mdx|html?|base|canvas|excalidraw|drawio|mmd|mermaid|puml|plantuml|dsl|pdf|png|jpe?g|webp|gif|svg)$/i;

function normalizeFilePath(filePath) {
  return String(filePath ?? '').trim().toLowerCase();
}

function hasFileExtension(filePath, extensions) {
  const normalized = normalizeFilePath(filePath);
  return extensions.some((extension) => normalized.endsWith(extension));
}

export {
  BASE_FILE_EXTENSION,
  CANVAS_FILE_EXTENSION,
  DIAGRAM_FILE_EXTENSIONS,
  DRAWIO_FILE_EXTENSION,
  EXCALIDRAW_FILE_EXTENSION,
  HTML_FILE_EXTENSIONS,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MARKDOWN_FILE_EXTENSIONS,
  MERMAID_FILE_EXTENSIONS,
  PDF_FILE_EXTENSION,
  PLANTUML_FILE_EXTENSIONS,
  STRUCTURIZR_FILE_EXTENSION,
  STRUCTURIZR_FILE_EXTENSIONS,
  VAULT_FILE_EXTENSIONS,
};

export function getVaultFileKind(filePath) {
  if (hasFileExtension(filePath, MARKDOWN_FILE_EXTENSIONS)) {
    return 'markdown';
  }

  if (hasFileExtension(filePath, HTML_FILE_EXTENSIONS)) {
    return 'html';
  }

  if (hasFileExtension(filePath, [BASE_FILE_EXTENSION])) {
    return 'base';
  }

  if (hasFileExtension(filePath, [CANVAS_FILE_EXTENSION])) {
    return 'canvas';
  }

  if (hasFileExtension(filePath, [EXCALIDRAW_FILE_EXTENSION])) {
    return 'excalidraw';
  }

  if (hasFileExtension(filePath, [DRAWIO_FILE_EXTENSION])) {
    return 'drawio';
  }

  if (hasFileExtension(filePath, MERMAID_FILE_EXTENSIONS)) {
    return 'mermaid';
  }

  if (hasFileExtension(filePath, PLANTUML_FILE_EXTENSIONS)) {
    return 'plantuml';
  }

  if (hasFileExtension(filePath, STRUCTURIZR_FILE_EXTENSIONS)) {
    return 'structurizr';
  }

  if (hasFileExtension(filePath, [PDF_FILE_EXTENSION])) {
    return 'pdf';
  }

  if (hasFileExtension(filePath, IMAGE_ATTACHMENT_EXTENSIONS)) {
    return 'image';
  }

  return null;
}

export function getVaultTreeNodeType(filePath) {
  const kind = getVaultFileKind(filePath);
  if (!kind) {
    return null;
  }

  if (kind === 'image') {
    return 'image';
  }

  if (kind === 'base') {
    return 'base';
  }

  return kind === 'markdown' ? 'file' : kind;
}

export function getVaultFileExtension(filePath) {
  const normalized = normalizeFilePath(filePath);
  return VAULT_FILE_EXTENSIONS.find((extension) => normalized.endsWith(extension)) ?? '';
}

export function isMarkdownFilePath(filePath) {
  return getVaultFileKind(filePath) === 'markdown';
}

export function isHtmlFilePath(filePath) {
  return getVaultFileKind(filePath) === 'html';
}

export function isExcalidrawFilePath(filePath) {
  return getVaultFileKind(filePath) === 'excalidraw';
}

export function isCanvasFilePath(filePath) {
  return getVaultFileKind(filePath) === 'canvas';
}

export function isBaseFilePath(filePath) {
  return getVaultFileKind(filePath) === 'base';
}

export function isMermaidFilePath(filePath) {
  return getVaultFileKind(filePath) === 'mermaid';
}

export function isDrawioFilePath(filePath) {
  return getVaultFileKind(filePath) === 'drawio';
}

export function isPlantUmlFilePath(filePath) {
  return getVaultFileKind(filePath) === 'plantuml';
}

export function isStructurizrFilePath(filePath) {
  return getVaultFileKind(filePath) === 'structurizr';
}

export function isPdfFilePath(filePath) {
  return getVaultFileKind(filePath) === 'pdf';
}

export function isImageAttachmentFilePath(filePath) {
  return getVaultFileKind(filePath) === 'image';
}

export function isDiagramFilePath(filePath) {
  const kind = getVaultFileKind(filePath);
  return kind === 'excalidraw'
    || kind === 'canvas'
    || kind === 'drawio'
    || kind === 'mermaid'
    || kind === 'plantuml'
    || kind === 'structurizr';
}

export function isVaultFilePath(filePath) {
  return getVaultFileKind(filePath) !== null;
}

export function supportsCommentsForFilePath(filePath) {
  const kind = getVaultFileKind(filePath);
  return kind === 'markdown'
    || kind === 'mermaid'
    || kind === 'plantuml'
    || kind === 'structurizr'
    || kind === 'excalidraw';
}

export function supportsBacklinksForFilePath(filePath) {
  return isVaultFilePath(filePath);
}

export function stripVaultFileExtension(name) {
  return String(name ?? '').replace(STRIP_VAULT_EXTENSION_PATTERN, '');
}
