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

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrlToBlob(dataUrl);
}

function dataUrlToBlob(dataUrl) {
  const [header = '', payload = ''] = String(dataUrl).split(',', 2);
  const mimeMatch = header.match(/^data:([^;,]+)?/u);
  const mimeType = mimeMatch?.[1] || 'application/octet-stream';

  if (header.includes(';base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

function cleanupExportSvg(svgElement) {
  const clonedSvg = svgElement.cloneNode(true);
  if (!(clonedSvg instanceof SVGSVGElement)) {
    throw new Error('Renderer returned invalid SVG');
  }

  clonedSvg.style.removeProperty('display');
  clonedSvg.style.removeProperty('margin');
  clonedSvg.style.removeProperty('max-width');
  clonedSvg.style.removeProperty('height');
  clonedSvg.style.removeProperty('width');
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const { width, height } = resolveSvgDimensions(clonedSvg);
  clonedSvg.setAttribute('width', String(Math.max(1, Math.ceil(width))));
  clonedSvg.setAttribute('height', String(Math.max(1, Math.ceil(height))));

  return clonedSvg;
}

function trimExportSvgElement(svgElement, { padding = 16 } = {}) {
  const cleanedSvg = cleanupExportSvg(svgElement);

  if (typeof svgElement.getBBox !== 'function') {
    return cleanedSvg;
  }

  try {
    const bounds = svgElement.getBBox();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return cleanedSvg;
    }

    const inset = Math.max(0, Number(padding) || 0);
    const width = Math.ceil(bounds.width + (inset * 2));
    const height = Math.ceil(bounds.height + (inset * 2));
    const viewBox = [
      Math.floor(bounds.x - inset),
      Math.floor(bounds.y - inset),
      width,
      height,
    ];

    cleanedSvg.setAttribute('viewBox', viewBox.join(' '));
    cleanedSvg.setAttribute('width', String(width));
    cleanedSvg.setAttribute('height', String(height));
    cleanedSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return cleanedSvg;
  } catch {
    return cleanedSvg;
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

  if (sourceLine) {
    return `${currentStem}-${diagramKind}-L${sourceLine}`;
  }

  return `${currentStem}-${diagramKind}`;
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
  const cleanedSvg = cleanupExportSvg(svgElement);
  return serializeSvgElement(cleanedSvg);
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
  renderHost.style.position = 'fixed';
  renderHost.style.left = '-10000px';
  renderHost.style.top = '0';
  renderHost.style.width = '1200px';
  renderHost.style.visibility = 'hidden';
  renderHost.style.pointerEvents = 'none';
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

export async function rasterizeSvgMarkupToPngBlob(svgMarkup) {
  const safeSvgMarkup = sanitizeSvgMarkup(svgMarkup);
  const image = await loadImage(encodeSvgDataUrl(safeSvgMarkup));

  const probe = document.createElement('div');
  probe.innerHTML = safeSvgMarkup;
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
  return canvasToPngBlob(canvas);
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
