import { resolveAppPath } from './runtime-config.js';

const DEFAULT_INTERVAL_MS = 60_000;

function extractBuildId(payload) {
  return String(payload?.build?.id ?? payload?.buildId ?? '').trim();
}

export class AppVersionMonitor {
  constructor({
    currentBuildId = '',
    documentRef = globalThis.document ?? null,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    intervalMs = DEFAULT_INTERVAL_MS,
    onUpdateAvailable = null,
    runtimeConfig = { basePath: '' },
    versionUrl = null,
    windowRef = globalThis.window ?? globalThis,
  } = {}) {
    this.currentBuildId = String(currentBuildId ?? '').trim();
    this.documentRef = documentRef;
    this.fetchImpl = fetchImpl;
    this.intervalHandle = null;
    this.intervalMs = Math.max(5_000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
    this.isChecking = false;
    this.onUpdateAvailable = typeof onUpdateAvailable === 'function' ? onUpdateAvailable : null;
    this.runtimeConfig = runtimeConfig;
    this.updateDetected = false;
    this.versionUrl = versionUrl || resolveAppPath('/version.json', runtimeConfig);
    this.windowRef = windowRef;
    this.handleFocus = () => {
      void this.checkNow({ force: true });
    };
    this.handleVisibilityChange = () => {
      if (this.documentRef?.hidden) {
        return;
      }
      void this.checkNow({ force: true });
    };
  }

  start() {
    if (!this.fetchImpl || this.intervalHandle) {
      return;
    }

    this.documentRef?.addEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.windowRef?.addEventListener?.('focus', this.handleFocus);
    this.intervalHandle = this.windowRef?.setInterval?.(() => {
      void this.checkNow();
    }, this.intervalMs) ?? null;
    void this.checkNow({ force: true });
  }

  stop() {
    if (this.intervalHandle) {
      this.windowRef?.clearInterval?.(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.documentRef?.removeEventListener?.('visibilitychange', this.handleVisibilityChange);
    this.windowRef?.removeEventListener?.('focus', this.handleFocus);
  }

  async checkNow({ force = false } = {}) {
    if (!this.fetchImpl || this.isChecking || this.updateDetected) {
      return false;
    }

    if (!force && this.documentRef?.hidden) {
      return false;
    }

    this.isChecking = true;

    try {
      const response = await this.fetchImpl(this.versionUrl, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response?.ok) {
        return false;
      }

      const payload = await response.json().catch(() => null);
      const nextBuildId = extractBuildId(payload);
      if (!nextBuildId) {
        return false;
      }

      if (!this.currentBuildId) {
        this.currentBuildId = nextBuildId;
        return false;
      }

      if (nextBuildId === this.currentBuildId) {
        return false;
      }

      this.updateDetected = true;
      this.onUpdateAvailable?.(payload);
      return true;
    } catch {
      return false;
    } finally {
      this.isChecking = false;
    }
  }
}

export { extractBuildId };
