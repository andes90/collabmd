import { test as base, expect } from '@playwright/test';

import { resetE2EVaultSnapshot } from './vault-snapshot.js';

export const E2E_USER_NAME = 'E2E User';
export const ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR = '[data-excalidraw-maximized-root="true"] .excalidraw-embed.is-maximized';
export const ACTIVE_MAXIMIZED_PLANTUML_SELECTOR = '[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized';

export const test = base;

test.beforeEach(async ({ page }) => {
  await resetE2EAppState(page);
  await seedStoredUserName(page);
});

export { expect };

async function resetE2EAppState(page, { attempts = 5, stabilityWindowMs = 650 } = {}) {
  let lastContent = '';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await resetE2EVaultSnapshot();
    await page.request.post('http://127.0.0.1:4173/api/test/reset-state');

    const readReadme = async () => {
      const response = await page.request.get('http://127.0.0.1:4173/api/file?path=README.md');
      const data = await response.json();
      return typeof data?.content === 'string' ? data.content : '';
    };

    lastContent = await readReadme();

    if (lastContent.includes('# My Vault') && lastContent.includes('Welcome to the test vault')) {
      await page.waitForTimeout(stabilityWindowMs);
      lastContent = await readReadme();

      if (lastContent.includes('# My Vault') && lastContent.includes('Welcome to the test vault')) {
        return;
      }
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`Failed to restore the E2E vault snapshot. README.md content was: ${lastContent}`);
}

export async function seedStoredUserName(page, name = E2E_USER_NAME) {
  await page.addInitScript((storedName) => {
    window.localStorage.setItem('collabmd-user-name', storedName);
  }, name);
}

export async function waitForEditor(page) {
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 15000 });
}

export async function waitForPreview(page) {
  await expect(page.locator('#previewPane')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#previewContent')).toBeVisible({ timeout: 15000 });
}

export async function openFile(page, filePath, { userName = E2E_USER_NAME, waitFor = 'editor' } = {}) {
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
  await seedStoredUserName(page, userName);
  await page.goto('/');
  await expect(page.locator('#displayNameDialog')).toBeHidden();
  await expect.poll(async () => (
    page.locator('#fileTree .file-tree-item').count()
  ), { timeout: 15000 }).toBeGreaterThan(0);
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

export async function openSampleFull(page, { plantUmlLabel = 'sample-full-plantuml' } = {}) {
  await stubPlantUmlRender(page, plantUmlLabel);
  await openFile(page, 'sample-full.md');
}

export async function duplicateVaultFile(page, sourcePath, targetPath) {
  await page.evaluate(async ({ sourcePath: source, targetPath: target }) => {
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
  const handle = await page.locator(selector).first().elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) {
    throw new Error(`Missing iframe for selector: ${selector}`);
  }

  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__?.isReady?.() || false)
  )).toBe(true);

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
    const activeShell = document.querySelector('#previewContent .mermaid-shell.is-maximized')
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

export async function getPreviewHorizontalOverflowMetrics(page) {
  return page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const shell = document.querySelector('#previewContent .plantuml-shell');
    const toolbar = document.querySelector('#previewContent .plantuml-toolbar');
    const frame = document.querySelector('#previewContent .plantuml-frame');
    const maximizeButton = document.querySelector('#previewContent .plantuml-maximize-btn');

    if (!container || !shell || !toolbar || !frame || !maximizeButton) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const buttonRect = maximizeButton.getBoundingClientRect();

    return {
      containerClientWidth: container.clientWidth,
      containerScrollWidth: container.scrollWidth,
      frameClientWidth: frame.clientWidth,
      frameScrollWidth: frame.scrollWidth,
      shellRightOverflow: Math.max(0, Math.ceil(shellRect.right - containerRect.right)),
      toolbarRightOverflow: Math.max(0, Math.ceil(toolbarRect.right - containerRect.right)),
      maximizeButtonRightOverflow: Math.max(0, Math.ceil(buttonRect.right - containerRect.right)),
    };
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
