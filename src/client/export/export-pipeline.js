import { exportToSvg as exportExcalidrawToSvg } from '@excalidraw/excalidraw';

import baseStyles from '../styles/base.css?inline';
import tokenStyles from '../styles/foundation/tokens.css?inline';
import themeStyles from '../styles/foundation/themes.css?inline';
import previewStyles from '../styles/features/preview-markdown.css?inline';
import highlightOverrideStyles from '../styles/overrides/highlightjs.css?inline';
import exportStyles from '../styles/export-document.css?inline';
import highlightStyles from '../assets/vendor/highlight/github.min.css?inline';
import {
  encodeSvgDataUrl,
  loadImage,
  resolveSvgDimensions,
  sanitizeSvgMarkup,
} from '../application/preview-diagram-utils.js';
import { compilePreviewDocument } from '../application/preview-render-compiler.js';
import { isMarkdownFilePath, stripVaultFileExtension } from '../../domain/file-kind.js';
import { resolveVaultRelativePath } from '../../domain/vault-paths.js';
import { resolveWikiTargetPath } from '../../domain/wiki-link-resolver.js';
import { createExcalidrawExportOptions, parseSceneJson } from '../domain/excalidraw-scene.js';
import { escapeHtml } from '../domain/vault-utils.js';
import { downloadBlob } from '../browser-utils.js';
import { resolveApiUrl, resolveAppUrl } from '../infrastructure/runtime-config.js';
import { parseApiResponse } from '../infrastructure/api-client-utils.js';

const EXPORT_PAGE_SOURCE = 'collabmd-export-page';
const EXPORT_HOST_SOURCE = 'collabmd-export-host';
const EXPORT_MERMAID_CONFIG = Object.freeze({
  htmlLabels: false,
  flowchart: {
    defaultRenderer: 'dagre-wrapper',
    useMaxWidth: true,
  },
  class: {
    defaultRenderer: 'dagre-wrapper',
    useMaxWidth: true,
  },
  startOnLoad: false,
});
const EXPORT_ASSET_FETCH_TIMEOUT_MS = 10_000;
const EXPORT_ASSET_MAX_BYTES = 10 * 1024 * 1024;
const EXPORT_RENDER_SETTLE_TIMEOUT_MS = 10_000;
const VIDEO_POSTER_CAPTURE_TIMEOUT_MS = 10_000;
const VIDEO_POSTER_CAPTURE_SEEK_SECONDS = 1;
const DOCX_COMPATIBLE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/svg+xml',
]);
const DOCX_PNG_VARIANT_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/webp',
]);
const DOCX_IMAGE_TYPE_LABELS = new Map([
  ['image/gif', 'GIF'],
  ['image/webp', 'WebP'],
]);
const HTML_EXPORT_STYLES = [
  baseStyles,
  tokenStyles,
  themeStyles,
  previewStyles,
  highlightOverrideStyles,
  exportStyles,
  highlightStyles,
  `html, body {
    height: auto;
    min-height: 100%;
    overflow: visible;
  }`,
].join('\n');

let mermaidLoaderPromise = null;
let assetCounter = 0;

function createAssetId(prefix = 'asset') {
  assetCounter += 1;
  return `${prefix}-${assetCounter.toString(36)}`;
}

function normalizeExportTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

function createDocumentTitle(filePath, title = '') {
  const normalizedTitle = String(title ?? '').trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const leaf = String(filePath ?? '').split('/').filter(Boolean).pop() || 'document';
  return stripVaultFileExtension(leaf) || 'document';
}

function createDocumentAnchorId(filePath) {
  return `export-doc-${encodeURIComponent(String(filePath ?? '').toLowerCase()).replace(/%/gu, '-').replace(/\./gu, '-')}`;
}

function createExportHeadingSlug(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

function rewriteDirectoryDocumentLinks(container, { fileList, sourceFilePath }) {
  const exportedPaths = new Set(fileList);
  const sourceAnchorId = createDocumentAnchorId(sourceFilePath);

  Array.from(container.querySelectorAll('[id]')).forEach((element) => {
    element.id = `${sourceAnchorId}-${element.id}`;
  });

  Array.from(container.querySelectorAll('a[href]')).forEach((link) => {
    const rawHref = String(link.getAttribute('href') || '').trim();
    const wikiTarget = String(link.getAttribute('data-wiki-target') || '').trim();
    if (wikiTarget) {
      const [targetPath, targetHeading = ''] = wikiTarget.split('#', 2);
      const resolved = targetPath ? resolveWikiTargetPath(targetPath, fileList) : sourceFilePath;
      if (resolved && exportedPaths.has(resolved)) {
        const headingSlug = createExportHeadingSlug(targetHeading);
        const targetAnchorId = createDocumentAnchorId(resolved);
        link.setAttribute('href', headingSlug ? `#${targetAnchorId}-${headingSlug}` : `#${targetAnchorId}`);
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
      return;
    }

    if (!rawHref || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(rawHref)) {
      return;
    }

    if (rawHref.startsWith('#')) {
      link.setAttribute('href', `#${sourceAnchorId}-${rawHref.slice(1)}`);
      return;
    }

    const [pathPart, fragment = ''] = rawHref.split('#', 2);
    const resolved = resolveVaultRelativePath(sourceFilePath, pathPart);
    if (!exportedPaths.has(resolved)) {
      return;
    }

    const targetAnchorId = createDocumentAnchorId(resolved);
    link.setAttribute('href', fragment ? `#${targetAnchorId}-${fragment}` : `#${targetAnchorId}`);
    link.removeAttribute('target');
    link.removeAttribute('rel');
  });
}

function replaceChildrenFromHtml(target, html) {
  const parsed = new DOMParser().parseFromString(`<body>${String(html ?? '')}</body>`, 'text/html');
  target.replaceChildren(...parsed.body.childNodes);
}

function encodeSvgBase64DataUrl(svgMarkup) {
  const bytes = new TextEncoder().encode(String(svgMarkup ?? ''));
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function waitForAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read blob')));
    reader.readAsDataURL(blob);
  });
}

