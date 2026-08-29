import test from 'node:test';
import assert from 'node:assert/strict';

import { PreviewRenderScheduler } from '../../src/client/application/preview-render-scheduler.js';

function installSchedulingHarness(t) {
  const originalGlobals = {
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    cancelIdleCallback: globalThis.cancelIdleCallback,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    requestIdleCallback: globalThis.requestIdleCallback,
    setTimeout: globalThis.setTimeout,
  };
  const cancelled = [];
  const frames = [];
  const idle = [];
  const timeouts = [];

  Object.assign(globalThis, {
    cancelAnimationFrame: (id) => cancelled.push(['frame', id]),
    cancelIdleCallback: (id) => cancelled.push(['idle', id]),
    clearTimeout: (id) => {
      if (id !== null) cancelled.push(['timeout', id]);
    },
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    requestIdleCallback: (callback, { timeout } = {}) => {
      idle.push({ callback, timeout });
      return idle.length;
    },
    setTimeout: (callback, delay) => {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
  });
  t.after(() => Object.assign(globalThis, originalGlobals));

  return { cancelled, frames, idle, timeouts };
}

test('PreviewRenderScheduler debounces and schedules immediate frame renders', (t) => {
  const { frames, idle, timeouts } = installSchedulingHarness(t);
  const calls = [];
  const scheduler = new PreviewRenderScheduler({
    getRenderProfileFn: () => ({ debounceMs: 12, deferUntilIdle: false }),
  });

  scheduler.queue({
    markdownText: '# Preview',
    onRenderRequested: (markdownText, renderVersion) => {
      calls.push({ markdownText, renderVersion });
    },
    renderVersion: 4,
  });

  assert.equal(timeouts[0].delay, 12);
  assert.equal(frames.length, 0);
  timeouts[0].callback();
  assert.equal(frames.length, 1);
  assert.equal(idle.length, 0);
  frames[0]();
  assert.deepEqual(calls, [{ markdownText: '# Preview', renderVersion: 4 }]);
});

test('PreviewRenderScheduler defers idle renders before the animation frame', (t) => {
  const { frames, idle, timeouts } = installSchedulingHarness(t);
  const calls = [];
  const scheduler = new PreviewRenderScheduler({
    getRenderProfileFn: () => ({ debounceMs: 4, deferUntilIdle: true }),
  });

  scheduler.queue({
    markdownText: 'large doc',
    onRenderRequested: (markdownText, renderVersion) => {
      calls.push({ markdownText, renderVersion });
    },
    renderVersion: 9,
  });

  timeouts[0].callback();
  assert.equal(idle[0].timeout > 0, true);
  idle[0].callback();
  frames[0]();
  assert.deepEqual(calls, [{ markdownText: 'large doc', renderVersion: 9 }]);
});

test('PreviewRenderScheduler cancels timeout, idle, and frame work together', (t) => {
  const { cancelled, idle, timeouts } = installSchedulingHarness(t);
  const scheduler = new PreviewRenderScheduler({
    getRenderProfileFn: () => ({ debounceMs: 1, deferUntilIdle: true }),
  });

  scheduler.queue({
    markdownText: 'cancel me',
    onRenderRequested() {},
    renderVersion: 1,
  });
  timeouts[0].callback();
  scheduler.cancel();

  assert.deepEqual(cancelled, [
    ['timeout', 1],
    ['idle', 1],
  ]);
  assert.equal(idle.length, 1);
});
