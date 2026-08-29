import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { cp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { getRuntimeVaultDir, resetE2EVaultSnapshot, templateVaultDir } from './vault-snapshot.js';

export const E2E_USER_NAME = 'E2E User';
export const ACTIVE_MAXIMIZED_DRAWIO_SELECTOR = '.drawio-embed.is-maximized[data-drawio-maximized="true"]';
export const ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR = '.excalidraw-embed.is-maximized[data-excalidraw-maximized="true"]';
export const ACTIVE_MAXIMIZED_MERMAID_SELECTOR = '[data-mermaid-maximized-root="true"] .mermaid-shell.is-maximized';
export const ACTIVE_MAXIMIZED_PLANTUML_SELECTOR = '[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized';
export const README_TEST_DOCUMENT = `# My Vault

Welcome to the test vault. This is the top-level readme.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]
`;
let lateStatePrimePending = false;
let runtimeVaultDir = getRuntimeVaultDir();
const clientDistDir = resolve(import.meta.dirname, '../../../dist/client');

export const test = base.extend({
  e2eServer: [async ({ browserName }, use, workerInfo) => {
    const workerId = `${process.pid}-${workerInfo.project.name}-${browserName}-${workerInfo.parallelIndex}`;
    const vaultDir = getRuntimeVaultDir(workerId);
    const publicDir = resolve(import.meta.dirname, `../../../.tmp/e2e-public-${workerId}`);
    const port = await getAvailablePort();
    const baseURL = `http://127.0.0.1:${port}`;
    await Promise.all([
      resetE2EVaultSnapshot(vaultDir),
      rm(publicDir, { force: true, recursive: true }),
    ]);
    await cp(clientDistDir, publicDir, { recursive: true });
    const serverProcess = spawn(process.execPath, [
      'bin/collabmd.js',
      '--no-tunnel',
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      vaultDir,
    ], {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: {
        ...process.env,
        COLLABMD_E2E_WORKER_ID: workerId,
        COLLABMD_E2E_PUBLIC_DIR: publicDir,
        COLLABMD_FILE_WATCHER_ENABLED: 'false',
        NODE_ENV: 'test',
        WS_ROOM_IDLE_GRACE_MS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [];
    const captureOutput = (chunk) => {
      output.push(chunk.toString());
      if (output.length > 80) {
        output.shift();
      }
    };

    serverProcess.stdout.on('data', captureOutput);
    serverProcess.stderr.on('data', captureOutput);

    try {
      await waitForHealth(baseURL, serverProcess, output);
      await use({ baseURL, vaultDir });
    } finally {
      await stopServerProcess(serverProcess);
      await Promise.all([
        rm(publicDir, { force: true, recursive: true }),
        rm(vaultDir, { force: true, recursive: true }),
      ]);
    }
  }, { scope: 'worker' }],
  baseURL: async ({ e2eServer }, use) => {
    await use(e2eServer.baseURL);
  },
  page: async ({ page, e2eServer }, use) => {
    runtimeVaultDir = e2eServer.vaultDir;
    await use(page);
  },
});

async function getAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolvePort(address.port);
          return;
        }

        reject(new Error('Could not allocate a local port for the e2e server.'));
      });
    });
  });
}

