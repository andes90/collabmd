import { test, expect } from '@playwright/test';
import { resetE2EVaultSnapshot } from './helpers/vault-snapshot.js';

const E2E_USER_NAME = 'E2E User';

async function seedStoredUserName(page, name = E2E_USER_NAME) {
  await page.addInitScript((storedName) => {
    window.localStorage.setItem('collabmd-user-name', storedName);
  }, name);
}

test.beforeEach(async ({ page }) => {
  await resetE2EVaultSnapshot();
  await seedStoredUserName(page);
});

async function waitForEditor(page) {
  await expect(page.locator('.cm-editor')).toBeVisible();
}

async function openFile(page, filePath) {
  await seedStoredUserName(page);
  await page.goto(`/#file=${encodeURIComponent(filePath)}`);
  await waitForEditor(page);
}

async function stubPlantUmlRender(page, label = 'plantuml-stub') {
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

async function openSampleFull(page, { plantUmlLabel = 'sample-full-plantuml' } = {}) {
  await stubPlantUmlRender(page, plantUmlLabel);
  await openFile(page, 'sample-full.md');
}

async function appendEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(content, { delay: 5 });
}

async function replaceEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(content);
}

async function openChat(page) {
  await page.locator('#chatToggleBtn').click();
  await expect(page.locator('#chatPanel')).toBeVisible();
}

async function sendChatMessage(page, message) {
  await openChat(page);
  await page.locator('#chatInput').fill(message);
  await page.locator('#chatForm').getByRole('button', { name: 'Send' }).click();
}

async function waitForHeavyPreviewContent(page) {
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

async function getHeavyPreviewCounts(page) {
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

async function getPlantUmlZoomMetrics(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('#previewContent .plantuml-frame');
    const svg = frame?.querySelector('svg');
    const label = document.querySelector('#previewContent .plantuml-zoom-label');
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

async function getVisibleEditorLineNumbers(page) {
  return page.evaluate(() => (
    Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
      .map((element) => Number.parseInt(element.textContent || '', 10))
      .filter((lineNumber) => Number.isFinite(lineNumber))
  ));
}

async function getPreviewHeadingOffset(page, sourceLine) {
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

function createLongMarkdownDocument(lineCount = 80) {
  const lines = ['# Follow Target', ''];

  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(`Line ${index} for follow testing.`);
  }

  return lines.join('\n');
}

function createScrollSyncRegressionDocument(itemCount = 80) {
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

test('shows empty state when no file is selected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.empty-state-title')).toContainText('Select a file');
});

test('prompts first-time visitors for a display name', async ({ browser }) => {
  const page = await browser.newPage();

  await page.goto('/');

  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await expect(page.locator('#displayNameTitle')).toHaveText('Choose your display name');
  await expect(page.locator('#displayNameCopy')).toContainText('continue as a guest');
  await expect(page.locator('#displayNameCancel')).toHaveText('Skip for now');
  await expect(page.locator('#displayNameInput')).toHaveValue('');

  await page.locator('#displayNameCancel').click();
  await expect(page.locator('#displayNameDialog')).not.toBeVisible();
  await expect.poll(async () => (
    page.evaluate(() => window.localStorage.getItem('collabmd-user-name'))
  )).toBeNull();

  await page.close();
});

test('allows explicit session takeover between tabs in the same browser context', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await openFile(pageA, 'README.md');
  await seedStoredUserName(pageB);
  await pageB.goto('/#file=README.md');

  await expect(pageB.locator('#tabLockOverlay')).toBeVisible();
  await expect(pageB.locator('#tabLockTitle')).toHaveText('This vault is active in another tab');

  await pageB.locator('#tabLockTakeoverBtn').click();

  await expect(pageB.locator('#tabLockOverlay')).toBeHidden();
  await expect(pageB.locator('.cm-editor')).toBeVisible();
  await expect(pageA.locator('#tabLockOverlay')).toBeVisible();
  await expect(pageA.locator('#tabLockTitle')).toHaveText('This tab is no longer active');

  await context.close();
});

test('sidebar shows vault file tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#fileTree')).toBeVisible();
  await expect(page.locator('#fileTree')).toContainText('README');
});

test('renders markdown preview when a file is opened', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');
});

