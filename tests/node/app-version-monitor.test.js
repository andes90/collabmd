import test from 'node:test';
import assert from 'node:assert/strict';

import { AppVersionMonitor } from '../../src/client/infrastructure/app-version-monitor.js';

function createJsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  });
}

test('AppVersionMonitor seeds its baseline build id from the first successful response', async () => {
  const monitor = new AppVersionMonitor({
    currentBuildId: '',
    documentRef: { hidden: false },
    fetchImpl: async () => createJsonResponse({
      build: {
        id: 'build-1',
        packageVersion: 'test-version',
      },
    }),
    runtimeConfig: { basePath: '' },
  });

  const didDetectUpdate = await monitor.checkNow();

  assert.equal(didDetectUpdate, false);
  assert.equal(monitor.currentBuildId, 'build-1');
  assert.equal(monitor.updateDetected, false);
});

test('AppVersionMonitor notifies once when the deployed build changes', async () => {
  const payloads = [];
  const monitor = new AppVersionMonitor({
    currentBuildId: 'build-1',
    documentRef: { hidden: false },
    fetchImpl: async () => createJsonResponse({
      build: {
        id: 'build-2',
        packageVersion: 'test-version',
      },
    }),
    onUpdateAvailable: (payload) => {
      payloads.push(payload);
    },
    runtimeConfig: { basePath: '' },
  });

  const firstCheck = await monitor.checkNow();
  const secondCheck = await monitor.checkNow();

  assert.equal(firstCheck, true);
  assert.equal(secondCheck, false);
  assert.equal(monitor.updateDetected, true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.build?.id, 'build-2');
});

test('AppVersionMonitor does not notify when the deployed build matches the current build', async () => {
  const payloads = [];
  const monitor = new AppVersionMonitor({
    currentBuildId: 'build-1',
    documentRef: { hidden: false },
    fetchImpl: async () => createJsonResponse({
      build: {
        id: 'build-1',
        packageVersion: 'test-version',
      },
    }),
    onUpdateAvailable: (payload) => {
      payloads.push(payload);
    },
    runtimeConfig: { basePath: '' },
  });

  const didDetectUpdate = await monitor.checkNow();

  assert.equal(didDetectUpdate, false);
  assert.equal(monitor.updateDetected, false);
  assert.deepEqual(payloads, []);
});

test('AppVersionMonitor retries after a failed fetch and can still detect a later update', async () => {
  const payloads = [];
  let callCount = 0;
  const monitor = new AppVersionMonitor({
    currentBuildId: 'build-1',
    documentRef: { hidden: false },
    fetchImpl: async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('temporary failure');
      }

      return createJsonResponse({
        build: {
          id: 'build-2',
          packageVersion: 'test-version',
        },
      });
    },
    onUpdateAvailable: (payload) => {
      payloads.push(payload);
    },
    runtimeConfig: { basePath: '' },
  });

  const firstCheck = await monitor.checkNow();
  const secondCheck = await monitor.checkNow();

  assert.equal(firstCheck, false);
  assert.equal(secondCheck, true);
  assert.equal(callCount, 2);
  assert.equal(monitor.updateDetected, true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.build?.id, 'build-2');
});

test('AppVersionMonitor starts an immediate check and registers periodic polling', async () => {
  const intervalCalls = [];
  const focusHandlers = [];
  const visibilityHandlers = [];
  const fetchCalls = [];
  const documentRef = {
    addEventListener: (eventName, handler) => {
      if (eventName === 'visibilitychange') {
        visibilityHandlers.push(handler);
      }
    },
    hidden: false,
    removeEventListener: () => {},
  };
  const windowRef = {
    addEventListener: (eventName, handler) => {
      if (eventName === 'focus') {
        focusHandlers.push(handler);
      }
    },
    clearInterval: () => {},
    removeEventListener: () => {},
    setInterval: (handler, intervalMs) => {
      intervalCalls.push({ handler, intervalMs });
      return 123;
    },
  };
  const monitor = new AppVersionMonitor({
    currentBuildId: 'build-1',
    documentRef,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse({
        build: {
          id: 'build-1',
          packageVersion: 'test-version',
        },
      });
    },
    runtimeConfig: { basePath: '/collabmd' },
    windowRef,
  });

  monitor.start();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(intervalCalls.length, 1);
  assert.equal(intervalCalls[0].intervalMs, 60_000);
  assert.equal(focusHandlers.length, 1);
  assert.equal(visibilityHandlers.length, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/collabmd/version.json');
  assert.equal(fetchCalls[0].options?.cache, 'no-store');
});
