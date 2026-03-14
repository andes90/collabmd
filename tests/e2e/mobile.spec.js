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
});
