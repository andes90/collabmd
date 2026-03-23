import {
  expect,
  openFile,
  openHome,
  openSampleFull,
  pasteClipboardImage,
  replaceEditorContent,
  setHydrateDelay,
  test,
  waitForCollaborativeEditor,
  waitForEditor,
  waitForHeavyPreviewContent,
  appendEditorContent,
} from './helpers/app-fixture.js';

async function applyBlockToolbarAction(page, action) {
  await page.locator('[data-markdown-block-menu-toggle]').click();
  await page.locator(`[data-markdown-block-action="${action}"]`).click();
}

test('shows empty state when no file is selected', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.empty-state-title')).toContainText('Welcome to CollabMD');
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

test('sidebar shows vault file tree', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();
  await expect(page.locator('#fileTree')).toContainText('README');
});

test('renders markdown preview when a file is opened', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');
});

test('shows provisional content before delayed websocket sync and upgrades to collaborative editing', async ({ page }) => {
  await setHydrateDelay(page, 700);

  try {
    await openFile(page, 'README.md', { waitFor: 'loaded' });

    await expect.poll(async () => (
      page.locator('#editorContainer').evaluate((element) => element.dataset.editorMode || '')
    )).toBe('provisional');
    await expect(page.locator('#previewContent')).toContainText('My Vault');
    await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

    await waitForCollaborativeEditor(page);
    await replaceEditorContent(page, '# Live After Bootstrap\n\nCollaborative editing restored.\n');
    await expect(page.locator('#previewContent')).toContainText('Live After Bootstrap');
    await expect(page.locator('#previewContent')).toContainText('Collaborative editing restored.');
  } finally {
    await setHydrateDelay(page, 0);
  }
});

test('escapes raw html in markdown preview', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Safe Preview\n\nLine one<br>Line two\n\n<script>window.__collabmdXss = true</script>\n<div id="raw-html">inline html</div>');

  await expect(page.locator('#previewContent script')).toHaveCount(0);
  await expect(page.locator('#previewContent #raw-html')).toHaveCount(0);
  await expect(page.locator('#previewContent p').first()).toHaveText('Line oneLine two');
  await expect(page.locator('#previewContent p').first().locator('br')).toHaveCount(1);
  await expect(page.locator('#previewContent')).toContainText('<script>window.__collabmdXss = true</script>');
});

test('video toolbar helper converts a selected video url into markdown embed syntax', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Meta+A');
  await page.locator('[data-markdown-action="video"]').click();

  await expect(page.locator('.cm-content').first()).toContainText('![Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');
  await expect(page.locator('#previewContent .video-embed-iframe')).toBeVisible();
  await expect(page.locator('#previewContent .video-embed-iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('block toolbar switches heading levels and resets back to paragraph text', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, 'Heading');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'heading-1');
  await expect(page.locator('.cm-content').first()).toContainText('# Heading');
  await expect(page.locator('[data-markdown-block-trigger-label]')).toHaveText('H1');

  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'heading-3');
  await expect(page.locator('.cm-content').first()).toContainText('### Heading');
  await expect(page.locator('[data-markdown-block-trigger-label]')).toHaveText('H3');

  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'paragraph');
  await expect(page.locator('.cm-content').first()).toContainText('Heading');
  await expect(page.locator('.cm-content').first()).not.toContainText('# Heading');
  await expect(page.locator('[data-markdown-block-trigger-label]')).toHaveText('P');
});

test('block toolbar converts bullet lists to numbered lists without duplicating markers', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, 'alpha\nbeta');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'bullet-list');
  await expect(page.locator('.cm-content').first()).toContainText('- alpha');
  await expect(page.locator('.cm-content').first()).toContainText('- beta');

  await page.keyboard.press('Meta+A');
  await applyBlockToolbarAction(page, 'numbered-list');
  await expect(page.locator('.cm-content').first()).toContainText('1. alpha');
  await expect(page.locator('.cm-content').first()).toContainText('2. beta');
  await expect(page.locator('.cm-content').first()).not.toContainText('1. - alpha');
});