async function waitForHealth(baseURL, serverProcess, output, timeoutMs = 120000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`E2E server exited before becoming healthy.\n${output.join('')}`);
    }

    try {
      const response = await fetch(`${baseURL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The process may still be starting.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(`Timed out waiting for E2E server at ${baseURL}.\n${output.join('')}`);
}

async function stopServerProcess(serverProcess) {
  if (serverProcess.exitCode !== null) {
    return;
  }

  serverProcess.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveStop) => serverProcess.once('exit', resolveStop)),
    new Promise((resolveStop) => setTimeout(resolveStop, 5000)),
  ]);

  if (serverProcess.exitCode === null) {
    serverProcess.kill('SIGKILL');
  }
}

test.beforeEach(async ({ browser, page }) => {
  const currentContext = page.context();
  await Promise.all(
    browser.contexts()
      .filter((context) => context !== currentContext)
      .map((context) => context.close().catch(() => {})),
  );
  await resetE2EAppState(page);
  lateStatePrimePending = true;
  await seedStoredUserName(page);
});

test.afterEach(async ({ page }) => {
  try {
    await page.goto('about:blank');
    await page.request.post('/api/test/reset-state');
  } catch {
    // Ignore teardown navigation failures when the page is already closed.
  }
});

export { expect };

async function resetE2EAppState(page, { attempts = 5 } = {}) {
  let lastContent = '';
  const resetServerState = async () => {
    const response = await page.request.post('/api/test/reset-state');
    if (!response.ok()) {
      throw new Error(`reset-state failed: ${response.status()} ${await response.text()}`);
    }
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await resetServerState();
    await resetE2EVaultSnapshot(runtimeVaultDir);
    await resetServerState();

    const readReadme = async () => {
      const response = await page.request.get('/api/file?path=README.md');
      const data = await response.json();
      return typeof data?.content === 'string' ? data.content : '';
    };

    lastContent = await readReadme();

    if (await readmeSnapshotIsStable(readReadme)) {
      return;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`Failed to restore the E2E vault snapshot. README.md content was: ${lastContent}`);
}

async function readmeSnapshotIsStable(readReadme, { requiredMatches = 2 } = {}) {
  let matches = 0;

  await expect.poll(async () => {
    const content = await readReadme();
    const restored = content.includes('# My Vault') && content.includes('Welcome to the test vault');
    matches = restored ? matches + 1 : 0;
    return matches >= requiredMatches;
  }, {
    intervals: [50, 50, 100, 250],
    timeout: 5000,
  }).toBeTruthy();

  return true;
}

async function ensureLateStatePrime(page) {
  if (!lateStatePrimePending) {
    return;
  }

  await resetE2EAppState(page);
  lateStatePrimePending = false;
}

export async function seedStoredUserName(page, name = E2E_USER_NAME) {
  await page.addInitScript((storedName) => {
    window.localStorage.setItem('collabmd-user-name', storedName);
  }, name);
}

export async function waitForEditor(page) {
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15000 });
}

export async function waitForCollaborativeEditor(page) {
  await expect.poll(async () => (
    page.locator('#editorContainer').evaluate((element) => element.dataset.editorMode || '')
  ), { timeout: 15000 }).toBe('collaborative');
}

export async function waitForPreview(page) {
  await expect(page.locator('#previewPane')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#previewContent')).toBeVisible({ timeout: 15000 });
}

export async function openFile(page, filePath, { userName = E2E_USER_NAME, waitFor = 'editor' } = {}) {
  await ensureLateStatePrime(page);
  await seedStoredUserName(page, userName);
  await page.goto(`/#file=${encodeURIComponent(filePath)}`);
  if (waitFor === 'preview') {
    await waitForPreview(page);
    return;
  }

  if (waitFor === 'editor') {
    await waitForEditor(page);
    return;
  }

  if (waitFor === 'loaded') {
    await expect.poll(async () => (
      page.locator('.cm-editor').count()
    ), { timeout: 15000 }).toBeGreaterThan(0);
    return;
  }

  throw new Error(`Unsupported openFile waitFor mode: ${waitFor}`);
}

export async function openHome(page, { userName = E2E_USER_NAME } = {}) {
  await ensureLateStatePrime(page);
  await seedStoredUserName(page, userName);
  await page.goto('/');
  await expect(page.locator('#displayNameDialog')).toBeHidden();
  await expect.poll(async () => (
    page.locator('#fileTree .file-tree-item').count()
  ), { timeout: 15000 }).toBeGreaterThan(0);
}

export async function setHydrateDelay(page, delayMs = 0) {
  const response = await page.request.post('/api/test/hydrate-delay', {
    data: { delayMs },
  });
  if (!response.ok()) {
    throw new Error(`hydrate-delay failed: ${response.status()} ${await response.text()}`);
  }
}

export async function writeVaultFileAndResetCollab(page, { path, content }) {
  lateStatePrimePending = false;
  const resetResponseBeforeWrite = await page.request.post('/api/test/reset-state');
  if (!resetResponseBeforeWrite.ok()) {
    throw new Error(`reset-state failed before write: ${resetResponseBeforeWrite.status()} ${await resetResponseBeforeWrite.text()}`);
  }

  await clearCollaborationSidecars(path);
  const writeResponse = await page.request.put('/api/file', {
    data: { content, path },
  });
  if (!writeResponse.ok()) {
    throw new Error(`write file failed: ${writeResponse.status()} ${await writeResponse.text()}`);
  }

  const resetResponseAfterWrite = await page.request.post('/api/test/reset-state');
  if (!resetResponseAfterWrite.ok()) {
    throw new Error(`reset-state failed after write: ${resetResponseAfterWrite.status()} ${await resetResponseAfterWrite.text()}`);
  }
}

export async function restoreReadmeTestDocument(page) {
  await writeVaultFileAndResetCollab(page, {
    content: README_TEST_DOCUMENT,
    path: 'README.md',
  });
}

export async function restoreVaultFileFromTemplate(page, filePath) {
  const absoluteTemplatePath = resolve(templateVaultDir, filePath);
  const content = await readFile(absoluteTemplatePath, 'utf8');
  await writeVaultFileAndResetCollab(page, {
    content,
    path: filePath,
  });
}

export async function clearCollaborationSidecars(filePath) {
  const targets = [
    resolve(runtimeVaultDir, '.collabmd/comments', `${filePath}.json`),
    resolve(runtimeVaultDir, '.collabmd/yjs', `${filePath}.bin`),
  ];

  await Promise.all(targets.map((target) => rm(target, { force: true }).catch(() => {})));
}

export async function clearReadmeCollaborationSidecars() {
  await clearCollaborationSidecars('README.md');
}

export async function stubPlantUmlRender(page, label = 'plantuml-stub') {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 48"><text x="8" y="28">${label}</text></svg>`,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
}

export async function openSampleFull(page, { plantUmlLabel = 'sample-full-plantuml', waitFor = 'editor' } = {}) {
  await stubPlantUmlRender(page, plantUmlLabel);
  await openFile(page, 'sample-full.md', { waitFor });
}

export async function duplicateVaultFile(page, sourcePath, targetPath) {
  await page.evaluate(async ({ sourcePath: source, targetPath: target }) => {
    // Delete target if it already exists from a previous test run
    const checkResponse = await fetch(`/api/file?path=${encodeURIComponent(target)}`);
    if (checkResponse.ok) {
      await fetch(`/api/file?path=${encodeURIComponent(target)}`, { method: 'DELETE' });
    }

    const sourceResponse = await fetch(`/api/file?path=${encodeURIComponent(source)}`);
    if (!sourceResponse.ok) {
      throw new Error(`Failed to read ${source}`);
    }
    const sourceData = await sourceResponse.json();
    if (typeof sourceData?.content !== 'string') {
      throw new Error(sourceData?.error || `Missing file content for ${source}`);
    }

    const createResponse = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: target,
        content: sourceData.content,
      }),
    });
    const createData = await createResponse.json();
    if (!createData?.ok) {
      throw new Error(createData?.error || `Failed to create ${target}`);
    }
  }, {
    sourcePath,
    targetPath,
  });
}