test('creates, replies to, and resolves source-anchored comments', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, [
    '# Comment target',
    '',
    'First paragraph for review.',
    '',
    '## Second section',
    '',
    'Another paragraph that needs a follow-up.',
  ].join('\n'));

  await page.locator('#previewContent [data-source-line="3"] .comment-anchor-btn').click();
  await expect(page.locator('#commentsPanel')).toHaveClass(/expanded/);

  await page.locator('#commentComposerInput').fill('Please expand this explanation.');
  await page.locator('#commentComposerForm').getByRole('button', { name: 'Post comment' }).click();

  const thread = page.locator('#commentsList .comment-thread').first();
  await expect(thread).toContainText('Please expand this explanation.');
  await expect(page.locator('#previewContent [data-source-line="3"] .comment-anchor-btn')).toHaveAttribute('data-count', '1');

  await thread.getByRole('button', { name: 'Reply' }).click();
  await thread.locator('.comment-reply-input').fill('Adding a follow-up reply.');
  await thread.locator('.comment-reply-form').getByRole('button', { name: 'Reply' }).click();
  await expect(thread).toContainText('Adding a follow-up reply.');

  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(thread).toBeHidden();
  await expect(page.locator('#previewContent [data-source-line="3"] .comment-anchor-btn')).toHaveAttribute('data-count', '+');
});

test('renders PlantUML fenced blocks through the preview pipeline', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48"><text x="8" y="28">plantuml-fence</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Hello',
    '@enduml',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('plantuml-fence');
});

test('renders embedded PlantUML files through the preview pipeline', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">plantuml-embed</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML Embed',
    '',
    '![[sample-plantuml.puml]]',
  ].join('\n'));

  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('plantuml-embed');
});

test('escapes raw html in markdown preview', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Safe Preview\n\n<script>window.__collabmdXss = true</script>\n<div id="raw-html">inline html</div>');

  await expect(page.locator('#previewContent script')).toHaveCount(0);
  await expect(page.locator('#previewContent #raw-html')).toHaveCount(0);
  await expect(page.locator('#previewContent')).toContainText('<script>window.__collabmdXss = true</script>');
});

test('opens a file by clicking the sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#fileTree')).toBeVisible();

  // Click on README in the file tree
  await page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first().click();

  await waitForEditor(page);
  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#activeFileName')).toContainText('README');
});

test('creates files from the sidebar with the custom dialog', async ({ page }) => {
  await page.goto('/');

  await page.locator('#newFileBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create markdown file');

  await page.locator('#fileActionInput').fill('plans/q1-roadmap');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('q1-roadmap');
  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('q1-roadmap');
});

test('creates empty folders from the sidebar with the custom dialog', async ({ page }) => {
  await page.goto('/');

  await page.locator('#newFolderBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();

  await page.locator('#fileActionInput').fill('plans/archive');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('archive');
});

test('creates files inside a folder from the tree context menu', async ({ page }) => {
  await page.goto('/');

  const dailyFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first();
  await dailyFolder.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'New markdown file' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toContainText('Parent folder: daily');
  await page.locator('#fileActionInput').fill('meeting-notes');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('meeting-notes');
  await expect(page.locator('#fileTree')).toContainText('daily');
  await expect(page.locator('#fileTree')).toContainText('meeting-notes');
});

test('creates root files from empty tree space context menu', async ({ page }) => {
  await page.goto('/');

  await page.locator('#fileSearchInput').fill('zzzz-no-match');
  await expect(page.locator('#fileTree')).toContainText('No matches');

  await page.locator('#fileTree').click({ button: 'right', position: { x: 24, y: 24 } });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'New PlantUML diagram' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toHaveAttribute('hidden', '');
  await page.locator('#fileActionInput').fill('quick-diagram');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('quick-diagram');

  await page.locator('#fileSearchInput').fill('');
  await expect(page.locator('#fileTree')).toContainText('quick-diagram');
});

test('renames and deletes files from the sidebar with the custom dialog', async ({ page }) => {
  await page.goto('/');

  await page.locator('#newFileBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await page.locator('#fileActionInput').fill('scratchpad');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  const scratchpadItem = page.locator('#fileTree .file-tree-item', { hasText: 'scratchpad' }).first();
  await scratchpadItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Rename' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionLabel')).toHaveText('Name');
  await page.locator('#fileActionInput').fill('release-notes');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#activeFileName')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).not.toContainText('scratchpad');

  const renamedItem = page.locator('#fileTree .file-tree-item', { hasText: 'release-notes' }).first();
  await renamedItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionField')).toHaveAttribute('hidden', '');
  await expect(page.locator('#fileActionNote')).toContainText('release-notes.md');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#fileTree')).not.toContainText('release-notes');
});