test('image toolbar uploads a vault attachment and inserts inline markdown', async ({ page }) => {
  await openFile(page, 'README.md');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0f172a"/></svg>'),
    mimeType: 'image/svg+xml',
    name: 'inline-diagram.svg',
  });

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toMatch(/!\[inline diagram\]\(README\.assets\/inline-diagram-/i);

  await expect(page.locator('#fileTree')).toContainText('README.assets');
  await expect(page.locator('#previewContent img')).toBeVisible();
  await expect(page.locator('#previewContent img')).toHaveAttribute(
    'src',
    /\/api\/attachment\?path=README\.assets%2Finline-diagram-/,
  );
});

test('image lightbox uses a fullscreen stage with click zoom, reset, and close', async ({ page }) => {
  await openFile(page, 'README.md');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0f172a"/><circle cx="24" cy="24" r="10" fill="#f8fafc"/></svg>'),
    mimeType: 'image/svg+xml',
    name: 'lightbox-target.svg',
  });

  const previewImage = page.locator('#previewContent img').first();
  await expect(previewImage).toBeVisible();

  await previewImage.click();
  await expect(page.locator('.image-lightbox-root')).toBeVisible();
  await expect(page.locator('.image-lightbox-toolbar')).toBeVisible();

  const lightboxImage = page.locator('.image-lightbox-image');
  const zoomLabel = page.locator('.image-lightbox-zoom-label');
  await expect(zoomLabel).toHaveText('100%');

  await lightboxImage.click();
  await expect(zoomLabel).toHaveText('200%');

  await page.locator('.image-lightbox-controls').getByText('Reset', { exact: true }).click();
  await expect(zoomLabel).toHaveText('100%');

  await page.locator('.image-lightbox-controls').getByText('Close', { exact: true }).click();
  await expect(page.locator('.image-lightbox-root')).toBeHidden();
});

test('switching from a YouTube markdown preview to an image file clears the video overlay', async ({ page }) => {
  await openFile(page, 'README.md');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#0f172a"/><circle cx="24" cy="24" r="10" fill="#f8fafc"/></svg>'),
    mimeType: 'image/svg+xml',
    name: 'preview-switch.svg',
  });

  await replaceEditorContent(page, [
    '# Video Preview',
    '',
    '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
  ].join('\n'));

  await expect(page.locator('#previewContent .video-embed-iframe')).toBeVisible();
  await expect(page.locator('#previewContent [data-video-overlay-root="true"]')).toBeVisible();

  await page.locator('#fileTree').getByText('README.assets').click();
  await page.locator('#fileTree .file-tree-item', { hasText: 'preview-switch' }).click();

  await expect(page.locator('#previewContent').locator('.image-file-preview-image')).toBeVisible();
  await expect(page.locator('#previewContent .video-embed-iframe')).toHaveCount(0);
  await expect(page.locator('#previewContent [data-video-overlay-root="true"]')).toHaveCount(0);
});

test('pasting an image uploads a vault attachment and inserts inline markdown', async ({ page }) => {
  await openFile(page, 'README.md');

  await pasteClipboardImage(page, {
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUs8AAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
  });

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toMatch(/!\[pasted image\]\(README\.assets\/pasted-image-/i);

  await expect(page.locator('#fileTree')).toContainText('README.assets');
  await expect(page.locator('#previewContent img')).toBeVisible();
  await expect(page.locator('#previewContent img')).toHaveAttribute(
    'src',
    /\/api\/attachment\?path=README\.assets%2Fpasted-image-/,
  );
});

test('opens a file by clicking the sidebar', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();

  await page.locator('#fileTree .file-tree-dir', { hasText: 'projects' }).first().click();
  await page.locator('#fileTree .file-tree-item', { hasText: 'collabmd' }).first().click();

  await waitForEditor(page);
  await expect(page.locator('#previewContent')).toContainText('CollabMD Project');
  await expect(page.locator('#activeFileName')).toContainText('collabmd');
});