function trimSvgCanvas(svgMarkup, { padding = 16 } = {}) {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-10000px';
  probe.style.top = '0';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  replaceChildrenFromHtml(probe, svgMarkup);
  document.body.appendChild(probe);

  try {
    const svgElement = probe.querySelector('svg');
    if (!(svgElement instanceof SVGSVGElement)) {
      return svgMarkup;
    }

    let bounds = null;
    try {
      bounds = svgElement.getBBox();
    } catch {
      return svgMarkup;
    }

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return svgMarkup;
    }

    const inset = Math.max(0, Number(padding) || 0);
    const nextViewBox = [
      Math.floor(bounds.x - inset),
      Math.floor(bounds.y - inset),
      Math.ceil(bounds.width + (inset * 2)),
      Math.ceil(bounds.height + (inset * 2)),
    ];

    const trimmedWidth = Math.ceil(bounds.width + (inset * 2));
    const trimmedHeight = Math.ceil(bounds.height + (inset * 2));

    svgElement.setAttribute('viewBox', nextViewBox.join(' '));
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgElement.setAttribute('width', String(trimmedWidth));
    svgElement.setAttribute('height', String(trimmedHeight));
    return svgElement.outerHTML;
  } finally {
    probe.remove();
  }
}

function normalizeExportSvgMarkup(svgMarkup, options = {}) {
  return trimSvgCanvas(sanitizeSvgMarkup(svgMarkup), options);
}

