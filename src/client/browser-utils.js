function getWindowRef() {
  return typeof window === 'undefined' ? globalThis : window;
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    const windowRef = getWindowRef();
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    let focusTimer = null;

    const cleanup = (files = []) => {
      if (settled) {
        return;
      }

      settled = true;
      if (focusTimer) {
        windowRef.clearTimeout(focusTimer);
      }
      windowRef.removeEventListener('focus', handleWindowFocus);
      input.remove();
      resolve(Array.from(files ?? []));
    };

    const handleWindowFocus = () => {
      focusTimer = windowRef.setTimeout(() => {
        if (settled || input.files?.length) {
          return;
        }

        cleanup();
      }, 250);
    };

    input.addEventListener('change', () => cleanup(input.files), { once: true });
    input.addEventListener('cancel', () => cleanup(), { once: true });
    windowRef.addEventListener('focus', handleWindowFocus, { once: true });
    input.click();
  });
}

export function requestIdleRender(callback, timeout) {
  const windowRef = getWindowRef();
  if (typeof windowRef.requestIdleCallback === 'function') {
    return windowRef.requestIdleCallback(callback, { timeout });
  }

  return windowRef.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1);
}

export function cancelIdleRender(id) {
  if (id === null) {
    return;
  }

  const windowRef = getWindowRef();
  if (typeof windowRef.cancelIdleCallback === 'function') {
    windowRef.cancelIdleCallback(id);
    return;
  }

  windowRef.clearTimeout(id);
}

export function isNearViewport(element, root, marginPx) {
  if (!element || !root) {
    return false;
  }

  const rootRect = root.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return (
    elementRect.bottom >= (rootRect.top - marginPx)
    && elementRect.top <= (rootRect.bottom + marginPx)
  );
}

export function downloadBlob(blob, fileName, {
  removeDelayMs = 1000,
  revokeDelayMs = removeDelayMs,
} = {}) {
  const windowRef = getWindowRef();
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = fileName;
  if (anchor.style) {
    anchor.style.display = 'none';
  }
  document.body.appendChild(anchor);
  anchor.click();

  if (removeDelayMs > 0) {
    windowRef.setTimeout(() => anchor.remove(), removeDelayMs);
  } else {
    anchor.remove();
  }

  windowRef.setTimeout(() => URL.revokeObjectURL(downloadUrl), revokeDelayMs);
}

export function parseDownloadFileName(contentDisposition = '', fallbackName = 'download') {
  const utfMatch = String(contentDisposition).match(/filename\*=UTF-8''([^;]+)/iu);
  if (utfMatch) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return fallbackName;
    }
  }

  const asciiMatch = String(contentDisposition).match(/filename="([^"]+)"/iu);
  return asciiMatch?.[1] || fallbackName;
}