export async function waitForExcalidrawTestHarness(page) {
  await expect.poll(async () => (
    page.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__?.isReady?.() || false)
  )).toBe(true);
}

export async function waitForExcalidrawFrameHarness(page, selector = '#previewContent .excalidraw-embed iframe') {
  await expect.poll(async () => (
    page.evaluate(async (resolvedSelector) => {
      const iframe = document.querySelector(resolvedSelector);
      const frameWindow = iframe?.contentWindow;
      try {
        return frameWindow?.__COLLABMD_EXCALIDRAW_TEST__?.isReady?.() || false;
      } catch {
        return false;
      }
    }, selector)
  )).toBe(true);

  const handle = await page.locator(selector).first().elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) {
    throw new Error(`Missing iframe for selector: ${selector}`);
  }

  return frame;
}

export async function appendEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(content, { delay: 5 });
}

export async function replaceEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(content);
}

export async function pasteClipboardImage(page, {
  buffer,
  fileName = 'pasted-image.png',
  mimeType = 'image/png',
} = {}) {
  const imageBytes = Array.from(Buffer.from(buffer ?? []));

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const clipboardMode = await page.evaluate(async ({ bytes, name, type }) => {
    const target = document.querySelector('.cm-content');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Missing editor content element');
    }

    const file = new File([new Uint8Array(bytes)], name, { type });

    try {
      if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
        const blob = new Blob([new Uint8Array(bytes)], { type });
        await navigator.clipboard.write([
          new ClipboardItem({
            [type]: blob,
          }),
        ]);
        return 'clipboard';
      }
    } catch {
      // Fall through to a synthetic paste payload. Headless Chromium often rejects image clipboard writes.
    }

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        files: [file],
        items: [{
          getAsFile() {
            return file;
          },
          kind: 'file',
          type,
        }],
      },
    });
    target.dispatchEvent(event);
    return 'synthetic';
  }, {
    bytes: imageBytes,
    name: fileName,
    type: mimeType,
  });

  if (clipboardMode === 'clipboard') {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  }
}