async function svgMarkupToPngDataUrl(svgMarkup) {
  const svgBlobUrl = URL.createObjectURL(new Blob([svgMarkup], {
    type: 'image/svg+xml;charset=utf-8',
  }));
  const svgProbe = document.createElement('div');
  replaceChildrenFromHtml(svgProbe, svgMarkup);
  const svgElement = svgProbe.querySelector('svg');

  try {
    let image;
    try {
      image = await loadImage(svgBlobUrl);
    } catch {
      image = await loadImage(encodeSvgBase64DataUrl(svgMarkup));
    }
    const { width, height } = svgElement ? resolveSvgDimensions(svgElement) : {
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
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(svgBlobUrl);
  }
}

async function imageDataUrlToPngDataUrl(dataUrl) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
  canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function getDataUrlMimeType(dataUrl = '') {
  const match = String(dataUrl ?? '').match(/^data:([^;,]+)/iu);
  return match?.[1]?.toLowerCase() || '';
}

async function createDocxImageDataUrl(dataUrl, {
  warnings = [],
} = {}) {
  const mimeType = getDataUrlMimeType(dataUrl);
  if (DOCX_COMPATIBLE_IMAGE_MIME_TYPES.has(mimeType)) {
    return dataUrl;
  }

  if (!DOCX_PNG_VARIANT_IMAGE_MIME_TYPES.has(mimeType)) {
    return dataUrl;
  }

  const imageTypeLabel = DOCX_IMAGE_TYPE_LABELS.get(mimeType) || mimeType;
  try {
    return await imageDataUrlToPngDataUrl(dataUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to convert ${imageTypeLabel} image for DOCX`;
    warnings.push(`Failed to convert ${imageTypeLabel} image for DOCX: ${message}`);
    return dataUrl;
  }
}

async function waitForImageElement(image, {
  timeoutMs = EXPORT_RENDER_SETTLE_TIMEOUT_MS,
} = {}) {
  if (!(image instanceof HTMLImageElement)) {
    return;
  }

  if (!image.getAttribute('src')) {
    return;
  }

  if (!image.complete) {
    await new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        image.removeEventListener('load', handleDone);
        image.removeEventListener('error', handleDone);
      };
      const handleDone = () => {
        cleanup();
        resolve();
      };
      const timeoutId = window.setTimeout(handleDone, timeoutMs);

      image.addEventListener('load', handleDone, { once: true });
      image.addEventListener('error', handleDone, { once: true });

      if (image.complete) {
        handleDone();
      }
    });
  }

  if (typeof image.decode === 'function') {
    await image.decode().catch(() => {});
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });
  return parseApiResponse(response, `Request failed: ${response.status}`);
}

async function fetchTextFile(filePath) {
  const payload = await fetchJson(resolveApiUrl(`/file?path=${encodeURIComponent(filePath)}`));
  if (typeof payload?.content !== 'string') {
    throw new Error(`Failed to load ${filePath}`);
  }

  return payload.content;
}

async function fetchAsDataUrl(src, {
  maxBytes = EXPORT_ASSET_MAX_BYTES,
  timeoutMs = EXPORT_ASSET_FETCH_TIMEOUT_MS,
} = {}) {
  const assetUrl = new URL(src, window.location.href);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(assetUrl.toString(), {
      credentials: assetUrl.origin === window.location.origin ? 'same-origin' : 'omit',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Timed out while fetching asset: ${assetUrl.toString()}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${assetUrl.toString()}`);
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Asset is too large to inline: ${assetUrl.toString()}`);
  }

  const blob = await response.blob();
  if (blob.size > maxBytes) {
    throw new Error(`Asset is too large to inline: ${assetUrl.toString()}`);
  }

  return blobToDataUrl(blob);
}

function buildWikiLinkHref(target) {
  const baseUrl = new URL(resolveAppUrl('/'), window.location.origin);
  baseUrl.hash = new URLSearchParams({ file: target }).toString();
  return baseUrl.toString();
}

function extractYouTubeVideoId(source = '') {
  let url;
  try {
    url = new URL(String(source || '').trim());
  } catch {
    return '';
  }

  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] || '';
  }

  if (host.includes('youtube') || host.includes('youtube-nocookie')) {
    if (url.pathname === '/watch') {
      return url.searchParams.get('v') || '';
    }

    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/').filter(Boolean)[1] || '';
    }
  }

  return '';
}

function createVideoPosterElement(element, {
  assetId = '',
  docxPosterDataUrl = '',
  posterDataUrl = '',
} = {}) {
  const wrapper = document.createElement('figure');
  wrapper.className = 'export-video-poster';
  if (assetId) {
    wrapper.setAttribute('data-export-asset-id', assetId);
  }

  const card = document.createElement('div');
  card.className = 'export-video-poster-card';

  if (posterDataUrl) {
    const media = document.createElement('div');
    media.className = 'export-video-poster-media';

    const image = document.createElement('img');
    image.alt = `${element.dataset.videoEmbedLabel || 'Embedded video'} poster`;
    image.className = 'export-video-poster-image';
    image.src = posterDataUrl;
    image.setAttribute('data-export-docx-src', docxPosterDataUrl || posterDataUrl);
    media.appendChild(image);

    const badge = document.createElement('span');
    badge.className = 'export-video-play-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = 'Play';
    media.appendChild(badge);

    card.appendChild(media);
  }

  const copy = document.createElement('div');
  copy.className = 'export-video-poster-copy';

  const title = document.createElement('strong');
  title.textContent = element.dataset.videoEmbedLabel || 'Embedded video';

  const meta = document.createElement('span');
  meta.className = 'export-video-poster-meta';
  meta.textContent = element.dataset.videoEmbedKind === 'youtube' ? 'YouTube video' : 'Video link';

  copy.append(title, meta);
  card.appendChild(copy);

  const link = document.createElement('a');
  link.className = 'export-video-link';
  link.href = element.dataset.videoEmbedOriginalUrl || element.dataset.videoEmbedSource || element.dataset.videoEmbedUrl || '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = link.href;

  wrapper.append(card, link);
  return wrapper;
}

async function captureVideoFrameDataUrl(src) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.crossOrigin = 'anonymous';
  video.style.position = 'fixed';
  video.style.left = '-10000px';
  video.style.top = '0';
  video.style.width = '1px';
  video.style.height = '1px';

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      video.pause?.();
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.remove();
      callback();
    };

    const fail = (message) => {
      finish(() => reject(new Error(message)));
    };

    const drawFrame = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        fail(`Video poster capture returned no frame: ${src}`);
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          fail('Canvas is unavailable');
          return;
        }

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        finish(() => resolve(dataUrl));
      } catch (error) {
        fail(error instanceof Error ? error.message : `Failed to capture video poster: ${src}`);
      }
    };

    const handleError = () => {
      fail(`Failed to load video poster: ${src}`);
    };

    const handleSeeked = () => {
      drawFrame();
    };

    const handleLoadedData = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const targetTime = duration > 0
        ? Math.min(VIDEO_POSTER_CAPTURE_SEEK_SECONDS, Math.max(duration * 0.1, 0))
        : 0;

      if (targetTime > 0.05) {
        try {
          video.currentTime = targetTime;
          return;
        } catch {
          // Fall back to the first available frame when seeking is unavailable.
        }
      }

      drawFrame();
    };

    const timeoutId = window.setTimeout(() => {
      fail(`Timed out while loading video poster: ${src}`);
    }, VIDEO_POSTER_CAPTURE_TIMEOUT_MS);

    video.addEventListener('error', handleError, { once: true });
    video.addEventListener('loadeddata', handleLoadedData, { once: true });
    video.addEventListener('seeked', handleSeeked, { once: true });
    document.body.appendChild(video);
    video.src = src;
    video.load();
  });
}

async function resolveVideoPosterDataUrl(element) {
  const originalUrl = element.dataset.videoEmbedOriginalUrl || element.dataset.videoEmbedSource || '';
  const embedUrl = element.dataset.videoEmbedUrl || '';
  const kind = element.dataset.videoEmbedKind || '';

  if (kind === 'youtube') {
    const videoId = extractYouTubeVideoId(originalUrl) || extractYouTubeVideoId(embedUrl);
    if (!videoId) {
      throw new Error('Failed to resolve YouTube video id for export');
    }

    const thumbnailCandidates = [
      `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`,
      `https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp`,
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    ];

    let lastError = null;
    for (const candidate of thumbnailCandidates) {
      try {
        return await fetchAsDataUrl(candidate, {
          maxBytes: 3 * 1024 * 1024,
          timeoutMs: EXPORT_ASSET_FETCH_TIMEOUT_MS,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to fetch YouTube thumbnail');
  }

  if (!originalUrl) {
    throw new Error('Missing video source for export poster');
  }

  return captureVideoFrameDataUrl(originalUrl);
}

async function resolveVideoPoster(snapshot, shell) {
  const posterDataUrl = await resolveVideoPosterDataUrl(shell);
  const docxPosterDataUrl = await imageDataUrlToPngDataUrl(posterDataUrl).catch(() => posterDataUrl);
  const assetId = registerAsset(snapshot, {
    dataUrl: posterDataUrl,
    id: createAssetId('video-poster'),
    kind: 'video-poster',
    mimeType: posterDataUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/png',
    variants: {
      docx: docxPosterDataUrl,
    },
  });

  shell.replaceWith(createVideoPosterElement(shell, {
    assetId,
    docxPosterDataUrl,
    posterDataUrl,
  }));
}

function createImageFallbackElement({
  alt = '',
  message = '',
  src = '',
} = {}) {
  const fallback = document.createElement('span');
  fallback.className = 'export-warning export-image-fallback';
  fallback.textContent = message || 'Image export failed';

  if (!src) {
    return fallback;
  }

  fallback.append(' ');
  const link = document.createElement('a');
  link.href = src;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  link.textContent = alt || src;
  fallback.append(link);
  return fallback;
}

function createDiagramFigureElement({
  alt,
  assetId,
  className,
  dataUrl,
  docxDataUrl,
  svgMarkup = '',
}) {
  const figure = document.createElement('figure');
  figure.className = `export-diagram ${className}`.trim();
  figure.setAttribute('data-export-asset-id', assetId);
  figure.setAttribute('data-export-label', alt);
  if (docxDataUrl) {
    figure.setAttribute('data-export-docx-src', docxDataUrl);
  }

  if (svgMarkup) {
    const surface = document.createElement('div');
    surface.className = 'export-diagram-surface';
    replaceChildrenFromHtml(surface, svgMarkup);

    const svgElement = surface.querySelector('svg');
    if (svgElement) {
      const { width } = resolveSvgDimensions(svgElement);
      surface.style.width = '100%';
      surface.style.maxWidth = `${Math.ceil(width)}px`;
      svgElement.classList.add('export-diagram-svg');
      svgElement.setAttribute('role', 'img');
      svgElement.setAttribute('aria-label', alt);
      svgElement.removeAttribute('width');
      svgElement.removeAttribute('height');
    }

    figure.appendChild(surface);
    return figure;
  }

  const image = document.createElement('img');
  image.alt = alt;
  image.className = 'export-diagram-image';
  image.src = dataUrl;
  if (docxDataUrl) {
    image.setAttribute('data-export-docx-src', docxDataUrl);
  }
  figure.appendChild(image);
  return figure;
}

async function ensureMermaidRuntime() {
  if (mermaidLoaderPromise) {
    return mermaidLoaderPromise;
  }

  mermaidLoaderPromise = import('mermaid').then((module) => {
    const runtime = module?.default;
    if (!runtime) {
      throw new Error('Mermaid runtime failed to initialize');
    }

    runtime.initialize({ ...EXPORT_MERMAID_CONFIG, theme: 'default' });
    return runtime;
  });

  return mermaidLoaderPromise;
}

function prepareMermaidSource(source) {
  let text = String(source ?? '');

  if (!/%%\{[\s\S]*?\binit\s*:/m.test(text)) {
    if (/^\s*stateDiagram(?:-v2)?\b/m.test(text) || /^\s*classDiagram\b/m.test(text) || /^\s*gantt\b/m.test(text)) {
      text = `%%{init: ${JSON.stringify({ htmlLabels: false })}}%%\n${text}`;
    }
  }

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

async function renderMermaidToSvgMarkup(source) {
  const mermaid = await ensureMermaidRuntime();
  mermaid.initialize({
    ...EXPORT_MERMAID_CONFIG,
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
  });
  const renderHost = document.createElement('div');
  renderHost.style.position = 'fixed';
  renderHost.style.left = '-10000px';
  renderHost.style.top = '0';
  renderHost.style.width = '1200px';
  document.body.appendChild(renderHost);

  try {
    const diagram = document.createElement('div');
    diagram.className = 'mermaid';
    diagram.id = createAssetId('mermaid-render');
    diagram.textContent = prepareMermaidSource(source);
    renderHost.appendChild(diagram);
    await mermaid.run({ nodes: [diagram] });
    const svg = diagram.querySelector('svg');
    if (!svg) {
      throw new Error('Mermaid render returned no SVG');
    }

    return normalizeExportSvgMarkup(svg.outerHTML, { padding: 24 });
  } finally {
    renderHost.remove();
  }
}

async function renderPlantUmlToSvgMarkup(source) {
  const payload = await fetchJson(resolveApiUrl('/plantuml/render'), {
    body: JSON.stringify({ source }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (typeof payload?.svg !== 'string' || !payload.svg.includes('<svg')) {
    throw new Error('PlantUML render returned no SVG');
  }

  return normalizeExportSvgMarkup(payload.svg, { padding: 16 });
}

async function renderExcalidrawToSvgMarkup(filePath) {
  const rawScene = await fetchTextFile(filePath);
  const scene = parseSceneJson(rawScene);
  const svgElement = await exportExcalidrawToSvg(createExcalidrawExportOptions(scene));
  return normalizeExportSvgMarkup(svgElement.outerHTML, { padding: 24 });
}

async function renderDrawioToPngDataUrl(filePath) {
  const instanceId = createAssetId('drawio-export');

  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.className = 'drawio-export-iframe';
    iframe.src = (() => {
      const url = new URL(resolveAppUrl('/drawio-editor.html'), window.location.origin);
      url.searchParams.set('file', filePath);
      url.searchParams.set('hostMode', 'export-image');
      url.searchParams.set('instanceId', instanceId);
      url.searchParams.set('mode', 'view');
      url.searchParams.set('theme', 'light');
      url.searchParams.set('previewWidth', '1200');
      return url.toString();
    })();

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while exporting draw.io diagram'));
    }, 20000);

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const payload = event.data;
      if (!payload || payload.source !== 'drawio-editor' || payload.instanceId !== instanceId) {
        return;
      }

      if (payload.type === 'export-image' && typeof payload.data === 'string' && payload.data) {
        cleanup();
        resolve(payload.data);
        return;
      }

      if (payload.type === 'error' || payload.type === 'fallback-text') {
        cleanup();
        reject(new Error(payload.message || 'Failed to export draw.io diagram'));
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', handleMessage);
      iframe.remove();
    };

    window.addEventListener('message', handleMessage);
    document.body.appendChild(iframe);
  });
}

function registerAsset(snapshot, asset) {
  snapshot.assets[asset.id] = asset;
  return asset.id;
}

async function resolveDiagramShell(snapshot, shell, { label, prefix, render }) {
  let source = shell.querySelector(`.${prefix}-source`)?.textContent ?? '';
  const target = shell.dataset[`${prefix}Target`];
  if (!source.trim() && target) {
    source = await fetchTextFile(target);
  }
  if (!source.trim()) {
    throw new Error(`${label} source is empty`);
  }

  const svgMarkup = await render(source, target);
  const svgDataUrl = encodeSvgDataUrl(svgMarkup);
  const docxDataUrl = await svgMarkupToPngDataUrl(svgMarkup).catch(() => svgDataUrl);
  const assetId = registerAsset(snapshot, {
    dataUrl: svgDataUrl,
    id: createAssetId(prefix),
    kind: 'svg',
    mimeType: 'image/svg+xml',
    text: svgMarkup,
    variants: {
      docx: docxDataUrl,
    },
  });

  shell.replaceWith(createDiagramFigureElement({
    alt: label,
    assetId,
    className: `export-diagram--${prefix}`,
    dataUrl: svgDataUrl,
    docxDataUrl,
    svgMarkup,
  }));
}

function getBaseCellText(cell) {
  if (cell?.text != null) {
    return String(cell.text);
  }
  if (Array.isArray(cell?.value)) {
    return cell.value.join(', ');
  }
  return cell?.value == null ? '' : String(cell.value);
}

async function resolveBaseEmbed(snapshot, placeholder) {
  const response = await fetchJson(resolveApiUrl('/base/query'), {
    body: JSON.stringify({
      activeFilePath: snapshot.filePath,
      path: placeholder.dataset.basePath || '',
      search: '',
      source: placeholder.dataset.baseSource || null,
      sourcePath: placeholder.dataset.baseSourcePath || snapshot.filePath,
      view: placeholder.dataset.baseView || '',
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = response.result;
  if (!result || !Array.isArray(result.columns) || !Array.isArray(result.groups)) {
    throw new Error('Base query returned no rendered view');
  }

  // ponytail: static tables preserve base data; share card/list renderers if those export layouts become necessary.
  if (result.view?.type && result.view.type !== 'table') {
    snapshot.warnings.push(`Base ${result.view.type} view exported as a static table`);
  }

  const shell = document.createElement('section');
  shell.className = 'bases-shell bases-shell-static';
  const toolbar = document.createElement('header');
  toolbar.className = 'bases-toolbar';
  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'bases-toolbar-main';
  const title = document.createElement('strong');
  title.textContent = result.view?.name || 'Base view';
  const meta = document.createElement('div');
  meta.className = 'bases-meta';
  meta.textContent = `${result.totalRows ?? 0} results`;
  toolbarMain.append(title, meta);
  toolbar.appendChild(toolbarMain);
  shell.appendChild(toolbar);

  const content = document.createElement('div');
  content.className = 'bases-content';
  result.groups.forEach((group) => {
    if (result.groups.length > 1) {
      const heading = document.createElement('h3');
      heading.textContent = group.label || group.key || 'Group';
      content.appendChild(heading);
    }
    const tableShell = document.createElement('div');
    tableShell.className = 'bases-table-shell';
    const table = document.createElement('table');
    table.className = 'bases-table';
    const headRow = table.createTHead().insertRow();
    result.columns.forEach((column) => {
      const heading = document.createElement('th');
      heading.scope = 'col';
      heading.textContent = column.label || column.id || '';
      headRow.appendChild(heading);
    });
    const body = table.createTBody();
    (group.rows || []).forEach((row) => {
      const tableRow = body.insertRow();
      result.columns.forEach((column, columnIndex) => {
        const cell = tableRow.insertCell();
        const text = getBaseCellText(row.cells?.[column.id]);
        if (columnIndex === 0 && row.path) {
          const link = document.createElement('a');
          link.href = buildWikiLinkHref(row.path);
          link.dataset.wikiTarget = row.path;
          link.textContent = text;
          cell.appendChild(link);
        } else {
          cell.textContent = text;
        }
      });
    });
    tableShell.appendChild(table);
    content.appendChild(tableShell);
  });
  shell.appendChild(content);
  placeholder.replaceWith(shell);
}

async function resolveExcalidrawEmbed(snapshot, placeholder) {
  const target = String(placeholder.dataset.embedTarget ?? '').trim();
  if (!target) {
    throw new Error('Missing Excalidraw file path');
  }

  const svgMarkup = await renderExcalidrawToSvgMarkup(target);
  const svgDataUrl = encodeSvgDataUrl(svgMarkup);
  const docxDataUrl = await svgMarkupToPngDataUrl(svgMarkup).catch(() => svgDataUrl);
  const assetId = registerAsset(snapshot, {
    dataUrl: svgDataUrl,
    id: createAssetId('excalidraw'),
    kind: 'svg',
    mimeType: 'image/svg+xml',
    text: svgMarkup,
    variants: {
      docx: docxDataUrl,
    },
  });

  placeholder.replaceWith(createDiagramFigureElement({
    alt: placeholder.dataset.embedLabel || 'Excalidraw diagram',
    assetId,
    className: 'export-diagram--excalidraw',
    dataUrl: svgDataUrl,
    docxDataUrl,
    svgMarkup,
  }));
}

async function resolveDrawioEmbed(snapshot, placeholder) {
  const target = String(placeholder.dataset.drawioTarget ?? '').trim();
  if (!target) {
    throw new Error('Missing draw.io file path');
  }

  const pngDataUrl = await renderDrawioToPngDataUrl(target);
  const assetId = registerAsset(snapshot, {
    dataUrl: pngDataUrl,
    id: createAssetId('drawio'),
    kind: 'png',
    mimeType: 'image/png',
  });

  placeholder.replaceWith(createDiagramFigureElement({
    alt: placeholder.dataset.drawioLabel || 'draw.io diagram',
    assetId,
    className: 'export-diagram--drawio',
    dataUrl: pngDataUrl,
    docxDataUrl: pngDataUrl,
  }));
}

async function resolveImageAssets(snapshot, container) {
  const imageNodes = Array.from(container.querySelectorAll('img'));
  for (const imageNode of imageNodes) {
    const src = imageNode.getAttribute('src') || '';
    if (!src) {
      continue;
    }

    if (src.startsWith('data:')) {
      const docxDataUrl = await createDocxImageDataUrl(src, {
        warnings: snapshot.warnings,
      });
      imageNode.setAttribute('data-export-docx-src', docxDataUrl);
      continue;
    }

    try {
      const imageUrl = new URL(src, window.location.href);
      const dataUrl = await fetchAsDataUrl(imageUrl.toString());
      const docxDataUrl = await createDocxImageDataUrl(dataUrl, {
        warnings: snapshot.warnings,
      });
      const assetId = registerAsset(snapshot, {
        dataUrl,
        id: createAssetId('image'),
        kind: 'image',
        mimeType: getDataUrlMimeType(dataUrl) || 'application/octet-stream',
      });
      imageNode.src = dataUrl;
      imageNode.setAttribute('data-export-asset-id', assetId);
      imageNode.setAttribute('data-export-docx-src', docxDataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to inline ${src}`;
      snapshot.warnings.push(message);
      imageNode.replaceWith(createImageFallbackElement({
        alt: imageNode.getAttribute('alt') || '',
        message: `Image export failed: ${message}. Source:`,
        src,
      }));
    }
  }
}