test('opens excalidraw files with a direct iframe preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#fileTree')).toBeVisible();

  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-excalidraw' }).first().click();

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', /file=sample-excalidraw\.excalidraw/);
  await expect(iframe).not.toHaveAttribute('src', /mode=embed/);
  await expect(page.locator('#previewContent .excalidraw-embed-label')).toHaveText('sample-excalidraw');
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
  await expect(page.locator('#editorPane')).not.toBeVisible();
  await expect(page.locator('#backlinksPanel')).toHaveClass(/hidden/);

  const initialWidths = await page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const embed = document.querySelector('#previewContent .excalidraw-embed');
    if (!container || !embed) {
      return null;
    }

    return {
      containerWidth: container.getBoundingClientRect().width,
      embedWidth: embed.getBoundingClientRect().width,
    };
  });
  expect(initialWidths).not.toBeNull();
  expect(initialWidths.embedWidth).toBeGreaterThan(initialWidths.containerWidth - 48);

  await page.locator('#previewContent .excalidraw-embed-btn', { hasText: 'Max' }).click();
  await expect(page.locator('#previewContent .excalidraw-embed')).toHaveClass(/is-maximized/);

  const maximizedWidths = await page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const embed = document.querySelector('#previewContent .excalidraw-embed.is-maximized');
    if (!container || !embed) {
      return null;
    }

    const rect = embed.getBoundingClientRect();
    return {
      containerWidth: container.getBoundingClientRect().width,
      embedWidth: rect.width,
      left: rect.left,
      right: rect.right,
      innerWidth: window.innerWidth,
    };
  });
  expect(maximizedWidths).not.toBeNull();
  expect(maximizedWidths.embedWidth).toBeGreaterThan(maximizedWidths.containerWidth - 48);
  expect(maximizedWidths.left).toBeGreaterThanOrEqual(0);
  expect(maximizedWidths.right).toBeLessThanOrEqual(maximizedWidths.innerWidth);
});

test('markdown excalidraw embeds stay on the editable editor path', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).not.toHaveAttribute('src', /mode=embed/);
});

test('sample-full renders embedded PlantUML files', async ({ page }) => {
  await openSampleFull(page);

  await page.locator('#previewContent .plantuml-placeholder-btn').first().click();

  await expect(page.locator('#previewContent .plantuml-frame svg').first()).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-frame').first()).toContainText('sample-full-plantuml');
});

test('creates and opens unresolved wiki-link targets', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Create\n\nGo to [[notes/new-page]]');
  await expect(page.locator('#previewContent .wiki-link-new')).toHaveCount(1);

  await page.locator('#previewContent .wiki-link-new').first().click();
  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('new-page');
});

test('syncs collaborative edits across two users on the same file', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await expect(pageA.locator('#userCount')).toHaveText('2 online');

  await appendEditorContent(pageA, '# Shared Draft\n\nUpdated from browser A.');

  await expect(pageB.locator('#previewContent')).toContainText('Shared Draft');
  await expect(pageB.locator('#previewContent')).toContainText('Updated from browser A.');

  await pageA.close();
  await pageB.close();
});

test('syncs disposable lobby chat and tracks unread messages', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await sendChatMessage(pageA, 'Quick sync: reviewing README right now.');

  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText('Quick sync: reviewing README right now.');
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();

  await pageA.close();
  await pageB.close();
});

