import assert from 'node:assert/strict';
import test from 'node:test';

import { CanvasEmbedController } from '../../src/client/presentation/canvas-embed-controller.js';
import { uiFeatureTabActivityMethods } from '../../src/client/application/app-shell/ui-feature-tab-activity.js';

function createHost(t) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const posts = [];
  const connections = [];
  const opened = [];
  const listeners = new Set();
  globalThis.window = {
    __COLLABMD_CONFIG__: { activeVault: 'team', basePath: '/docs', vaults: [{ id: 'team' }] },
    addEventListener: (_type, handler) => listeners.add(handler),
    removeEventListener: (_type, handler) => listeners.delete(handler),
    location: { origin: 'https://collab.example', search: '' },
  };
  globalThis.document = {
    createElement: () => ({
      contentWindow: { postMessage: (message, origin) => posts.push({ message, origin }) },
      isConnected: true,
      remove() { this.isConnected = false; },
    }),
  };
  const user = { name: 'Tester', peerId: 'peer-test' };
  const host = new CanvasEmbedController({
    getLocalUser: () => user,
    getTheme: () => 'light',
    onConnectionChange: (state) => connections.push(state),
    onOpenFile: (filePath, options) => opened.push({ filePath, options }),
  });
  host.mount('notes/ideas.canvas', { replaceChildren() {} });
  const receive = (message, overrides = {}) => host.onMessage({
    data: { filePath: 'notes/ideas.canvas', ...message },
    origin: window.location.origin,
    source: host.iframe?.contentWindow,
    ...overrides,
  });
  t.after(() => {
    host.unmount();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });
  return { connections, host, listeners, opened, posts, receive, user };
}

test('canvas host preserves runtime paths and synchronizes only its current same-origin frame', (t) => {
  const { connections, host, opened, posts, receive, user } = createHost(t);
  const url = new URL(host.iframe.src);
  assert.equal(url.pathname, '/docs/canvas-editor.html');
  assert.equal(url.searchParams.get('file'), 'notes/ideas.canvas');
  assert.equal(url.searchParams.get('theme'), 'light');
  assert.equal(url.searchParams.get('vaultId'), 'team');
  assert.equal(url.searchParams.get('userPeerId'), user.peerId);
  receive({ type: 'canvas-ready' }, { origin: 'https://other.example' });
  receive({ type: 'canvas-ready' }, { source: {} });
  receive({ type: 'canvas-ready', filePath: 'old.canvas' });
  assert.equal(host.ready, false);
  assert.equal(posts.length, 0);

  receive({ type: 'canvas-ready' });
  assert.equal(host.ready, true);
  assert.deepEqual(posts, [
    { message: { type: 'canvas-theme', theme: 'light' }, origin: 'https://collab.example' },
    { message: { type: 'canvas-user', user }, origin: 'https://collab.example' },
  ]);
  receive({ type: 'canvas-connection', state: { status: 'connected', unreachable: false } });
  receive({ type: 'canvas-open-file', filePath: 'notes/readme.md' });
  assert.equal(connections.at(-1).status, 'connected');
  assert.deepEqual(opened, [{ filePath: 'notes/readme.md', options: {} }]);
});

test('canvas file links forward standard subpaths through the existing anchor route option', (t) => {
  const { opened, receive } = createHost(t);
  receive({ type: 'canvas-open-file', filePath: 'notes/readme.md', subpath: '#project-plan' });
  receive({ type: 'canvas-open-file', filePath: 'notes/readme.md', subpath: '#^block-id' });
  receive({ type: 'canvas-open-file', filePath: 'notes/readme.md', subpath: 'javascript:alert(1)' });
  assert.deepEqual(opened, [
    { filePath: 'notes/readme.md', options: { anchor: 'project-plan' } },
    { filePath: 'notes/readme.md', options: { anchor: '^block-id' } },
    { filePath: 'notes/readme.md', options: {} },
  ]);
});

test('canvas navigation waits for the matching flush acknowledgement and retains the frame when blocked', async (t) => {
  const { host, listeners, posts, receive } = createHost(t);
  receive({ type: 'canvas-ready' });
  let settled = false;
  const preparation = host.prepareFileDisconnect(host.filePath).then((canLeave) => {
    settled = true;
    return canLeave;
  });
  const { requestId } = posts.at(-1).message;
  receive({ type: 'canvas-disconnect-ready', requestId: 'wrong-request' });
  await Promise.resolve();
  assert.equal(settled, false);
  receive({ type: 'canvas-disconnect-ready', requestId });
  assert.equal(await preparation, true);

  const blocked = host.prepareFileDisconnect(host.filePath);
  receive({ type: 'canvas-disconnect-blocked', requestId: posts.at(-1).message.requestId });
  assert.equal(await blocked, false);
  assert.equal(host.iframe.isConnected, true);
  assert.equal(await host.prepareFileDisconnect(host.filePath, { timeoutMs: 1 }), false);
  host.unmount();
  assert.equal(host.iframe, null);
  assert.equal(listeners.size, 0);
});

test('tab takeover keeps the canvas mounted if pending edits cannot be flushed', async () => {
  let emptied = false;
  const app = {
    canvasEmbed: { prepareFileDisconnect: async () => false },
    chatMessageIds: new Set(),
    currentFilePath: 'ideas.canvas',
    isCanvasFile: () => true,
    isTabActive: true,
    lobby: { disconnect() {} },
    renderChat() {},
    showEmptyState: () => { emptied = true; },
    showTabLockOverlay() {},
    workspaceSync: { disconnect() {} },
  };
  await uiFeatureTabActivityMethods.handleTabBlocked.call(app);
  assert.equal(app.isTabActive, false);
  assert.equal(emptied, false);
  app.canvasEmbed.prepareFileDisconnect = async () => true;
  await uiFeatureTabActivityMethods.handleTabBlocked.call(app);
  assert.equal(emptied, true);
});