test('creates files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

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
  await openHome(page);

  await page.locator('#newFolderBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();

  await page.locator('#fileActionInput').fill('plans/archive');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('archive');
});

test('creates files inside a folder from the tree context menu', async ({ page }) => {
  await openHome(page);

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
  await openHome(page);

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

test('moves and deletes files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await page.locator('#newFileBtn').click();
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await page.locator('#fileActionInput').fill('scratchpad');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  const scratchpadItem = page.locator('#fileTree .file-tree-item', { hasText: 'scratchpad' }).first();
  await scratchpadItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('button', { name: 'Rename / move' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionLabel')).toHaveText('Path');
  await page.locator('#fileActionInput').fill('notes/release-notes');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#activeFileName')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).toContainText('release-notes');
  await expect(page.locator('#fileTree')).not.toContainText('scratchpad');
  await expect(page.locator('#fileTree')).toContainText('notes');

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

test('renames folders from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  await page.locator('#newFolderBtn').click();
  await page.locator('#fileActionInput').fill('drafts-old');
  await page.locator('#fileActionSubmit').click();

  const folderItem = page.locator('#fileTree .file-tree-dir', { hasText: 'drafts-old' }).first();
  await folderItem.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Rename / move' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Rename or move folder');
  await expect(page.locator('#fileActionLabel')).toHaveText('Path');
  await page.locator('#fileActionInput').fill('drafts-new');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('drafts-new');
  await expect(page.locator('#fileTree')).not.toContainText('drafts-old');
});

test('deletes empty folders from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  await page.locator('#newFolderBtn').click();
  await page.locator('#fileActionInput').fill('scratch-empty');
  await page.locator('#fileActionSubmit').click();

  const folderItem = page.locator('#fileTree .file-tree-dir', { hasText: 'scratch-empty' }).first();
  await folderItem.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Delete folder');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).not.toContainText('scratch-empty');
});

test('deletes non-empty folders with an explicit recursive confirmation', async ({ page }) => {
  await openHome(page);

  const dailyFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first();
  await dailyFolder.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Delete folder and contents');
  await expect(page.locator('#fileActionCopy')).toContainText('file');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).not.toContainText('daily');
});

test('search can find folders and open them into the expanded tree', async ({ page }) => {
  await openHome(page);

  await page.locator('#fileSearchInput').fill('daily');
  await expect(page.locator('#fileTree')).toContainText('daily');

  await page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first().click();

  await expect(page.locator('#fileSearchInput')).toHaveValue('');
  await expect(page.locator('#fileTree')).toContainText('2026-03-05');
});

test('creates and opens unresolved wiki-link targets', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Create\n\nGo to [[notes/new-page]]');
  await expect(page.locator('#previewContent .wiki-link-new')).toHaveCount(1);

  await page.locator('#previewContent .wiki-link-new').first().click();
  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('new-page');
});

test('redundant hashchange events do not reopen the same markdown file into overlapping sessions', async ({ page }) => {
  await openSampleFull(page);
  await waitForHeavyPreviewContent(page);

  await page.evaluate(() => {
    for (let index = 0; index < 10; index += 1) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  });

  await waitForEditor(page);
  await appendEditorContent(page, 'hashchange marker');

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=sample-full.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toContain('hashchange marker');

  const persistedContent = await page.evaluate(async () => {
    const response = await fetch('/api/file?path=sample-full.md');
    const data = await response.json();
    return data.content || '';
  });

  expect((persistedContent.match(/hashchange marker/g) || []).length).toBe(1);
  expect((persistedContent.match(/CollabMD — Technical Design Document/g) || []).length).toBe(1);
});
