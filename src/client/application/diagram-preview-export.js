import {
  isMermaidFilePath,
  isPlantUmlFilePath,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';
import { getVaultPathLeaf } from '../domain/vault-paths.js';
import { prepareMermaidRenderSource } from '../domain/mermaid-source.js';
import {
  encodeSvgDataUrl,
  loadImage,
  resolveSvgDimensions,
  sanitizeSvgMarkup,
  serializeSvgElement,
} from './preview-diagram-utils.js';

const LIGHT_EXPORT_MERMAID_CONFIG = Object.freeze({
  htmlLabels: false,
  flowchart: {
    defaultRenderer: 'dagre-wrapper',
    htmlLabels: false,
    useMaxWidth: true,
  },
  class: {
    defaultRenderer: 'dagre-wrapper',
    htmlLabels: false,
    useMaxWidth: true,
  },
  startOnLoad: false,
  theme: 'default',
});
const MERMAID_INIT_DIRECTIVE_PATTERN = /^\s*%%\{\s*(?:init|initialize)\s*:[\s\S]*?\}%%\s*\n?/gim;

let mermaidExportCounter = 0;

function createMermaidExportId() {
  mermaidExportCounter += 1;
  return `mermaid-export-${mermaidExportCounter.toString(36)}`;
}

async function canvasToPngBlob(canvas) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob instanceof Blob) {
      return blob;
    }
  }

  const [, payload = ''] = canvas.toDataURL('image/png').split(',', 2);
  return new Blob([Uint8Array.fromBase64(payload)], { type: 'image/png' });
}

function cleanupExportSvg(svgElement) {
  const clonedSvg = svgElement.cloneNode(true);
  if (!(clonedSvg instanceof SVGSVGElement)) {
    throw new Error('Renderer returned invalid SVG');
  }

  for (const prop of ['display', 'margin', 'max-width', 'height', 'width']) {
    clonedSvg.style.removeProperty(prop);
  }
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const { width, height } = resolveSvgDimensions(clonedSvg);
  clonedSvg.setAttribute('width', String(Math.max(1, Math.ceil(width))));
  clonedSvg.setAttribute('height', String(Math.max(1, Math.ceil(height))));

  return clonedSvg;
}

function applyTrimmedSvgBounds(targetSvg, measuredSvg, padding = 16) {
  if (typeof measuredSvg.getBBox !== 'function') {
    return false;
  }

  try {
    const bounds = measuredSvg.getBBox();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }

    const inset = Math.max(0, Number(padding) || 0);
    const width = Math.ceil(bounds.width + (inset * 2));
    const height = Math.ceil(bounds.height + (inset * 2));
    targetSvg.setAttribute('viewBox', `${Math.floor(bounds.x - inset)} ${Math.floor(bounds.y - inset)} ${width} ${height}`);
    targetSvg.setAttribute('width', String(width));
    targetSvg.setAttribute('height', String(height));
    targetSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return true;
  } catch {
    return false;
  }
}

function trimExportSvgElement(svgElement, { padding = 16 } = {}) {
  const cleanedSvg = cleanupExportSvg(svgElement);
  applyTrimmedSvgBounds(cleanedSvg, svgElement, padding);
  return cleanedSvg;
}

export function trimSvgMarkup(svgMarkup, { padding = 16 } = {}) {
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    left: '-10000px',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    visibility: 'hidden',
  });
  const parsed = new DOMParser().parseFromString(`<body>${String(svgMarkup ?? '')}</body>`, 'text/html');
  probe.replaceChildren(...parsed.body.childNodes);
  document.body.appendChild(probe);

  try {
    const svgElement = probe.querySelector('svg');
    if (!(svgElement instanceof SVGSVGElement)) {
      return svgMarkup;
    }
    return applyTrimmedSvgBounds(svgElement, svgElement, padding) ? svgElement.outerHTML : svgMarkup;
  } finally {
    probe.remove();
  }
}

export function createDiagramExportBaseName({
  currentFilePath = '',
  diagramKind = 'diagram',
  sourceLine = '',
  targetPath = '',
} = {}) {
  const targetLeaf = getVaultPathLeaf(targetPath);
  if (targetLeaf) {
    return stripVaultFileExtension(targetLeaf) || `${diagramKind}-diagram`;
  }

  const currentLeaf = getVaultPathLeaf(currentFilePath);
  const currentStem = stripVaultFileExtension(currentLeaf) || 'document';
  const isStandaloneDiagram = (
    (diagramKind === 'mermaid' && isMermaidFilePath(currentFilePath))
    || (diagramKind === 'plantuml' && isPlantUmlFilePath(currentFilePath))
  );

  if (isStandaloneDiagram) {
    return currentStem;
  }

  return sourceLine ? `${currentStem}-${diagramKind}-L${sourceLine}` : `${currentStem}-${diagramKind}`;
}