export async function openChat(page) {
  await page.locator('#chatToggleBtn').click();
  await expect(page.locator('#chatPanel')).toBeVisible();
}

export async function sendChatMessage(page, message) {
  await openChat(page);
  await page.locator('#chatInput').fill(message);
  await page.locator('#chatForm').getByRole('button', { name: 'Send' }).click();
}

export async function setEditorSelection(page, targetText, { collapse = false } = {}) {
  await page.evaluate(({ collapseAtStart, target }) => {
    const findView = (root) => {
      const seen = new Set();
      const queue = [root];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) {
          continue;
        }
        seen.add(current);

        if (current.state?.doc && typeof current.dispatch === 'function') {
          return current;
        }

        for (const key of Object.getOwnPropertyNames(current)) {
          try {
            const value = current[key];
            if (!value || typeof value !== 'object' || seen.has(value)) {
              continue;
            }
            queue.push(value);
          } catch {
            // Ignore inaccessible DOM properties while probing for the editor view.
          }
        }
      }

      return null;
    };

    const editor = document.querySelector('.cm-editor');
    const view = findView(editor) || findView(document.querySelector('.cm-content'));
    if (!view) {
      throw new Error('Missing CodeMirror editor view');
    }

    const source = view.state.doc.toString();
    const from = source.indexOf(target);
    if (from < 0) {
      throw new Error(`Missing target text: ${target}`);
    }

    const anchor = collapseAtStart ? from : from + target.length;
    view.dispatch({
      scrollIntoView: true,
      selection: {
        anchor,
        head: from,
      },
    });
    view.focus();
  }, {
    collapseAtStart: collapse,
    target: targetText,
  });
}

export async function dragEditorSelection(page, targetText) {
  const coords = await page.evaluate((target) => {
    const findView = (root) => {
      const seen = new Set();
      const queue = [root];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) {
          continue;
        }
        seen.add(current);

        if (current.state?.doc && typeof current.dispatch === 'function') {
          return current;
        }

        for (const key of Object.getOwnPropertyNames(current)) {
          try {
            const value = current[key];
            if (!value || typeof value !== 'object' || seen.has(value)) {
              continue;
            }
            queue.push(value);
          } catch {
            // Ignore inaccessible DOM properties while probing for the editor view.
          }
        }
      }

      return null;
    };

    const view = findView(document.querySelector('.cm-editor')) || findView(document.querySelector('.cm-content'));
    if (!view) {
      throw new Error('Missing CodeMirror editor view');
    }

    const source = view.state.doc.toString();
    const from = source.indexOf(target);
    if (from < 0) {
      throw new Error(`Missing target text: ${target}`);
    }

    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(from + target.length);
    if (!start || !end) {
      throw new Error(`Missing editor coords for target text: ${target}`);
    }

    return {
      endX: Math.max(end.left + 2, start.left + 6),
      endY: end.top + Math.max((end.bottom - end.top) / 2, 4),
      startX: start.left + 2,
      startY: start.top + Math.max((start.bottom - start.top) / 2, 4),
    };
  }, targetText);

  await page.mouse.move(coords.startX, coords.startY);
  await page.mouse.down();
  await page.mouse.move(coords.endX, coords.endY, { steps: 8 });
}

