export const IDLE_RENDER_TIMEOUT_MS = 500;
export const MERMAID_BATCH_SIZE = 2;
export const MERMAID_RENDER_CACHE_LIMIT = 30;
export const PLANTUML_BATCH_SIZE = 2;

export {
  cancelIdleRender,
  isNearViewport,
  requestIdleRender,
} from '../browser-utils.js';

export function encodeSvgDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)), { once: true });
    image.src = src;
  });
}

export function resolveSvgDimensions(svgElement) {
  const widthAttr = Number.parseFloat(svgElement.getAttribute('width') || '');
  const heightAttr = Number.parseFloat(svgElement.getAttribute('height') || '');
  const viewBoxParts = (svgElement.getAttribute('viewBox') || '')
    .split(/\s+/u)
    .map((value) => Number.parseFloat(value));

  return {
    height: Number.isFinite(heightAttr) && heightAttr > 0
      ? heightAttr
      : (Number.isFinite(viewBoxParts[3]) && viewBoxParts[3] > 0 ? viewBoxParts[3] : 800),
    width: Number.isFinite(widthAttr) && widthAttr > 0
      ? widthAttr
      : (Number.isFinite(viewBoxParts[2]) && viewBoxParts[2] > 0 ? viewBoxParts[2] : 1200),
  };
}

export function syncAttribute(target, source, name) {
  const nextValue = source.getAttribute(name);
  if (nextValue === null) {
    target.removeAttribute(name);
    return;
  }

  target.setAttribute(name, nextValue);
}

export function getSvgSize(svg) {
  const viewBox = svg.viewBox?.baseVal;
  const attributeWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const attributeHeight = Number.parseFloat(svg.getAttribute('height') || '');
  const rect = svg.getBoundingClientRect();
  const bbox = typeof svg.getBBox === 'function' ? svg.getBBox() : null;

  return {
    height: viewBox?.height || bbox?.height || attributeHeight || rect.height || 480,
    width: viewBox?.width || bbox?.width || attributeWidth || rect.width || 640,
  };
}

export function normalizeMermaidSvg(svg) {
  if (!svg || typeof svg.getBBox !== 'function') {
    return getSvgSize(svg);
  }

  try {
    const bbox = svg.getBBox();
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
      return getSvgSize(svg);
    }

    const padding = 16;
    const x = bbox.x - padding;
    const y = bbox.y - padding;
    const width = bbox.width + (padding * 2);
    const height = bbox.height + (padding * 2);

    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    return { width, height };
  } catch {
    return getSvgSize(svg);
  }
}

export function getFrameViewportSize(frame) {
  const styles = window.getComputedStyle(frame);
  const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');

  return {
    width: Math.max(frame.clientWidth - paddingX, 0),
  };
}

export function easeOutCubic(progress) {
  return 1 - ((1 - progress) ** 3);
}

export function createMermaidPlaceholderCardWithMessage(key, { label = 'Mermaid diagram', message = 'Loads when visible' } = {}) {
  const card = document.createElement('div');
  card.className = 'mermaid-placeholder-card';

  const copy = document.createElement('div');
  copy.className = 'mermaid-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = label;

  const subtitle = document.createElement('span');
  subtitle.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mermaid-placeholder-btn';
  button.dataset.mermaidKey = key;
  button.textContent = 'Render';

  copy.append(title, subtitle);
  card.append(copy, button);
  return card;
}

export function createPlantUmlPlaceholderCard(key, message = 'Renders server-side when visible') {
  const card = document.createElement('div');
  card.className = 'plantuml-placeholder-card';

  const copy = document.createElement('div');
  copy.className = 'plantuml-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = 'PlantUML diagram';

  const subtitle = document.createElement('span');
  subtitle.textContent = message;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plantuml-placeholder-btn';
  button.dataset.plantumlKey = key;
  button.textContent = 'Render';

  copy.append(title, subtitle);
  card.append(copy, button);
  return card;
}

