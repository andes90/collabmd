import {
  createScrollSyncRegressionDocument,
  expect,
  getHeavyPreviewCounts,
  getPreviewHeadingOffset,
  getVisibleEditorLineNumbers,
  openFile,
  openSampleFull,
  replaceEditorContent,
  test,
  waitForHeavyPreviewContent,
} from './helpers/app-fixture.js';

const OUTLINE_TEST_DOCUMENT = `# My Vault

Welcome to the test vault.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]
`;

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

test('keeps the preview pinned to the top when a file first opens at the top of the editor', async ({ page }) => {
  await openFile(page, 'showcase.md');
  await expect(page.locator('#previewContent h1', { hasText: 'CollabMD Workspace Tour' })).toBeVisible();

  await expect.poll(async () => (
    page.locator('#previewContainer').evaluate((element) => Math.round(element.scrollTop))
  ), { timeout: 15000 }).toBe(0);

  const previewHeadingOffset = await page.locator('#previewContent h1', { hasText: 'CollabMD Workspace Tour' }).evaluate((heading) => {
    const container = document.getElementById('previewContainer');
    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return Math.abs(headingRect.top - containerRect.top);
  });

  expect(previewHeadingOffset).toBeLessThan(80);
});

test('keeps the clicked parent heading active in the outline after navigation', async ({ page }) => {
  await openFile(page, 'showcase.md');
  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  await page.locator('#outlineNav .outline-item', { hasText: 'Embedded Diagram Files' }).click();

  await expect.poll(async () => {
    const activeItem = page.locator('#outlineNav .outline-item.active').first();
    return activeItem.textContent();
  }, { timeout: 15000 }).toBe('Embedded Diagram Files');
});

test('keeps the outline open on desktop after selecting a section', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, OUTLINE_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('My Vault');

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