test('shows a browser notification for a background chat message when alerts are enabled', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageB.addInitScript(() => {
    window.__testNotifications = [];

    class TestNotification {
      static permission = 'granted';

      static async requestPermission() {
        return 'granted';
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        window.__testNotifications.push({ title, ...options });
      }

      addEventListener() { }

      close() { }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: TestNotification,
    });
  });

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await openChat(pageB);
  await pageB.locator('#chatNotificationBtn').click();
  await expect(pageB.locator('#chatNotificationBtn')).toHaveText('Alerts on');
  await pageB.locator('#chatToggleBtn').click();

  await pageB.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
  });

  await sendChatMessage(pageA, 'Background ping from README.');

  await expect.poll(async () => (
    pageB.evaluate(() => window.__testNotifications.length)
  )).toBe(1);

  const notification = await pageB.evaluate(() => window.__testNotifications[0]);
  expect(notification.title).toContain('CollabMD chat');
  expect(notification.body).toBe('README: Background ping from README.');

  await pageA.close();
  await pageB.close();
});

test('follows another user to their current cursor position', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await openFile(followerPage, 'README.md');
  await openFile(targetPage, 'README.md');

  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  await appendEditorContent(targetPage, createLongMarkdownDocument());
  await expect(followerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');

  const initialScrollTop = await followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);
  await followerPage.locator('#userAvatars .user-avatar-button').first().click();

  await expect.poll(async () => (
    followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(initialScrollTop + 150);

  await followerPage.close();
  await targetPage.close();
});

test('keeps preview and outline aligned when scrolling list-heavy editor content', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, createScrollSyncRegressionDocument());
  await expect(page.locator('#previewContent')).toContainText('Second section item 80.');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  const targetEditorLine = page.locator('.cm-line', { hasText: 'Second section item 52 sync target.' }).first();
  await targetEditorLine.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });

  await expect.poll(async () => {
    const activeItem = page.locator('#outlineNav .outline-item.active').first();
    return activeItem.textContent();
  }).toContain('Second section');

  const targetPreviewOffset = await page.locator('#previewContent li', { hasText: 'Second section item 52 sync target.' }).evaluate((item) => {
    const container = document.getElementById('previewContainer');
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Math.abs(itemRect.top - containerRect.top);
  });

  expect(targetPreviewOffset).toBeLessThan(220);
});

test('scrolls the editor to the selected heading when navigating from the outline', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, createScrollSyncRegressionDocument());
  await expect(page.locator('#previewContent')).toContainText('Second section item 80.');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();
  await page.locator('#outlineNav .outline-item', { hasText: 'Second section' }).click();

  const editorHeadingOffset = await page.locator('.cm-line', { hasText: '## Second section' }).first().evaluate((line) => {
    const scroller = document.querySelector('.cm-scroller');
    const scrollerRect = scroller.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return Math.abs(lineRect.top - scrollerRect.top);
  });

  expect(editorHeadingOffset).toBeLessThan(220);

  const previewHeadingOffset = await page.locator('#previewContent h2', { hasText: 'Second section' }).evaluate((heading) => {
    const container = document.getElementById('previewContainer');
    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return Math.abs(headingRect.top - containerRect.top);
  });

  expect(previewHeadingOffset).toBeLessThan(220);
  await expect(page.locator('#outlineNav .outline-item.active').first()).toHaveText('Second section');
});

test('keeps the outline open on desktop after selecting a section', async ({ page }) => {
  await openFile(page, 'README.md');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  await page.locator('#outlineNav .outline-item', { hasText: 'Links' }).click();

  await expect(page.locator('#outlinePanel')).toBeVisible();
});

test('keeps the editor interactive before heavy preview reaches ready', async ({ page }) => {
  test.slow();

  await openSampleFull(page);

  const phase = await page.locator('#previewContent').getAttribute('data-render-phase');
  expect(phase).not.toBe('ready');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');
});

test('progressively hydrates heavy preview instead of rendering all embeds at once', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);

  const counts = await getHeavyPreviewCounts(page);
  expect(counts.mermaidShells + counts.mermaidSvgs).toBeGreaterThan(0);
  expect(counts.excalidrawPlaceholders + counts.excalidrawIframes).toBeGreaterThan(0);
  expect(counts.mermaidSvgs).toBeLessThan(1431);
  expect(counts.excalidrawIframes).toBeLessThan(159);
});

test('preserves excalidraw iframe instances across unrelated preview rerenders', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
      return iframe?.contentWindow?.location?.pathname || '';
    })
  ), { timeout: 60000 }).toBe('/excalidraw-editor.html');

  await page.evaluate(() => {
    const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.__collabmdPreserveProbe = 'alive';
    }
  });

  const firstInstanceId = await page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id');
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id')
  ), { timeout: 60000 }).toBe(firstInstanceId);

  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
      return iframe?.contentWindow?.__collabmdPreserveProbe || '';
    })
  ), { timeout: 60000 }).toBe('alive');
});