function rewriteWikiLinks(container) {
  Array.from(container.querySelectorAll('.wiki-link[data-wiki-target]')).forEach((link) => {
    const target = String(link.getAttribute('data-wiki-target') || '').trim();
    if (!target) {
      return;
    }

    link.setAttribute('href', buildWikiLinkHref(target));
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

function rewriteTaskCheckboxes(container) {
  Array.from(container.querySelectorAll('.task-list-item input[type="checkbox"]')).forEach((checkbox) => {
    checkbox.setAttribute('disabled', 'true');
  });
}

export async function resolveExportAssets(snapshot, {
  container,
} = {}) {
  rewriteWikiLinks(container);
  rewriteTaskCheckboxes(container);

  const videoShells = Array.from(container.querySelectorAll('.video-embed-placeholder[data-video-embed-key]'));
  for (const shell of videoShells) {
    try {
      await resolveVideoPoster(snapshot, shell);
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render video poster');
      shell.replaceWith(createVideoPosterElement(shell));
    }
  }

  const mermaidShells = Array.from(container.querySelectorAll('.mermaid-shell[data-mermaid-key]'));
  for (const shell of mermaidShells) {
    try {
      await resolveDiagramShell(snapshot, shell, {
        label: shell.dataset.mermaidLabel || 'Mermaid diagram',
        prefix: 'mermaid',
        render: (source) => renderMermaidToSvgMarkup(source),
      });
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render Mermaid diagram');
      shell.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `Mermaid export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  const plantUmlShells = Array.from(container.querySelectorAll('.plantuml-shell[data-plantuml-key]'));
  for (const shell of plantUmlShells) {
    try {
      await resolveDiagramShell(snapshot, shell, {
        label: shell.dataset.plantumlLabel || 'PlantUML diagram',
        prefix: 'plantuml',
        render: (source) => renderPlantUmlToSvgMarkup(source),
      });
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render PlantUML diagram');
      shell.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `PlantUML export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  const baseEmbeds = Array.from(container.querySelectorAll('.bases-embed-placeholder[data-base-key]'));
  for (const placeholder of baseEmbeds) {
    try {
      await resolveBaseEmbed(snapshot, placeholder);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      snapshot.warnings.push(`Base export failed: ${message}`);
      placeholder.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `Base export failed: ${message}`,
      }));
    }
  }

  const excalidrawEmbeds = Array.from(container.querySelectorAll('.excalidraw-embed-placeholder[data-embed-key]'));
  for (const placeholder of excalidrawEmbeds) {
    try {
      await resolveExcalidrawEmbed(snapshot, placeholder);
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render Excalidraw diagram');
      placeholder.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `Excalidraw export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  const drawioEmbeds = Array.from(container.querySelectorAll('.drawio-embed-placeholder[data-drawio-key]'));
  for (const placeholder of drawioEmbeds) {
    try {
      await resolveDrawioEmbed(snapshot, placeholder);
    } catch (error) {
      snapshot.warnings.push(error instanceof Error ? error.message : 'Failed to render draw.io diagram');
      placeholder.replaceWith(Object.assign(document.createElement('p'), {
        className: 'export-warning',
        textContent: `draw.io export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  await resolveImageAssets(snapshot, container);
  return snapshot;
}

export async function prepareExportSnapshot({
  directoryFileList = [],
  fileList = [],
  filePath,
  markdownText = '',
  theme = 'light',
  title = '',
} = {}) {
  const normalizedFilePath = String(filePath ?? '').trim();
  const normalizedMarkdown = String(markdownText ?? '');
  const snapshot = {
    assets: {},
    filePath: normalizedFilePath,
    generatedAt: new Date().toISOString(),
    html: '',
    sourceMarkdown: normalizedMarkdown,
    theme: normalizeExportTheme(theme),
    title: createDocumentTitle(normalizedFilePath, title),
    warnings: [],
  };

  const compiled = compilePreviewDocument({
    attachmentApiPath: resolveApiUrl('/attachment'),
    fileList,
    markdownText: normalizedMarkdown,
    sourceFilePath: normalizedFilePath,
  });
  const container = document.createElement('div');
  container.className = 'preview-content export-content';
  replaceChildrenFromHtml(container, compiled.html);

  await resolveExportAssets(snapshot, { container });
  if (directoryFileList.length > 0) {
    rewriteDirectoryDocumentLinks(container, {
      fileList: directoryFileList,
      sourceFilePath: normalizedFilePath,
    });
  }
  snapshot.html = container.innerHTML;
  return snapshot;
}

export async function prepareDirectoryExportSnapshot({
  currentFilePath = '',
  currentMarkdownText = '',
  directoryPath,
  fileList = [],
  theme = 'light',
} = {}) {
  const normalizedDirectoryPath = String(directoryPath ?? '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '').trim();
  const directoryPrefix = `${normalizedDirectoryPath}/`;
  const markdownPaths = fileList
    .filter((filePath) => isMarkdownFilePath(filePath) && String(filePath).startsWith(directoryPrefix))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  if (markdownPaths.length === 0) {
    throw new Error('The selected folder contains no markdown notes');
  }

  const documents = [];
  const warnings = [];
  for (const filePath of markdownPaths) {
    const markdownText = filePath === currentFilePath
      ? String(currentMarkdownText ?? '')
      : await fetchTextFile(filePath);
    const documentSnapshot = await prepareExportSnapshot({
      directoryFileList: markdownPaths,
      fileList,
      filePath,
      markdownText,
      theme,
    });
    warnings.push(...documentSnapshot.warnings.map((warning) => `${filePath}: ${warning}`));
    documents.push(documentSnapshot);
  }

  const title = createDocumentTitle(normalizedDirectoryPath);
  const tableOfContents = documents.map((documentSnapshot) => (
    `<li><a href="#${createDocumentAnchorId(documentSnapshot.filePath)}">${escapeHtml(documentSnapshot.filePath)}</a></li>`
  )).join('');
  const html = [
    `<nav class="export-directory-toc" aria-label="Exported notes"><h1>${escapeHtml(title)}</h1><ol>${tableOfContents}</ol></nav>`,
    ...documents.map((documentSnapshot) => [
      `<section class="export-document-section" id="${createDocumentAnchorId(documentSnapshot.filePath)}">`,
      `<header class="export-document-heading"><h1>${escapeHtml(documentSnapshot.title)}</h1><p>${escapeHtml(documentSnapshot.filePath)}</p></header>`,
      documentSnapshot.html,
      '</section>',
    ].join('')),
  ].join('');

  return {
    assets: {},
    filePath: normalizedDirectoryPath,
    generatedAt: new Date().toISOString(),
    html,
    sourceMarkdown: '',
    theme: normalizeExportTheme(theme),
    title,
    warnings,
  };
}

function applyDocxTableStyles(table, {
  borderColor = '#d1d5db',
  cellPadding = '8px 10px',
  headerBackground = '#f3f4f6',
} = {}) {
  table.setAttribute('border', '1');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.border = `1px solid ${borderColor}`;
  table.style.margin = '0 0 16px';

  Array.from(table.querySelectorAll('th')).forEach((cell) => {
    cell.style.border = `1px solid ${borderColor}`;
    cell.style.padding = cellPadding;
    cell.style.background = headerBackground;
    cell.style.textAlign = 'left';
    cell.style.verticalAlign = 'top';
  });

  Array.from(table.querySelectorAll('td')).forEach((cell) => {
    cell.style.border = `1px solid ${borderColor}`;
    cell.style.padding = cellPadding;
    cell.style.textAlign = 'left';
    cell.style.verticalAlign = 'top';
  });
}

function createDocxFramedTable({
  contentNodes = [],
  borderColor = '#d1d5db',
  padding = '12px',
  shade = '',
} = {}) {
  const table = document.createElement('table');
  table.setAttribute('border', '1');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.border = `1px solid ${borderColor}`;
  table.style.margin = '0 0 16px';

  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.style.border = `1px solid ${borderColor}`;
  cell.style.padding = padding;
  cell.style.verticalAlign = 'top';
  if (shade) {
    cell.style.background = shade;
  }

  contentNodes.forEach((node) => {
    if (node) {
      cell.appendChild(node);
    }
  });

  row.appendChild(cell);
  table.appendChild(row);
  return table;
}

function createDocxBlockquoteTable(blockquote) {
  const table = document.createElement('table');
  table.setAttribute('role', 'presentation');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.margin = '0 0 16px';
  table.style.tableLayout = 'fixed';

  const colgroup = document.createElement('colgroup');
  const accentCol = document.createElement('col');
  accentCol.style.width = '6px';
  const contentCol = document.createElement('col');
  colgroup.append(accentCol, contentCol);
  table.appendChild(colgroup);

  const row = document.createElement('tr');
  const accentCell = document.createElement('td');
  accentCell.style.background = '#6366f1';
  accentCell.style.width = '6px';
  accentCell.style.padding = '0';
  accentCell.style.fontSize = '0';
  accentCell.style.lineHeight = '0';
  accentCell.innerHTML = '&nbsp;';

  const contentCell = document.createElement('td');
  contentCell.style.background = '#f8fafc';
  contentCell.style.padding = '12px 16px';
  contentCell.style.verticalAlign = 'top';
  contentCell.style.color = '#4b5563';

  Array.from(blockquote.childNodes).forEach((child) => {
    contentCell.appendChild(child.cloneNode(true));
  });

  const firstParagraph = contentCell.querySelector('p');
  if (firstParagraph) {
    firstParagraph.style.marginTop = '0';
  }

  Array.from(contentCell.querySelectorAll('p')).forEach((paragraph) => {
    paragraph.style.margin = '0 0 10px';
  });
  const lastParagraph = contentCell.querySelector('p:last-of-type');
  if (lastParagraph) {
    lastParagraph.style.marginBottom = '0';
  }

  row.append(accentCell, contentCell);
  table.appendChild(row);
  return table;
}

function createDocxCodeBlockTable(pre) {
  const codeText = (pre.textContent || '').replace(/\r\n/g, '\n');
  const lines = codeText.split('\n');
  const contentNodes = [];

  lines.forEach((line, index) => {
    const paragraph = document.createElement('p');
    paragraph.style.margin = '0';
    if (index < lines.length - 1) {
      paragraph.style.marginBottom = '2px';
    }
    paragraph.style.fontFamily = "'JetBrains Mono', 'Courier New', monospace";
    paragraph.style.fontSize = '12px';
    paragraph.style.lineHeight = '1.55';
    paragraph.style.color = '#111827';

    const text = (line || '').replace(/\t/g, '    ');
    paragraph.textContent = text ? text.replace(/ /gu, '\u00a0') : '\u00a0';

    contentNodes.push(paragraph);
  });

  return createDocxFramedTable({
    borderColor: '#d1d5db',
    contentNodes,
    padding: '12px 14px',
    shade: '#f8fafc',
  });
}

export function buildDocxHtmlDocument(snapshot) {
  const template = document.createElement('template');
  replaceChildrenFromHtml(template.content, snapshot.html);

  Array.from(template.content.querySelectorAll('.table-wrapper')).forEach((wrapper) => {
    const table = wrapper.querySelector(':scope > table');
    if (!table) {
      return;
    }

    applyDocxTableStyles(table);
    wrapper.replaceWith(table);
  });

  Array.from(template.content.querySelectorAll('table')).forEach((table) => {
    applyDocxTableStyles(table);
  });

  Array.from(template.content.querySelectorAll('pre')).forEach((pre) => {
    pre.replaceWith(createDocxCodeBlockTable(pre));
  });

  Array.from(template.content.querySelectorAll('figure.export-diagram[data-export-docx-src]')).forEach((figure) => {
    const docxSrc = figure.getAttribute('data-export-docx-src');
    const svgElement = figure.querySelector('svg');
    if (!docxSrc || !svgElement) {
      return;
    }

    const image = document.createElement('img');
    image.alt = figure.getAttribute('data-export-label') || 'Diagram';
    image.className = 'export-diagram-image';
    image.src = docxSrc;
    image.style.display = 'block';
    image.style.width = '100%';
    image.style.height = 'auto';
    figure.replaceWith(createDocxFramedTable({
      contentNodes: [image],
      padding: '12px',
    }));
  });

  Array.from(template.content.querySelectorAll('figure.export-video-poster')).forEach((figure) => {
    const card = figure.querySelector('.export-video-poster-card');
    const posterImage = figure.querySelector('.export-video-poster-image');
    const link = figure.querySelector('.export-video-link');
    const title = figure.querySelector('.export-video-poster-copy strong');
    const meta = figure.querySelector('.export-video-poster-meta');
    const replacement = document.createElement('div');
    replacement.className = 'export-video-poster-docx';

    if (posterImage instanceof HTMLImageElement) {
      const image = document.createElement('img');
      image.alt = posterImage.alt || title?.textContent || 'Embedded video poster';
      image.className = 'export-video-poster-image';
      image.src = posterImage.getAttribute('data-export-docx-src') || posterImage.getAttribute('src') || '';
      replacement.appendChild(image);
    }

    if (title?.textContent) {
      const titleParagraph = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = title.textContent;
      titleParagraph.appendChild(strong);
      replacement.appendChild(titleParagraph);
    }

    if (meta?.textContent) {
      const metaParagraph = document.createElement('p');
      metaParagraph.className = 'export-video-poster-meta';
      metaParagraph.textContent = meta.textContent;
      replacement.appendChild(metaParagraph);
    }

    if (link instanceof HTMLAnchorElement && link.href) {
      const linkParagraph = document.createElement('p');
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.textContent = link.textContent || link.href;
      linkParagraph.appendChild(anchor);
      replacement.appendChild(linkParagraph);
    }

    if (!replacement.childNodes.length && card?.textContent) {
      const fallbackParagraph = document.createElement('p');
      fallbackParagraph.textContent = card.textContent;
      replacement.appendChild(fallbackParagraph);
    }

    figure.replaceWith(createDocxFramedTable({
      contentNodes: [replacement],
      padding: '12px',
    }));
  });

  Array.from(template.content.querySelectorAll('[data-export-docx-src]')).forEach((element) => {
    if (!(element instanceof HTMLImageElement)) {
      return;
    }

    const docxSrc = element.getAttribute('data-export-docx-src');
    if (!docxSrc) {
      return;
    }
    element.setAttribute('src', docxSrc);
  });

  Array.from(template.content.querySelectorAll('blockquote')).forEach((blockquote) => {
    blockquote.replaceWith(createDocxBlockquoteTable(blockquote));
  });

  Array.from(template.content.querySelectorAll('figure')).forEach((figure) => {
    if (figure.closest('table')) {
      return;
    }

    const image = figure.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    const framedImage = image.cloneNode(true);
    framedImage.style.display = 'block';
    framedImage.style.width = '100%';
    framedImage.style.height = 'auto';
    figure.replaceWith(createDocxFramedTable({
      contentNodes: [framedImage],
      padding: '12px',
    }));
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${snapshot.title}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; line-height: 1.6; }
    main { max-width: 760px; margin: 0 auto; }
    h1, h2, h3, h4, h5, h6 { color: #111827; margin: 1.3em 0 0.6em; line-height: 1.2; }
    h1 { font-size: 28px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }
    h2 { font-size: 22px; }
    h3 { font-size: 18px; }
    p, ul, ol, blockquote, pre, table, figure { margin: 0 0 16px; }
    a { color: #4338ca; text-decoration: underline; }
    pre { padding: 12px; border: 1px solid #d1d5db; background: #f8fafc; overflow: hidden; }
    code { font-family: 'JetBrains Mono', 'Courier New', monospace; background: #f3f4f6; padding: 2px 4px; }
    pre code { background: transparent; padding: 0; display: block; white-space: pre-wrap; }
    blockquote { padding-left: 14px; border-left: 3px solid #6366f1; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; }
    th, td { border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    img { max-width: 100%; height: auto; }
    .export-video-poster-docx { margin: 0 0 16px; }
    .export-video-poster-card { padding: 14px 16px; border: 1px solid #d1d5db; background: #f8fafc; }
    .export-video-poster-image { display: block; margin: 0 0 12px; }
    .export-video-poster-meta { display: block; color: #6b7280; font-size: 12px; margin-top: 4px; }
    .export-video-link { display: block; margin-top: 8px; word-break: break-word; }
    .export-warning { color: #b45309; }
  </style>
</head>
<body>
  <main>${template.innerHTML}</main>
</body>
</html>`;
}

export function buildHtmlDocument(snapshot) {
  const template = document.createElement('template');
  replaceChildrenFromHtml(template.content, snapshot.html);
  Array.from(template.content.querySelectorAll('[data-export-docx-src]')).forEach((element) => {
    element.removeAttribute('data-export-docx-src');
  });

  const theme = normalizeExportTheme(snapshot.theme);
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(snapshot.title)}</title>
  <style>${HTML_EXPORT_STYLES.replace(/<\/style/giu, '<\\/style')}</style>
</head>
<body data-theme="${theme}">
  <main class="export-page-shell">
    <article class="preview-content export-content">${template.innerHTML}</article>
  </main>
</body>
</html>`;
}

export function htmlAdapter(snapshot) {
  downloadBlob(
    new Blob([buildHtmlDocument(snapshot)], { type: 'text/html;charset=utf-8' }),
    `${createDocumentTitle(snapshot.filePath, snapshot.title)}.html`,
    { removeDelayMs: 0, revokeDelayMs: 1000 },
  );
}

export async function docxAdapter(snapshot) {
  const response = await fetch(resolveApiUrl('/export/docx'), {
    body: JSON.stringify({
      filePath: snapshot.filePath,
      html: buildDocxHtmlDocument(snapshot),
      title: snapshot.title,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Failed to export DOCX');
  }

  const blob = await response.blob();
  downloadBlob(blob, `${createDocumentTitle(snapshot.filePath, snapshot.title)}.docx`, {
    removeDelayMs: 0,
    revokeDelayMs: 1000,
  });
}

export async function printPdfAdapter() {
  await waitForAnimationFrame();
  await waitForAnimationFrame();

  await new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, 1500);
    const handleAfterPrint = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('afterprint', handleAfterPrint);
      resolve();
    };
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    window.print();
  });
}

export async function waitForRenderedExportContent(container, {
  settleFrames = 2,
  timeoutMs = EXPORT_RENDER_SETTLE_TIMEOUT_MS,
} = {}) {
  if (!container) {
    return '';
  }

  const imageWaiters = Array.from(container.querySelectorAll('img')).map((image) => (
    waitForImageElement(image, { timeoutMs })
  ));
  const fontReadyPromise = document.fonts?.ready
    ? Promise.resolve(document.fonts.ready).catch(() => {})
    : Promise.resolve();

  await Promise.allSettled([
    fontReadyPromise,
    ...imageWaiters,
  ]);

  for (let index = 0; index < settleFrames; index += 1) {
    await waitForAnimationFrame();
  }

  return container.innerHTML;
}

export async function runExportAdapter(snapshot, format) {
  if (format === 'pdf') {
    await printPdfAdapter(snapshot);
    return;
  }

  if (format === 'html') {
    await htmlAdapter(snapshot);
    return;
  }

  await docxAdapter(snapshot);
}

export function postExportPageMessage(type, payload = {}) {
  if (!window.opener || window.opener.closed) {
    return;
  }

  window.opener.postMessage({
    ...payload,
    source: EXPORT_PAGE_SOURCE,
    type,
  }, window.location.origin);
}

export async function waitForBootstrapPayload() {
  const searchParams = new URLSearchParams(window.location.search);
  const requestedAction = searchParams.get('action');
  const action = ['html', 'pdf'].includes(requestedAction) ? requestedAction : 'docx';
  const filePath = searchParams.get('file') || '';
  const jobId = searchParams.get('job') || window.name || '';

  if (jobId && window.opener && !window.opener.closed) {
    postExportPageMessage('ready', { jobId });

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for export data'));
      }, 10000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        window.removeEventListener('message', handleMessage);
      };

      const handleMessage = (event) => {
        if (event.origin !== window.location.origin) {
          return;
        }

        const payload = event.data;
        if (!payload || payload.source !== EXPORT_HOST_SOURCE || payload.type !== 'bootstrap' || payload.jobId !== jobId) {
          return;
        }

        cleanup();
        resolve({
          action: ['html', 'pdf'].includes(payload.action) ? payload.action : action,
          currentFilePath: payload.currentFilePath || '',
          currentMarkdownText: payload.currentMarkdownText || '',
          directoryPath: payload.directoryPath || '',
          fileList: Array.isArray(payload.fileList) ? payload.fileList : [],
          filePath: payload.filePath || filePath,
          markdownText: payload.markdownText || '',
          theme: normalizeExportTheme(payload.theme),
          title: payload.title || '',
        });
      };

      window.addEventListener('message', handleMessage);
    });
  }

  return {
    action,
    fileList: [],
    filePath,
    markdownText: filePath ? await fetchTextFile(filePath) : '',
    theme: 'light',
    title: '',
  };
}
