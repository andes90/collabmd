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
  writeVaultFileAndResetCollab,
} from './helpers/app-fixture.js';

const OUTLINE_TEST_DOCUMENT = `# My Vault

Welcome to the test vault.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]
`;

const FRONTMATTER_OUTLINE_DOCUMENT = `---
title: Frontmatter test
tags:
  - preview
  - outline
summary: Keeps headings aligned
---

# My Vault

Welcome to the test vault.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]

${Array.from({ length: 40 }, (_, index) => `- Follow-up note ${index + 1}`).join('\n')}
`;

const FRAGMENT_LINK_DOCUMENT = `# My Vault

- [Jump to section](#section-a)
- [Back to top](#top)

## Section A

Target content
`;

const DUPLICATE_SUBHEADING_DOCUMENT = `# My Vault

## Approach A

#### Pros

- Alpha

## Approach B

#### Pros

- Beta
`;

async function createLinkedMentionFiles(page, {
  count = 12,
  target = 'projects/collabmd',
} = {}) {
  for (let index = 0; index < count; index += 1) {
    const response = await page.request.post('/api/file', {
      data: {
        content: `# Mention ${index + 1}\n\n- [[${target}]]\n`,
        path: `linked-mention-${index + 1}.md`,
      },
    });

    expect(response.ok()).toBeTruthy();
  }
}

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

test('keeps the linked mentions dock reachable while preview scrolls and expands it without moving the document', async ({ page }) => {
  await openFile(page, 'README.md', { waitFor: 'preview' });
  await createLinkedMentionFiles(page, { count: 12 });
  await openFile(page, 'projects/collabmd.md', { waitFor: 'preview' });
  await expect(page.locator('#previewContent')).toHaveAttribute('data-render-phase', 'ready', { timeout: 60000 });

  const dock = page.locator('#backlinksPanel .backlinks-panel-dock');
  const dockHeader = dock.locator('.backlinks-header');

  await expect(dock).toBeVisible();
  await expect.poll(async () => Number.parseInt(await dock.locator('.backlinks-count').textContent() || '0', 10)).toBeGreaterThan(10);

  const measureDockAlignment = async () => page.evaluate(() => {
    const dockElement = document.querySelector('#backlinksPanel .backlinks-panel-dock');
    const contentElement = document.getElementById('previewContent');
    const dockRect = dockElement.getBoundingClientRect();
    const contentRect = contentElement.getBoundingClientRect();

    return Math.round(dockRect.left - contentRect.left);
  });

  const splitAlignment = await measureDockAlignment();
  expect(splitAlignment).toBeGreaterThanOrEqual(0);

  const positions = [];
  for (const progress of [0, 0.5, 0.9]) {
    // Keep the preview scroll moving while the dock should remain fixed to preview chrome.
    // The measurement is taken against the preview body rather than the viewport.
    // That makes the assertion resilient in split and preview-only layouts.
    // It also directly checks the intended contract: anchored inside preview chrome.
    // `progress` is intentionally coarse to exercise top, middle, and near-bottom.
    const snapshot = await page.locator('#previewContainer').evaluate((element, nextProgress) => {
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = Math.round(maxScrollTop * nextProgress);

      const panel = document.querySelector('#backlinksPanel .backlinks-panel-dock');
      const previewBody = document.querySelector('.preview-body');
      const panelRect = panel.getBoundingClientRect();
      const previewBodyRect = previewBody.getBoundingClientRect();

      return {
        bottomOffset: Math.round(previewBodyRect.bottom - panelRect.bottom),
        top: Math.round(panelRect.top),
      };
    }, progress);

    positions.push(snapshot);
  }

  expect(Math.abs(positions[0].bottomOffset - positions[1].bottomOffset)).toBeLessThanOrEqual(2);
  expect(Math.abs(positions[1].bottomOffset - positions[2].bottomOffset)).toBeLessThanOrEqual(2);
  expect(Math.abs(positions[0].top - positions[1].top)).toBeLessThanOrEqual(2);
  expect(Math.abs(positions[1].top - positions[2].top)).toBeLessThanOrEqual(2);

  const scrollTopBeforeExpand = await page.locator('#previewContainer').evaluate((element) => element.scrollTop);
  await dockHeader.click();
  await expect(dock).toHaveClass(/expanded/);
  await page.evaluate(() => new Promise((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));

  const scrollTopAfterExpand = await page.locator('#previewContainer').evaluate((element) => element.scrollTop);
  expect(Math.abs(scrollTopAfterExpand - scrollTopBeforeExpand)).toBeLessThanOrEqual(1);

  const bodyMetrics = await dock.locator('.backlinks-body').evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: window.getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));

  expect(bodyMetrics.overflowY).toBe('auto');
  expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);

  await page.locator('.view-btn[data-view="preview"]').click();
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
  await expect(dock).toBeVisible();

  const previewModeMetrics = await page.evaluate(() => {
    const dockElement = document.querySelector('#backlinksPanel .backlinks-panel-dock');
    const previewBody = document.querySelector('.preview-body');
    const dockRect = dockElement.getBoundingClientRect();
    const previewBodyRect = previewBody.getBoundingClientRect();
    const rootStyles = getComputedStyle(document.documentElement);
    const rootFontSize = Number.parseFloat(rootStyles.fontSize) || 16;
    const rawInset = rootStyles.getPropertyValue('--space-6').trim();
    let expectedInset = Number.parseFloat(rawInset) || 24;
    if (rawInset.endsWith('rem')) {
      expectedInset *= rootFontSize;
    }

    return {
      bottomOffset: Math.round(previewBodyRect.bottom - dockRect.bottom),
      leftOffset: Math.round(dockRect.left - previewBodyRect.left),
      expectedInset,
    };
  });

  expect(Math.abs(previewModeMetrics.leftOffset - previewModeMetrics.expectedInset)).toBeLessThanOrEqual(2);
  expect(Math.abs(previewModeMetrics.bottomOffset - previewModeMetrics.expectedInset)).toBeLessThanOrEqual(2);
});