export async function waitForCommentSelectionChip(page) {
  const chip = page.locator('.comment-selection-chip');
  await expect(chip).toBeVisible();
  await expect.poll(async () => Boolean(await chip.boundingBox())).toBe(true);
  return chip;
}

export async function createComment(page, {
  body,
  collapseSelection = false,
  targetText,
  useInlineChip = false,
} = {}) {
  if (targetText) {
    await setEditorSelection(page, targetText, { collapse: collapseSelection });
  }

  if (useInlineChip) {
    const chip = await waitForCommentSelectionChip(page);
    await chip.click();
  } else {
    await page.locator('#commentSelectionBtn').click();
  }
  await expect(page.locator('.comment-card')).toBeVisible();
  await page.locator('.comment-card-input').fill(body);
  await page.locator('.comment-card').getByRole('button', { name: 'Post comment' }).click();
  await expect(page.locator('.comment-card')).toBeHidden();
}

export async function waitForHeavyPreviewContent(page) {
  await page.waitForFunction(() => {
    const preview = document.getElementById('previewContent');
    return preview && (
      preview.querySelector('.mermaid-shell')
      || preview.querySelector('.mermaid svg')
      || preview.querySelector('.plantuml-shell')
      || preview.querySelector('.plantuml-frame svg')
      || preview.querySelector('.excalidraw-embed-placeholder')
      || preview.querySelector('.excalidraw-embed iframe')
    );
  }, { timeout: 60000 });
}

export async function getHeavyPreviewCounts(page) {
  return page.evaluate(() => ({
    excalidrawIframes: document.querySelectorAll('#previewContent .excalidraw-embed iframe').length,
    excalidrawPlaceholders: document.querySelectorAll('#previewContent .excalidraw-embed-placeholder').length,
    plantumlShells: document.querySelectorAll('#previewContent .plantuml-shell').length,
    plantumlSvgs: document.querySelectorAll('#previewContent .plantuml-frame svg').length,
    mermaidShells: document.querySelectorAll('#previewContent .mermaid-shell').length,
    mermaidSvgs: document.querySelectorAll('#previewContent .mermaid svg').length,
    renderPhase: document.getElementById('previewContent')?.dataset.renderPhase || '',
    scrollHeight: document.getElementById('previewContainer')?.scrollHeight || 0,
  }));
}

export async function getPlantUmlZoomMetrics(page) {
  return page.evaluate(() => {
    const activeShell = document.querySelector('[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized')
      || document.querySelector('#previewContent .plantuml-shell');
    const frame = activeShell?.querySelector('.plantuml-frame');
    const svg = frame?.querySelector('svg');
    const label = activeShell?.querySelector('.plantuml-zoom-label');
    if (!frame || !svg || !label) {
      return null;
    }

    const styles = window.getComputedStyle(frame);
    const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
    const viewportWidth = Math.max(frame.clientWidth - paddingX, 0);
    const baseWidth = svg.viewBox?.baseVal?.width || Number.parseFloat(svg.getAttribute('width') || '') || 0;
    const expectedZoom = Math.max(0.1, Math.min(1, viewportWidth / baseWidth));

    return {
      currentLabel: label.textContent || '',
      expectedLabel: `${Math.round(expectedZoom * 100)}%`,
    };
  });
}