export function getDiagramErrorLocation(message = '') {
  const text = String(message ?? '');
  const line = text.match(/\bline(?:\s+number)?\s*[:#]?\s*(\d+)\b/i)?.[1] ?? '';
  const column = text.match(/\bcol(?:umn)?(?:\s+number)?\s*[:#]?\s*(\d+)\b/i)?.[1] ?? '';

  return [
    line ? `Line ${line}` : '',
    column ? `column ${column}` : '',
  ].filter(Boolean).join(', ');
}

export function normalizeDiagramError(error, fallback = 'Render failed') {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || fallback;
}

export function createDiagramErrorPlaceholderCard({
  key,
  kind,
  label = 'Diagram',
  message = 'Render failed',
  subtitle = 'The current source could not be rendered.',
} = {}) {
  const card = document.createElement('div');
  card.className = `${kind}-placeholder-card diagram-preview-placeholder-card diagram-preview-error-card`;
  card.setAttribute('role', 'alert');
  card.setAttribute('aria-live', 'assertive');

  const copy = document.createElement('div');
  copy.className = 'diagram-preview-placeholder-copy';

  const title = document.createElement('strong');
  title.textContent = `${label} needs attention`;

  const subtitleNode = document.createElement('span');
  subtitleNode.textContent = subtitle;

  const location = getDiagramErrorLocation(message);
  let locationNode = null;
  if (location) {
    locationNode = document.createElement('span');
    locationNode.textContent = location;
  }

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Details';
  const detailMessage = document.createElement('code');
  detailMessage.textContent = message;
  details.append(summary, detailMessage);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${kind}-placeholder-btn diagram-preview-placeholder-btn`;
  button.dataset[`${kind}Key`] = key;
  button.textContent = 'Retry';

  copy.append(title, subtitleNode);
  if (locationNode) {
    copy.append(locationNode);
  }
  copy.append(details);
  card.append(copy, button);
  return card;
}

const SHOW_COMMENT_NODE = 128;

function removeSvgComments(rootElement) {
  const walker = rootElement.ownerDocument.createTreeWalker(rootElement, SHOW_COMMENT_NODE);
  const comments = [];

  while (walker.nextNode()) {
    comments.push(walker.currentNode);
  }

  comments.forEach((comment) => comment.remove());
}

export function sanitizeSvgElement(svgElement) {
  if (!(svgElement instanceof SVGSVGElement)) {
    throw new Error('Renderer returned invalid SVG');
  }

  removeSvgComments(svgElement);
  svgElement.querySelectorAll('script, foreignObject').forEach((node) => {
    node.remove();
  });

  [svgElement, ...Array.from(svgElement.querySelectorAll('*'))].forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value || '';
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        return;
      }

      if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return svgElement;
}

export function serializeSvgElement(svgElement) {
  const sanitizedSvg = sanitizeSvgElement(svgElement);
  return new XMLSerializer().serializeToString(sanitizedSvg);
}

function parseSvgMarkup(svgMarkup) {
  const normalizedMarkup = String(svgMarkup ?? '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/&nbsp;/giu, '&#160;');

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(normalizedMarkup, 'image/svg+xml');
  const svg = documentNode.documentElement;
  if (svg?.nodeName.toLowerCase() === 'svg' && !documentNode.querySelector('parsererror')) {
    return svg;
  }

  const fallbackDocument = parser.parseFromString(normalizedMarkup, 'text/html');
  return fallbackDocument.querySelector('svg');
}

export function sanitizeSvgMarkup(svgMarkup) {
  const svg = parseSvgMarkup(svgMarkup);
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error('Renderer returned invalid SVG');
  }

  return serializeSvgElement(svg);
}

export function shouldPreserveHydratedDiagram({ nextSource = '', nextTarget = '', preservedSource = '', preservedTarget = '' } = {}) {
  if (nextSource) {
    return nextSource === preservedSource;
  }

  if (nextTarget) {
    return nextTarget === preservedTarget;
  }

  return false;
}
