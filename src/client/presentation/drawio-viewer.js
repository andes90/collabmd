import { getClientRuntimeConfig } from '../domain/runtime-paths.js';

const HOSTED_EDITOR_ORIGIN = 'https://embed.diagrams.net';
const HOSTED_VIEWER_ORIGIN = 'https://viewer.diagrams.net';

let drawioViewerLoadPromise = null;

function resolveViewerScriptUrl() {
  const editorUrl = new URL(getClientRuntimeConfig().drawioBaseUrl);
  if (!['http:', 'https:'].includes(editorUrl.protocol)) {
    throw new Error('Invalid draw.io viewer URL');
  }
  if (editorUrl.origin === HOSTED_EDITOR_ORIGIN && editorUrl.pathname === '/') {
    return new URL('/js/viewer-static.min.js', HOSTED_VIEWER_ORIGIN);
  }
  editorUrl.pathname = `${editorUrl.pathname.replace(/\/$/u, '')}/js/viewer-static.min.js`;
  editorUrl.search = '';
  editorUrl.hash = '';
  return editorUrl;
}

export async function ensureDrawioViewerLoaded() {
  if (window.GraphViewer?.processElements) {
    return window.GraphViewer;
  }

  if (drawioViewerLoadPromise) {
    return drawioViewerLoadPromise;
  }

  const script = document.createElement('script');
  script.src = resolveViewerScriptUrl().href;
  script.async = true;
  script.dataset.collabmdDrawioViewer = 'true';
  drawioViewerLoadPromise = new Promise((resolve, reject) => {
    script.addEventListener('error', () => reject(new Error('Failed to load draw.io viewer')), { once: true });
    script.addEventListener('load', () => {
      if (window.GraphViewer?.processElements) resolve(window.GraphViewer);
      else reject(new Error('draw.io viewer did not initialize'));
    }, { once: true });
    document.head.append(script);
  }).catch((error) => {
    script.remove();
    drawioViewerLoadPromise = null;
    throw error;
  });

  return drawioViewerLoadPromise;
}

export function createDrawioViewerElement({
  ariaLabel = '',
  className = 'drawio-viewer-frame',
  onActivate = null,
  source = '',
  theme = 'dark',
} = {}) {
  const graphElement = document.createElement('div');
  graphElement.className = className;
  if (ariaLabel) {
    graphElement.setAttribute('aria-label', ariaLabel);
  }

  if (typeof onActivate === 'function') {
    graphElement.dataset.action = 'open-file';
    graphElement.setAttribute('role', 'button');
    graphElement.setAttribute('tabindex', '0');
    graphElement.addEventListener('click', (event) => {
      event.preventDefault();
      onActivate();
    });
    graphElement.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      onActivate();
    });
  }

  graphElement.dataset.mxgraph = JSON.stringify({
    'check-visible-state': false,
    center: true,
    border: 0,
    'dark-mode': theme === 'light' ? 'light' : 'dark',
    editable: false,
    fit: 1,
    lightbox: false,
    nav: false,
    resize: false,
    tooltips: false,
    xml: String(source ?? ''),
  });

  return graphElement;
}

export async function renderDrawioViewer(host, { shouldRender = () => true, ...options } = {}) {
  const viewer = await ensureDrawioViewerLoaded();
  if (!shouldRender()) return null;
  const graphElement = createDrawioViewerElement(options);
  host.replaceChildren(graphElement);

  if (typeof viewer.createViewerForElement === 'function') {
    viewer.createViewerForElement(graphElement);
  } else {
    viewer.processElements();
  }

  return graphElement;
}
