function getWindowRef() {
  return typeof window === 'undefined' ? globalThis : window;
}

export function revealDisclosureAncestors(target) {
  for (let details = target.parentElement?.closest('details'); details; details = details.parentElement?.closest('details')) {
    if (!details.open && !details.querySelector(':scope > summary')?.contains(target)) {
      details.open = true;
    }
  }
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;

    const cleanup = (files = []) => {
      if (settled) {
        return;
      }

      settled = true;
      input.remove();
      resolve(Array.from(files ?? []));
    };

    input.addEventListener('change', () => cleanup(input.files), { once: true });
    input.addEventListener('cancel', () => cleanup(), { once: true });
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

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // HTTP LAN workspaces do not expose the Clipboard API.
  const previousFocus = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.className = 'clipboard-fallback';
  document.body.appendChild(input);
  input.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    input.remove();
    previousFocus?.focus();
  }
}

const getNotificationApi = () => (typeof globalThis.Notification === 'function' ? globalThis.Notification : null);

export const browserNotifications = {
  getPermission() {
    return getNotificationApi()?.permission ?? 'unsupported';
  },

  async requestPermission() {
    const api = getNotificationApi();
    if (!api?.requestPermission) return 'unsupported';
    if (api.permission !== 'default') return api.permission;
    try { return await api.requestPermission(); } catch { return api.permission ?? 'default'; }
  },

  show({ body, onClick, tag, title } = {}) {
    const api = getNotificationApi();
    if (!api || api.permission !== 'granted' || !body) return null;
    try {
      const notification = new api(title, { body, renotify: true, tag });
      if (onClick) notification.onclick = onClick;
      return notification;
    } catch {
      return null;
    }
  },
};
