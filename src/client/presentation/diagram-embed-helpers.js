/**
 * Shared DOM/overlay helpers for iframe-based diagram embed controllers.
 */

export function ensureEmbedOverlayRoot(previewElement, currentRoot, {
  className,
  datasetKey,
} = {}) {
  if (currentRoot?.isConnected && currentRoot.parentElement === previewElement) {
    return currentRoot;
  }

  const attrName = `data-${datasetKey.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
  let overlayRoot = previewElement?.querySelector?.(`[${attrName}="true"]`);
  if (!overlayRoot) {
    overlayRoot = document.createElement('div');
    overlayRoot.dataset[datasetKey] = 'true';
    overlayRoot.className = className;
    previewElement?.appendChild(overlayRoot);
  }

  return overlayRoot;
}

export function clearEmbedInlinePositionStyles(wrapper) {
  if (!wrapper?.style) {
    return;
  }

  wrapper.style.position = '';
  wrapper.style.top = '';
  wrapper.style.left = '';
  wrapper.style.width = '';
  wrapper.style.margin = '';
}

export function applyEmbedMaximizedBoxStyles(wrapper, { margin = '' } = {}) {
  if (!wrapper?.style) {
    return;
  }

  clearEmbedInlinePositionStyles(wrapper);
  wrapper.style.width = 'auto';
  wrapper.style.height = 'auto';
  wrapper.style.minHeight = '0';
  wrapper.style.margin = margin;
}

export function applyEmbedOverlayPositionStyles(wrapper, placeholder, { clearHeight = false } = {}) {
  if (!wrapper?.style || !placeholder) {
    return;
  }

  wrapper.style.position = 'absolute';
  wrapper.style.top = `${placeholder.offsetTop}px`;
  wrapper.style.left = `${placeholder.offsetLeft}px`;
  wrapper.style.width = `${placeholder.offsetWidth}px`;
  if (clearHeight) {
    wrapper.style.height = '';
    wrapper.style.minHeight = '';
  }
  wrapper.style.margin = '0';
}

export function resetEmbedPlaceholderLayout(placeholder, datasetKey) {
  if (!placeholder?.isConnected) {
    return;
  }

  placeholder.classList.remove('is-hydrated');
  placeholder.removeAttribute(`data-${datasetKey.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`);
  placeholder.style.height = '';
  placeholder.style.pointerEvents = '';
}

export function insertMaximizeSpacer(entry, spacerClassName) {
  if (!entry?.wrapper?.parentElement || entry.maximizeSpacer) {
    return;
  }

  const spacer = document.createElement('div');
  spacer.className = spacerClassName;
  spacer.style.height = `${Math.ceil(entry.wrapper.getBoundingClientRect().height)}px`;
  entry.maximizeSpacer = spacer;
  entry.wrapper.parentElement.insertBefore(spacer, entry.wrapper);
}

export function removeMaximizeSpacer(entry) {
  if (entry?.maximizeSpacer?.parentElement) {
    entry.maximizeSpacer.remove();
  }
  if (entry) {
    entry.maximizeSpacer = null;
  }
}

export function postHostMessageToEntry(entry, payload) {
  entry?.iframe?.contentWindow?.postMessage(payload, window.location.origin);
}
