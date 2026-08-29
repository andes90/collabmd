import {
  cancelIdleRender,
  IDLE_RENDER_TIMEOUT_MS,
  requestIdleRender,
} from './preview-diagram-utils.js';
import { getRenderProfile } from './preview-render-profile.js';

export class PreviewRenderScheduler {
  constructor({ getRenderProfileFn = getRenderProfile } = {}) {
    this.getRenderProfileFn = getRenderProfileFn;
    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
  }

  queue({ markdownText, onRenderRequested, renderVersion }) {
    const renderProfile = this.getRenderProfileFn(markdownText);
    this.cancel();

    const scheduleFrame = () => {
      this.frameId = requestAnimationFrame(() => {
        this.frameId = null;
        this.timeoutId = null;
        onRenderRequested?.(markdownText, renderVersion);
      });
    };

    const scheduleRender = () => {
      if (renderProfile.deferUntilIdle) {
        this.idleId = requestIdleRender(() => {
          this.idleId = null;
          scheduleFrame();
        }, IDLE_RENDER_TIMEOUT_MS);
        return;
      }

      scheduleFrame();
    };

    this.timeoutId = setTimeout(scheduleRender, renderProfile.debounceMs);
  }

  cancel() {
    clearTimeout(this.timeoutId);
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }
    cancelIdleRender(this.idleId);
    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
  }

  destroy() {
    this.cancel();
  }
}