export function createDiagramExportFileNames(options = {}) {
  const baseName = createDiagramExportBaseName(options);
  return {
    baseName,
    pngFileName: `${baseName}.png`,
    svgFileName: `${baseName}.svg`,
  };
}

export function exportSvgMarkupFromElement(svgElement) {
  return serializeSvgElement(cleanupExportSvg(svgElement));
}

export function exportTrimmedSvgMarkupFromElement(svgElement, options = {}) {
  return serializeSvgElement(trimExportSvgElement(svgElement, options));
}

function prepareMermaidExportSource(source) {
  let text = prepareMermaidRenderSource(String(source ?? '').replace(MERMAID_INIT_DIRECTIVE_PATTERN, ''));

  text = `%%{init: ${JSON.stringify(LIGHT_EXPORT_MERMAID_CONFIG)}}%%\n${text}`;

  if (/^\s*gantt\b/m.test(text) && !/\btodayMarker\b/.test(text)) {
    const lines = text.split('\n');
    const ganttLineIndex = lines.findIndex((line) => /^\s*gantt\b/.test(line));
    if (ganttLineIndex !== -1) {
      lines.splice(ganttLineIndex + 1, 0, '    todayMarker off');
      text = lines.join('\n');
    }
  }

  return text;
}

export async function renderMermaidExportSvgMarkup(mermaid, source) {
  if (!mermaid?.initialize || !mermaid?.run) {
    throw new Error('Mermaid runtime is unavailable');
  }

  mermaid.initialize(LIGHT_EXPORT_MERMAID_CONFIG);

  const renderHost = document.createElement('div');
  Object.assign(renderHost.style, {
    left: '-10000px',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    visibility: 'hidden',
    width: '1200px',
  });
  document.body.appendChild(renderHost);

  try {
    const diagram = document.createElement('div');
    diagram.className = 'mermaid mermaid-export-node';
    diagram.id = createMermaidExportId();
    diagram.textContent = prepareMermaidExportSource(source);
    renderHost.appendChild(diagram);

    await mermaid.run({ nodes: [diagram] });
    const svg = diagram.querySelector('svg');
    if (!(svg instanceof SVGSVGElement)) {
      throw new Error('Mermaid export returned no SVG');
    }

    return exportTrimmedSvgMarkupFromElement(svg, { padding: 24 });
  } finally {
    renderHost.remove();
  }
}

async function rasterizeSvgMarkupToCanvas(svgMarkup) {
  const safeSvgMarkup = sanitizeSvgMarkup(svgMarkup);
  const svgBlobUrl = URL.createObjectURL(new Blob([safeSvgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
  let image;
  try {
    try {
      image = await loadImage(svgBlobUrl);
    } catch {
      image = await loadImage(encodeSvgDataUrl(safeSvgMarkup));
    }
  } finally {
    URL.revokeObjectURL(svgBlobUrl);
  }

  const probe = document.createElement('div');
  const parsed = new DOMParser().parseFromString(`<body>${safeSvgMarkup}</body>`, 'text/html');
  probe.replaceChildren(...parsed.body.childNodes);
  const svgElement = probe.querySelector('svg');
  const { width, height } = svgElement
    ? resolveSvgDimensions(svgElement)
    : {
      height: image.naturalHeight || 800,
      width: image.naturalWidth || 1200,
    };

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function rasterizeSvgMarkupToPngBlob(svgMarkup) {
  return canvasToPngBlob(await rasterizeSvgMarkupToCanvas(svgMarkup));
}

export async function rasterizeSvgMarkupToPngDataUrl(svgMarkup) {
  return (await rasterizeSvgMarkupToCanvas(svgMarkup)).toDataURL('image/png');
}

export async function writeBlobToClipboard(blob) {
  if (typeof ClipboardItem !== 'function' || !navigator.clipboard?.write) {
    throw new Error('Clipboard image copy is unavailable');
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob,
    }),
  ]);
}