export async function getMermaidZoomMetrics(page) {
  return page.evaluate(() => {
    const activeShell = document.querySelector('[data-mermaid-maximized-root="true"] .mermaid-shell.is-maximized')
      || document.querySelector('#previewContent .mermaid-shell');
    const frame = activeShell?.querySelector('.mermaid-frame');
    const svg = frame?.querySelector('svg');
    const label = activeShell?.querySelector('.mermaid-zoom-label');
    if (!frame || !svg || !label) {
      return null;
    }

    const styles = window.getComputedStyle(frame);
    const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
    const viewBox = svg.viewBox?.baseVal;
    const baseWidth = viewBox?.width || Number.parseFloat(svg.getAttribute('width') || '') || 0;
    const viewportWidth = Math.max(frame.clientWidth - paddingX, 0);
    const expectedZoom = Math.max(0.5, Math.min(3, viewportWidth / baseWidth));

    return {
      currentLabel: label.textContent || '',
      expectedLabel: `${Math.round(expectedZoom * 100)}%`,
    };
  });
}

export async function getPreviewHorizontalOverflowMetrics(page, {
  buttonSelector = '.plantuml-maximize-btn',
  frameSelector = '.plantuml-frame',
  shellSelector = '.plantuml-shell',
  toolbarSelector = '.plantuml-toolbar',
} = {}) {
  return page.evaluate((selectors) => {
    const container = document.getElementById('previewContainer');
    const shell = document.querySelector(`#previewContent ${selectors.shellSelector}`);
    const toolbar = document.querySelector(`#previewContent ${selectors.toolbarSelector}`);
    const frame = document.querySelector(`#previewContent ${selectors.frameSelector}`);
    const button = document.querySelector(`#previewContent ${selectors.buttonSelector}`);

    if (!container || !shell || !toolbar || !frame || !button) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    return {
      containerClientWidth: container.clientWidth,
      containerScrollWidth: container.scrollWidth,
      frameClientWidth: frame.clientWidth,
      frameScrollWidth: frame.scrollWidth,
      shellRightOverflow: Math.max(0, Math.ceil(shellRect.right - containerRect.right)),
      toolbarRightOverflow: Math.max(0, Math.ceil(toolbarRect.right - containerRect.right)),
      maximizeButtonRightOverflow: Math.max(0, Math.ceil(buttonRect.right - containerRect.right)),
    };
  }, {
    buttonSelector,
    frameSelector,
    shellSelector,
    toolbarSelector,
  });
}

export async function getVisibleEditorLineNumbers(page) {
  return page.evaluate(() => (
    Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
      .map((element) => Number.parseInt(element.textContent || '', 10))
      .filter((lineNumber) => Number.isFinite(lineNumber))
  ));
}

export async function getPreviewHeadingOffset(page, sourceLine) {
  return page.evaluate((line) => {
    const container = document.getElementById('previewContainer');
    const heading = document.querySelector(`#previewContent h2[data-source-line="${line}"]`);
    if (!container || !heading) {
      return Number.POSITIVE_INFINITY;
    }

    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return Math.abs(headingRect.top - containerRect.top);
  }, sourceLine);
}

export function createLongMarkdownDocument(lineCount = 80) {
  const lines = ['# Follow Target', ''];

  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(`Line ${index} for follow testing.`);
  }

  return lines.join('\n');
}

export function createScrollSyncRegressionDocument(itemCount = 80) {
  const lines = [
    '# Scroll Sync Regression',
    '',
    '## First section',
    '',
  ];

  for (let index = 1; index <= itemCount; index += 1) {
    lines.push(`- First section item ${index}.`);
  }

  lines.push('', '## Second section', '');

  for (let index = 1; index <= itemCount; index += 1) {
    const suffix = index === 52 ? ' sync target.' : '.';
    lines.push(`- Second section item ${index}${suffix}`);
  }

  return lines.join('\n');
}

export async function ensureMobileSidebarVisible(page) {
  const sidebar = page.locator('#sidebar');
  if (await sidebar.isHidden()) {
    await page.locator('#sidebarToggle').click();
  }

  await expect(sidebar).toBeVisible();
  return sidebar;
}