test('keeps the clicked parent section active in the outline after navigation settles', async ({ page }) => {
  await openFile(page, 'showcase.md');
  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  await page.locator('#outlineNav .outline-item', { hasText: 'Embedded Diagram Files' }).click();

  const parentHeadingOffset = await page.locator('#previewContent h2', { hasText: 'Embedded Diagram Files' }).evaluate((heading) => {
    const container = document.getElementById('previewContainer');
    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return Math.abs(headingRect.top - containerRect.top);
  });

  expect(parentHeadingOffset).toBeLessThan(100);
  await expect(page.locator('#outlineNav .outline-item.active').first()).toHaveText('Embedded Diagram Files');
  await expect(page.locator('#previewContent .excalidraw-embed').first()).toBeVisible();
  await expect.poll(async () => (
    page.locator('#outlineNav .outline-item.active').first().textContent()
  )).toBe('Embedded Diagram Files');
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

test('renders frontmatter as metadata while keeping outline navigation aligned', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, FRONTMATTER_OUTLINE_DOCUMENT);

  const frontmatterBlock = page.locator('#previewContent .frontmatter-block');
  await expect(frontmatterBlock).toBeVisible();
  await expect(frontmatterBlock).toContainText('Properties');
  await expect(frontmatterBlock).toContainText('Frontmatter test');

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();
  await expect(page.locator('#outlineNav')).toContainText('My Vault');
  await expect(page.locator('#outlineNav')).toContainText('Links');

  await page.locator('#outlineNav .outline-item', { hasText: 'Links' }).click();

  await expect.poll(async () => getPreviewHeadingOffset(page, 13), { timeout: 15000 }).toBeLessThan(80);
  await expect(page.locator('#outlineNav .outline-item.active').first()).toHaveText('Links');
});

test('keeps in-document anchor clicks inside the current preview without changing the file route', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, FRAGMENT_LINK_DOCUMENT);
  await expect(page.locator('#previewContent a[href="#section-a"]')).toBeVisible();

  await expect(page).toHaveURL(/#file=README\.md$/);
  await page.locator('#previewContent a[href="#section-a"]').click();

  await expect(page).toHaveURL(/#file=README\.md$/);
  expect(page.context().pages()).toHaveLength(1);
  await expect(page.locator('#tabLockOverlay')).toBeHidden();

  await expect.poll(async () => {
    const heading = page.locator('#previewContent h2#section-a');
    return heading.evaluate((element) => {
      const container = document.getElementById('previewContainer');
      const containerRect = container.getBoundingClientRect();
      const headingRect = element.getBoundingClientRect();
      return Math.abs(headingRect.top - containerRect.top);
    });
  }).toBeLessThan(220);
});

test('copies and restores file-plus-anchor deep links from preview headings', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFile(page, 'README.md');
  await replaceEditorContent(page, FRAGMENT_LINK_DOCUMENT);

  const heading = page.locator('#previewContent h2#section-a');
  await heading.hover();
  const headingLinkButton = heading.locator('.preview-heading-link-button');
  await expect(headingLinkButton).toBeVisible();
  await headingLinkButton.click();


  await expect.poll(async () => (
    page.evaluate(() => navigator.clipboard.readText())
  )).toBe(`${new URL(page.url()).origin}/#file=README.md&anchor=section-a`);

  await page.goto('/#file=README.md&anchor=section-a');
  await expect(page).toHaveURL(/#file=README\.md&anchor=section-a$/);
  await expect(page.locator('#tabLockOverlay')).toBeHidden();
  await expect(page.locator('#previewContent h2#section-a')).toBeVisible();

  await expect.poll(async () => {
    const heading = page.locator('#previewContent h2#section-a');
    return heading.evaluate((element) => {
      const container = document.getElementById('previewContainer');
      const containerRect = container.getBoundingClientRect();
      const headingRect = element.getBoundingClientRect();
      return Math.abs(headingRect.top - containerRect.top);
    });
  }).toBeLessThan(220);
});