test('embedded excalidraw maximize preserves layout and modal sizing', async ({ page }) => {
  test.slow();

  await openSampleFull(page);

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await expect(page.locator('#previewContent .excalidraw-embed-btn', { hasText: 'Expand' })).toHaveCount(0);

  await page.locator('#previewContent .excalidraw-embed-btn', { hasText: 'Max' }).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed-btn', { hasText: 'Restore' }).first()).toBeVisible();

  const afterMaximize = await page.evaluate(() => {
    const embed = document.querySelector('#previewContent .excalidraw-embed.is-maximized');
    const previewContainer = document.getElementById('previewContainer');
    const resizer = document.getElementById('resizer');
    if (!embed || !previewContainer) {
      return null;
    }

    const rect = embed.getBoundingClientRect();
    const resizerRect = resizer?.getBoundingClientRect();
    const probeX = resizerRect ? Math.round(resizerRect.left + (resizerRect.width / 2)) : null;
    const probeY = Math.round(rect.top + 120);
    const topElement = probeX === null
      ? null
      : document.elementFromPoint(probeX, probeY);
    return {
      embedHeight: rect.height,
      embedWidth: rect.width,
      position: window.getComputedStyle(embed).position,
      previewWidth: previewContainer.getBoundingClientRect().width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      left: rect.left,
      right: rect.right,
      resizerOpacity: resizer ? window.getComputedStyle(resizer).opacity : null,
      resizerPointerEvents: resizer ? window.getComputedStyle(resizer).pointerEvents : null,
      hitMaximizedEmbed: Boolean(topElement?.closest('.excalidraw-embed.is-maximized')),
    };
  });

  expect(afterMaximize).not.toBeNull();
  expect(afterMaximize.position).toBe('fixed');
  expect(afterMaximize.embedWidth).toBeGreaterThan(afterMaximize.previewWidth - 48);
  expect(afterMaximize.embedHeight).toBeGreaterThan(afterMaximize.viewportHeight - 220);
  expect(afterMaximize.left).toBeGreaterThanOrEqual(0);
  expect(afterMaximize.right).toBeLessThanOrEqual(afterMaximize.viewportWidth);
  expect(afterMaximize.resizerOpacity).toBe('0');
  expect(afterMaximize.resizerPointerEvents).toBe('none');
  expect(afterMaximize.hitMaximizedEmbed).toBeTruthy();
});

test('embedded excalidraw matches mermaid width in preview-only view', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await page.locator('.view-btn[data-view="preview"]').click();
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  const widths = await page.evaluate(() => {
    const mermaid = document.querySelector('#previewContent .mermaid-shell');
    const excalidraw = document.querySelector('#previewContent .excalidraw-embed');
    if (!mermaid || !excalidraw) {
      return null;
    }

    return {
      mermaidWidth: mermaid.getBoundingClientRect().width,
      excalidrawWidth: excalidraw.getBoundingClientRect().width,
    };
  });

  expect(widths).not.toBeNull();
  expect(Math.abs(widths.mermaidWidth - widths.excalidrawWidth)).toBeLessThanOrEqual(2);
});

test('preserves Mermaid instances across unrelated preview rerenders', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);

  const mermaidKey = await page.evaluate(() => (
    document.querySelector('#previewContent .mermaid-shell')?.getAttribute('data-mermaid-key') || ''
  ));
  expect(mermaidKey).toBeTruthy();

  await page.evaluate((key) => {
    const shell = document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`);
    shell?.querySelector('.mermaid-placeholder-btn')?.click();
  }, mermaidKey);

  await expect.poll(async () => (
    page.evaluate((key) => (
      document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`)?.getAttribute('data-mermaid-instance-id') || ''
    ), mermaidKey)
  ), { timeout: 60000 }).toMatch(/^\d+$/);

  const firstInstanceId = await page.evaluate((key) => (
    document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`)?.getAttribute('data-mermaid-instance-id') || ''
  ), mermaidKey);
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.evaluate((key) => (
      document.querySelector(`#previewContent .mermaid-shell[data-mermaid-key="${key}"]`)?.getAttribute('data-mermaid-instance-id') || ''
    ), mermaidKey)
  ), { timeout: 60000 }).toBe(firstInstanceId);
});

