import {
  ensureMobileSidebarVisible,
  expect,
  getPreviewHorizontalOverflowMetrics,
  openFile,
  openHome,
  replaceEditorContent,
  test,
  waitForEditor,
  waitForPreview,
} from './helpers/app-fixture.js';

const OUTLINE_TEST_DOCUMENT = `# My Vault

Welcome to the test vault.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]
`;

async function longPress(locator, {
  clientX = 24,
  clientY = 24,
  pointerId = 1,
} = {}) {
  await locator.dispatchEvent('pointerdown', {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
    pointerId,
    pointerType: 'touch',
  });
  await locator.page().waitForTimeout(460);
  await locator.dispatchEvent('pointerup', {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
    pointerId,
    pointerType: 'touch',
  });
}

test.describe('mobile outline', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the outline after selecting a section on mobile', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);
    await replaceEditorContent(page, OUTLINE_TEST_DOCUMENT);
    await expect(page.locator('#previewContent')).toContainText('My Vault');

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

test.describe('mobile linked mentions', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('keeps linked mentions inline instead of showing the desktop dock', async ({ page }) => {
    await openFile(page, 'projects/collabmd.md', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

    await expect(page.locator('#backlinksPanel')).toBeHidden();

    await page.locator('#previewContainer').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    const inlinePanel = page.locator('#backlinksInlinePanel');
    await expect(inlinePanel).toBeVisible();

    await inlinePanel.locator('.backlinks-header').click();
    await expect(inlinePanel).toHaveClass(/expanded/);
    await expect(inlinePanel.locator('.backlinks-body')).toBeVisible();
  });

  test('keeps linked mentions expanded while scrolling a long mobile preview', async ({ page }) => {
    await openFile(page, 'projects/collabmd.md', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);
    await replaceEditorContent(page, [
      '# Mobile Backlinks Stress',
      '',
      ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}: ${'linked mention stability '.repeat(8)}`),
    ].join('\n\n'));
    await page.locator('#mobileViewToggle').click();

    await page.locator('#previewContainer').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    const inlinePanel = page.locator('#backlinksInlinePanel');
    await expect(inlinePanel).toBeVisible();

    await inlinePanel.locator('.backlinks-header').click();
    await expect(inlinePanel).toHaveClass(/expanded/);

    await page.locator('#previewContainer').evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollTop - 32);
    });
    await page.waitForTimeout(200);

    await expect(inlinePanel).toHaveClass(/expanded/);
    await expect(inlinePanel.locator('.backlinks-body')).toBeVisible();
  });
});

test.describe('mobile PlantUML preview', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('keeps embedded and standalone PlantUML previews inside the mobile preview pane', async ({ page }) => {
    await page.route('**/api/plantuml/render', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 1400"><text x="40" y="120">mobile-plantuml</text></svg>',
        }),
        contentType: 'application/json',
        status: 200,
      });
    });

    await openFile(page, 'README.md', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);
    await replaceEditorContent(page, '# Mobile PlantUML\n\n![[sample-plantuml.puml]]');
    await page.locator('#mobileViewToggle').click();
    await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();

    const embeddedMetrics = await getPreviewHorizontalOverflowMetrics(page);
    expect(embeddedMetrics).not.toBeNull();
    expect(embeddedMetrics.containerScrollWidth - embeddedMetrics.containerClientWidth).toBeLessThanOrEqual(1);
    expect(embeddedMetrics.shellRightOverflow).toBeLessThanOrEqual(1);
    expect(embeddedMetrics.toolbarRightOverflow).toBeLessThanOrEqual(1);
    expect(embeddedMetrics.maximizeButtonRightOverflow).toBeLessThanOrEqual(1);
    expect(embeddedMetrics.frameClientWidth).toBeGreaterThan(0);
    expect(embeddedMetrics.frameClientWidth).toBeLessThanOrEqual(embeddedMetrics.containerClientWidth);

    await openFile(page, 'sample-plantuml.puml', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
    await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();

    const standaloneMetrics = await getPreviewHorizontalOverflowMetrics(page);
    expect(standaloneMetrics).not.toBeNull();
    expect(standaloneMetrics.containerScrollWidth - standaloneMetrics.containerClientWidth).toBeLessThanOrEqual(1);
    expect(standaloneMetrics.shellRightOverflow).toBeLessThanOrEqual(1);
    expect(standaloneMetrics.toolbarRightOverflow).toBeLessThanOrEqual(1);
    expect(standaloneMetrics.maximizeButtonRightOverflow).toBeLessThanOrEqual(1);
    expect(standaloneMetrics.frameClientWidth).toBeGreaterThan(0);
    expect(standaloneMetrics.frameClientWidth).toBeLessThanOrEqual(standaloneMetrics.containerClientWidth);
  });
});

test.describe('mobile video embeds', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('keeps markdown video embeds inside the mobile preview pane', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);
    await replaceEditorContent(page, [
      '# Mobile Video',
      '',
      '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
    ].join('\n'));
    await page.locator('#mobileViewToggle').click();
    await expect(page.locator('#previewContent .video-embed-iframe')).toBeVisible();

    const metrics = await getPreviewHorizontalOverflowMetrics(page, {
      buttonSelector: '.video-embed-iframe',
      frameSelector: '.video-embed-frame',
      shellSelector: '.video-embed-shell',
      toolbarSelector: '.video-embed-frame',
    });
    expect(metrics).not.toBeNull();
    expect(metrics.containerScrollWidth - metrics.containerClientWidth).toBeLessThanOrEqual(1);
    expect(metrics.shellRightOverflow).toBeLessThanOrEqual(1);
    expect(metrics.toolbarRightOverflow).toBeLessThanOrEqual(1);
    expect(metrics.maximizeButtonRightOverflow).toBeLessThanOrEqual(1);
    expect(metrics.frameClientWidth).toBeGreaterThan(0);
    expect(metrics.frameClientWidth).toBeLessThanOrEqual(metrics.containerClientWidth);
  });
});

test.describe('mobile sidebar', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the sidebar when tapping close button on mobile', async ({ page }) => {
    await openHome(page);

    const sidebar = await ensureMobileSidebarVisible(page);
    await page.locator('#sidebarClose').click();

    await expect(sidebar).toBeHidden();
  });

  test('closes the sidebar after selecting a file on mobile', async ({ page }) => {
    await openHome(page);

    const sidebar = await ensureMobileSidebarVisible(page);
    await expect(page.locator('#fileTree')).toContainText('README');

    await page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first().click();

    await waitForPreview(page);
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
    await expect(sidebar).toBeHidden();
  });

  test('opens mobile file explorer actions from a long press', async ({ page }) => {
    await openHome(page);
    await ensureMobileSidebarVisible(page);

    await longPress(page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first());
    await expect(page.locator('.file-action-sheet')).toBeVisible();
    await expect(page.locator('.file-action-sheet')).toContainText('Rename / move');

    await page.locator('.file-action-sheet-item', { hasText: 'Cancel' }).click();
    await expect(page.locator('.file-action-sheet')).toBeHidden();

    await longPress(page.locator('#fileTree'));
    await expect(page.locator('.file-action-sheet')).toBeVisible();
    await expect(page.locator('.file-action-sheet')).toContainText('New markdown file');
  });
});

test.describe('mobile markdown toolbar', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('keeps the markdown toolbar as a horizontal scrolling rail', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    const initialMetrics = await page.locator('#markdownToolbar').evaluate((element) => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    }));

    expect(initialMetrics.clientHeight).toBeGreaterThan(0);
    expect(initialMetrics.scrollWidth).toBeGreaterThanOrEqual(initialMetrics.clientWidth);

    await page.locator('#markdownToolbar').evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });

    const scrolledMetrics = await page.locator('#markdownToolbar').evaluate((element) => {
      const toolbarRect = element.getBoundingClientRect();
      const lastButton = element.querySelector('[data-markdown-action="horizontal-rule"]');
      const lastRect = lastButton?.getBoundingClientRect();
      return {
        overflow: element.scrollWidth - element.clientWidth,
        scrollLeft: element.scrollLeft,
        lastRightOverflow: lastRect ? Math.max(0, Math.ceil(lastRect.right - toolbarRect.right)) : null,
      };
    });

    if (scrolledMetrics.overflow > 1) {
      expect(scrolledMetrics.scrollLeft).toBeGreaterThan(0);
    }
    expect(scrolledMetrics.lastRightOverflow).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-markdown-action="horizontal-rule"]')).toBeVisible();
  });

  test('shows the heading menu as a visible popover on mobile', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await page.locator('[data-markdown-block-menu-toggle]').click();

    const popover = page.locator('#editorContainer .markdown-toolbar-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('[data-markdown-block-menu]')).toContainText('Heading 1');
    await expect(popover.locator('[data-markdown-block-menu]')).toContainText('Heading 2');
  });
});

test.describe('mobile comments and header chrome', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('keeps preview width stable when comments open on mobile', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await expect(page.locator('#commentsToggle')).toBeVisible();

    const beforeWidth = await page.locator('#previewContainer').evaluate((element) => element.getBoundingClientRect().width);
    await page.locator('#commentsToggle').click();
    await expect(page.locator('#commentsDrawer')).toBeVisible();
    const afterWidth = await page.locator('#previewContainer').evaluate((element) => element.getBoundingClientRect().width);

    expect(Math.abs(afterWidth - beforeWidth)).toBeLessThanOrEqual(1);
  });

  test('moves secondary toolbar actions into a mobile overflow menu', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });

    await expect(page.locator('#sidebarToggle')).toBeVisible();
    await expect(page.locator('#mobileViewToggle')).toBeVisible();
    await expect(page.locator('#toolbarOverflowToggle')).toBeVisible();
    await expect(page.locator('#editNameBtn')).toBeHidden();
    await expect(page.locator('#shareBtn')).toBeHidden();

    await page.locator('#toolbarOverflowToggle').click();

    await expect(page.locator('#editNameBtn')).toBeVisible();
    await expect(page.locator('#chatToggleBtn')).toBeVisible();
    await expect(page.locator('#shareBtn')).toBeVisible();
    await expect(page.locator('#themeToggleBtn')).toBeVisible();
  });
});