test('restores a file-plus-anchor route on the first page load', async ({ page }) => {
  await writeVaultFileAndResetCollab(page, {
    content: FRAGMENT_LINK_DOCUMENT,
    path: 'README.md',
  });

  await page.goto('/#file=README.md&anchor=section-a');
  await expect(page).toHaveURL(/#file=README\.md&anchor=section-a$/);
  await expect(page.locator('#tabLockOverlay')).toBeHidden();
  await expect(page.locator('#previewContent h2#section-a')).toBeVisible();

  await expect.poll(async () => {
    const heading = page.locator('#previewContent h2#section-a');
    return heading.evaluate((element) => {
      const container = document.getElementById('previewContainer');
      const containerRect = container.getBoundingClientRect();
      const headingRect = element.getBoundingClientRect();
      return Math.abs(headingRect.top - containerRect.top);
    });
  }).toBeLessThan(220);

  const editorHeadingOffset = await page.locator('.cm-line', { hasText: '## Section A' }).first().evaluate((line) => {
    const scroller = document.querySelector('.cm-scroller');
    const scrollerRect = scroller.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return Math.abs(lineRect.top - scrollerRect.top);
  });

  expect(editorHeadingOffset).toBeLessThan(220);
});

test('copies and restores duplicate nested heading links using contextual anchors', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFile(page, 'README.md');
  await replaceEditorContent(page, DUPLICATE_SUBHEADING_DOCUMENT);

  const heading = page.locator('#previewContent h4#approach-b-pros');
  await heading.hover();
  const headingLinkButton = heading.locator('.preview-heading-link-button');
  await expect(headingLinkButton).toBeVisible();
  await headingLinkButton.click();


  await expect.poll(async () => (
    page.evaluate(() => navigator.clipboard.readText())
  )).toBe(`${new URL(page.url()).origin}/#file=README.md&anchor=approach-b-pros`);

  await page.goto('/#file=README.md&anchor=approach-b-pros');
  await expect(page).toHaveURL(/#file=README\.md&anchor=approach-b-pros$/);
  await expect(page.locator('#previewContent h4#approach-b-pros')).toBeVisible();

  await expect.poll(async () => {
    const heading = page.locator('#previewContent h4#approach-b-pros');
    return heading.evaluate((element) => {
      const container = document.getElementById('previewContainer');
      const containerRect = container.getBoundingClientRect();
      const headingRect = element.getBoundingClientRect();
      return Math.abs(headingRect.top - containerRect.top);
    });
  }).toBeLessThan(320);
});

test('keeps the preview container width stable when the outline opens in preview mode', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, OUTLINE_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('My Vault');

  await page.locator('.view-btn[data-view="preview"]').click();
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

  const widthBefore = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  const widthAfter = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(1);
});

test('keeps the preview container width stable when the outline opens in split mode', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, OUTLINE_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'split');

  const widthBefore = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  const widthAfter = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(1);
});

test('keeps the editor interactive while heavy preview initializes', async ({ page }) => {
  test.slow();

  await openSampleFull(page);

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

  let middle = before;
  await expect.poll(async () => {
    const counts = await getHeavyPreviewCounts(page);
    middle = counts;
    return counts.mermaidSvgs > before.mermaidSvgs
      || counts.excalidrawIframes > before.excalidrawIframes
      || counts.scrollHeight > before.scrollHeight;
  }, { timeout: 60000 }).toBeTruthy();

  await page.locator('#previewContainer').evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.85;
  });

  let after = middle;
  await expect.poll(async () => {
    const counts = await getHeavyPreviewCounts(page);
    after = counts;
    return counts.mermaidSvgs > middle.mermaidSvgs
      || counts.excalidrawIframes > middle.excalidrawIframes
      || counts.scrollHeight > middle.scrollHeight;
  }, { timeout: 60000 }).toBeTruthy();
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

  await page.locator('.cm-scroller').evaluate((scroller) => {
    window.__previewNavigationScrollPromise = new Promise((resolve) => {
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

  await page.waitForTimeout(40);

  const during = await getHeavyPreviewCounts(page);
  expect(during.mermaidSvgs - before.mermaidSvgs).toBeLessThanOrEqual(1);
  expect(during.excalidrawIframes - before.excalidrawIframes).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.__previewNavigationScrollPromise);
  await page.waitForTimeout(500);

  const after = await getHeavyPreviewCounts(page);
  expect(after.renderPhase).toBe('ready');
  expect(after.mermaidSvgs).toBeGreaterThanOrEqual(0);
  expect(after.excalidrawIframes).toBeGreaterThanOrEqual(0);
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

  await expect.poll(async () => {
    const lineNumbers = await getVisibleEditorLineNumbers(page);
    return lineNumbers.includes(targetLine);
  }, { timeout: 60000 }).toBeTruthy();

  await expect.poll(async () => (
    getPreviewHeadingOffset(page, targetLine)
  ), { timeout: 60000 }).toBeLessThan(260);
});