test('preserves PlantUML instances across unrelated preview rerenders', async ({ page }) => {
  test.slow();

  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">plantuml-preserved</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML Preserve',
    '',
    'Intro copy before the diagram.',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Hello',
    '@enduml',
    '```',
    '',
    'Closing copy after the diagram.',
  ].join('\n'));

  await expect.poll(async () => (
    page.evaluate(() => (
      document.querySelector('#previewContent .plantuml-shell')?.getAttribute('data-plantuml-key') || ''
    ))
  ), { timeout: 60000 }).toBeTruthy();

  const plantUmlKey = await page.evaluate(() => (
    document.querySelector('#previewContent .plantuml-shell')?.getAttribute('data-plantuml-key') || ''
  ));
  expect(plantUmlKey).toBeTruthy();

  await page.evaluate((key) => {
    const shell = document.querySelector(`#previewContent .plantuml-shell[data-plantuml-key="${key}"]`);
    shell?.querySelector('.plantuml-placeholder-btn')?.click();
  }, plantUmlKey);

  await expect.poll(async () => (
    page.evaluate((key) => (
      document.querySelector(`#previewContent .plantuml-shell[data-plantuml-key="${key}"]`)?.getAttribute('data-plantuml-instance-id') || ''
    ), plantUmlKey)
  ), { timeout: 60000 }).toMatch(/^\d+$/);

  const firstInstanceId = await page.evaluate((key) => (
    document.querySelector(`#previewContent .plantuml-shell[data-plantuml-key="${key}"]`)?.getAttribute('data-plantuml-instance-id') || ''
  ), plantUmlKey);

  await replaceEditorContent(page, [
    '# PlantUML Preserve',
    '',
    'Updated intro copy without touching the diagram.',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Hello',
    '@enduml',
    '```',
    '',
    'Updated closing copy after the diagram.',
  ].join('\n'));

  await expect.poll(async () => (
    page.evaluate((key) => (
      document.querySelector(`#previewContent .plantuml-shell[data-plantuml-key="${key}"]`)?.getAttribute('data-plantuml-instance-id') || ''
    ), plantUmlKey)
  ), { timeout: 60000 }).toBe(firstInstanceId);
});

test('hydrates more mermaid and excalidraw content as the heavy preview scrolls', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);

  const before = await getHeavyPreviewCounts(page);

  await page.locator('#previewContainer').evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.5;
  });
  await page.waitForTimeout(3000);

  const middle = await getHeavyPreviewCounts(page);

  await page.locator('#previewContainer').evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.85;
  });
  await page.waitForTimeout(3000);

  const after = await getHeavyPreviewCounts(page);
  const mermaidIncreased = middle.mermaidSvgs > before.mermaidSvgs || after.mermaidSvgs > middle.mermaidSvgs;
  const excalidrawIncreased = middle.excalidrawIframes > before.excalidrawIframes || after.excalidrawIframes > middle.excalidrawIframes;
  const layoutExpanded = middle.scrollHeight > before.scrollHeight || after.scrollHeight > middle.scrollHeight;

  expect(mermaidIncreased || excalidrawIncreased || layoutExpanded).toBeTruthy();
});

test('defers heavy preview hydration while the editor is actively scrolling', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);
  await expect.poll(async () => (
    page.locator('#previewContent').getAttribute('data-render-phase')
  ), { timeout: 60000 }).toBe('ready');

  const before = await getHeavyPreviewCounts(page);

  await page.locator('.cm-scroller').evaluate(async (scroller) => {
    await new Promise((resolve) => {
      let steps = 0;
      const timer = window.setInterval(() => {
        scroller.scrollTop += 320;
        steps += 1;
        if (steps >= 4) {
          window.clearInterval(timer);
          resolve();
        }
      }, 20);
    });
  });

  const during = await getHeavyPreviewCounts(page);
  expect(during.mermaidSvgs).toBe(before.mermaidSvgs);
  expect(during.excalidrawIframes).toBe(before.excalidrawIframes);

  await page.waitForTimeout(500);

  const after = await getHeavyPreviewCounts(page);
  expect(after.mermaidSvgs >= during.mermaidSvgs).toBeTruthy();
  expect(after.excalidrawIframes >= during.excalidrawIframes).toBeTruthy();
});

test('keeps editor, preview, and outline aligned in heavy documents after lazy hydration changes layout', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await page.locator('#outlineToggle').click();

  const outlineItems = page.locator('#outlineNav .outline-item[data-source-line]');
  await expect.poll(async () => (
    outlineItems.count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  const outlineItemCount = await outlineItems.count();

  // Pick a heading near the end of the document, but not the very last one, so
  // preview alignment still has room to place it near the top of the viewport.
  const targetIndex = outlineItemCount >= 3 ? outlineItemCount - 3 : outlineItemCount - 1;
  const targetOutlineItem = outlineItems.nth(targetIndex);
  await expect(targetOutlineItem).toBeVisible({ timeout: 60000 });

  const targetLine = Number.parseInt(await targetOutlineItem.getAttribute('data-source-line') || '', 10);
  expect(Number.isFinite(targetLine)).toBeTruthy();

  await targetOutlineItem.click();

  await page.waitForTimeout(1500);

  await expect.poll(async () => {
    const lineNumbers = await getVisibleEditorLineNumbers(page);
    return lineNumbers.includes(targetLine);
  }, { timeout: 60000 }).toBeTruthy();

  await expect.poll(async () => (
    getPreviewHeadingOffset(page, targetLine)
  ), { timeout: 60000 }).toBeLessThan(260);
});

test.describe('mobile outline', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the outline after selecting a section on mobile', async ({ page }) => {
    await openFile(page, 'README.md');

    await page.locator('#mobileViewToggle').click();

    await expect(page.locator('#outlineToggle')).toBeVisible();
    await page.locator('#outlineToggle').click();

    await expect(page.locator('#outlinePanel')).toBeVisible();
    await expect(page.locator('#outlineNav')).toContainText('My Vault');
    await expect(page.locator('#outlineNav')).toContainText('Links');

    await page.locator('#outlineNav .outline-item', { hasText: 'Links' }).click();

    await expect(page.locator('#outlinePanel')).toBeHidden();
  });
});

test('opens .puml files with side-by-side PlantUML preview', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">standalone-puml</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'sample-plantuml.puml');

  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'split');
  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('standalone-puml');
  await expect(page.locator('#previewContent .plantuml-zoom-label')).toHaveText('100%');
  await page.locator('#previewContent .plantuml-tool-btn[aria-label=\"Zoom in\"]').click();
  await expect(page.locator('#previewContent .plantuml-zoom-label')).toHaveText('110%');
  await expect(page.locator('#outlineToggle')).toHaveClass(/hidden/);
  await expect(page.locator('#backlinksPanel')).toHaveClass(/hidden/);
});

test('refits standalone PlantUML diagrams on maximize, resize, and restore', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 400"><text x="40" y="220">resizable-puml</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'sample-plantuml.puml');

  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();

  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();

  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  const zoomedInlineLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();

  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Maximize diagram"]').click();
  await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Restore diagram size"]')).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  const maximizedFitLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  expect(maximizedFitLabel).not.toBe(zoomedInlineLabel);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  const resizedMaximizedLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  expect(resizedMaximizedLabel).not.toBe(maximizedFitLabel);

  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  const zoomedMaximizedLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();

  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Restore diagram size"]').click();
  await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Maximize diagram"]')).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  const restoredLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  expect(restoredLabel).not.toBe(zoomedMaximizedLabel);
});

test.describe('mobile sidebar', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the sidebar when tapping close button on mobile', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('#sidebar');
    if (await sidebar.isHidden()) {
      await page.locator('#sidebarToggle').click();
    }
    await expect(sidebar).toBeVisible();

    await page.locator('#sidebarClose').click();

    await expect(sidebar).toBeHidden();
  });

  test('closes the sidebar after selecting a file on mobile', async ({ page }) => {
    await page.goto('/');

    const sidebar = page.locator('#sidebar');
    if (await sidebar.isHidden()) {
      await page.locator('#sidebarToggle').click();
    }
    await expect(sidebar).toBeVisible();
    await expect(page.locator('#fileTree')).toContainText('README');

    await page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first().click();

    await waitForEditor(page);
    await expect(sidebar).toBeHidden();
  });
});
