import {
  ensureMobileSidebarVisible,
  expect,
  getPreviewHorizontalOverflowMetrics,
  openFile,
  openHome,
  replaceEditorContent,
  setEditorSelection,
  test,
  waitForEditor,
  waitForPreview,
  writeVaultFileAndResetCollab,
  restoreReadmeTestDocument,
  restoreVaultFileFromTemplate,
} from './helpers/app-fixture.js';

const OUTLINE_TEST_DOCUMENT = `# My Vault

Welcome to the test vault.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]
`;

const MOBILE_FRONTMATTER_DOCUMENT = `---
title: Preview toggle
tags:
  - one
  - two
---

# Heading

Body copy
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

async function readEditorText(page) {
  return page.evaluate(() => {
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

    return view.state.doc.toString();
  });
}

async function getLineIndent(page, targetText) {
  return page.evaluate((target) => {
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
    const targetLine = source.split('\n').find((line) => line.trimStart() === target);
    return targetLine ? targetLine.length - targetLine.trimStart().length : -1;
  }, targetText);
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
    await expect(page.locator('#outlineClose')).toBeVisible();
    await expect(page.locator('#outlineNav')).toContainText('My Vault');
    await expect(page.locator('#outlineNav')).toContainText('Links');

    await page.locator('#outlineNav .outline-item', { hasText: 'Links' }).click();

    await expect(page.locator('#outlinePanel')).toBeHidden();
  });

  test('closes the outline from its mobile close affordance', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });

    await page.locator('#outlineToggle').click();
    await expect(page.locator('#outlinePanel')).toBeVisible();

    await page.locator('#outlineClose').click();

    await expect(page.locator('#outlinePanel')).toBeHidden();
    await expect(page.locator('#outlineToggle')).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('mobile editor typography', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('uses a more compact editor font size on mobile', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await expect.poll(async () => (
      page.locator('.editor-container .cm-editor').evaluate((element) => getComputedStyle(element).fontSize)
    )).toBe('16px');
  });
});

test.describe('mobile frontmatter', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('keeps the frontmatter toggle on the same row as Properties', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);
    await replaceEditorContent(page, MOBILE_FRONTMATTER_DOCUMENT);
    await page.locator('#mobileViewToggle').click();
    await waitForPreview(page);

    const headerMetrics = await page.locator('#previewContent .frontmatter-header').evaluate((element) => {
      const label = element.querySelector('.frontmatter-label');
      const toggle = element.querySelector('.frontmatter-toggle');
      if (!(label instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
        throw new Error('Missing frontmatter label or toggle');
      }

      const style = getComputedStyle(element);
      const labelRect = label.getBoundingClientRect();
      const toggleRect = toggle.getBoundingClientRect();

      return {
        alignItems: style.alignItems,
        flexDirection: style.flexDirection,
        flexWrap: style.flexWrap,
        labelBottom: Math.round(labelRect.bottom),
        labelTop: Math.round(labelRect.top),
        toggleBottom: Math.round(toggleRect.bottom),
        toggleTop: Math.round(toggleRect.top),
        toggleLeft: Math.round(toggleRect.left),
        labelRight: Math.round(labelRect.right),
      };
    });

    expect(headerMetrics.flexDirection).toBe('row');
    expect(headerMetrics.alignItems).toBe('center');
    expect(headerMetrics.flexWrap).toBe('nowrap');
    expect(headerMetrics.toggleTop).toBeLessThan(headerMetrics.labelBottom);
    expect(headerMetrics.toggleBottom).toBeGreaterThan(headerMetrics.labelTop);
    expect(headerMetrics.toggleLeft).toBeGreaterThan(headerMetrics.labelRight);
  });
});

test.describe('mobile bases preview', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('renders base edit actions without the desktop wrapper chrome on mobile', async ({ page }) => {
    await writeVaultFileAndResetCollab(page, {
      path: 'notes/mobile-base-item.md',
      content: '# Mobile Base Item\n\n#mobiletest\n',
    });
    await writeVaultFileAndResetCollab(page, {
      path: 'views/mobile-toolbar.base',
      content: [
        'filters: file.ext == "md" && file.hasTag("mobiletest")',
        'views:',
        '  - type: table',
        '    name: All',
        '    order: [file.name]',
      ].join('\n'),
    });

    await openFile(page, 'views/mobile-toolbar.base', { waitFor: 'preview' });

    const toolbarActions = page.locator('.bases-toolbar-edit-actions');
    await expect(toolbarActions).toBeVisible();
    await expect(toolbarActions).toContainText('Sort');
    await expect(toolbarActions).toContainText('Filter');
    await expect(toolbarActions).toContainText('Properties');

    const metrics = await toolbarActions.evaluate((element) => {
      const style = getComputedStyle(element);
      const buttons = [...element.querySelectorAll('.ui-button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
        };
      });

      return {
        backgroundColor: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        buttons,
        display: style.display,
      };
    });

    expect(metrics.display).toBe('grid');
    expect(metrics.borderTopWidth).toBe('0px');
    expect(metrics.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(metrics.boxShadow).toBe('none');
    expect(metrics.buttons).toHaveLength(3);
    expect(metrics.buttons[0].top).toBe(metrics.buttons[1].top);
    expect(metrics.buttons[2].top).toBeGreaterThan(metrics.buttons[0].top);
    expect(Math.abs(metrics.buttons[2].left - metrics.buttons[0].left)).toBeLessThanOrEqual(2);
    expect(metrics.buttons[2].width).toBeGreaterThan(metrics.buttons[0].width);
  });

  test('clips the base shell corners cleanly on mobile', async ({ page }) => {
    await writeVaultFileAndResetCollab(page, {
      path: 'notes/mobile-base-item.md',
      content: '# Mobile Base Item\n\n#mobiletest\n',
    });
    await writeVaultFileAndResetCollab(page, {
      path: 'views/mobile-toolbar.base',
      content: [
        'filters: file.ext == "md" && file.hasTag("mobiletest")',
        'views:',
        '  - type: table',
        '    name: All',
        '    order: [file.name]',
      ].join('\n'),
    });

    await openFile(page, 'views/mobile-toolbar.base', { waitFor: 'preview' });

    await expect.poll(async () => {
      const shellMetrics = await page.locator('.bases-shell').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          isConnected: element.isConnected,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        };
      });
      const toolbarMetrics = await page.locator('.bases-toolbar').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          isConnected: element.isConnected,
        };
      });

      return {
        shellHasRadius: shellMetrics.borderTopLeftRadius !== '0px' && shellMetrics.borderTopRightRadius !== '0px',
        shellIsConnected: shellMetrics.isConnected,
        shellOverflowX: shellMetrics.overflowX,
        shellOverflowY: shellMetrics.overflowY,
        toolbarHasRadius: toolbarMetrics.borderTopLeftRadius !== '0px' && toolbarMetrics.borderTopRightRadius !== '0px',
        toolbarIsConnected: toolbarMetrics.isConnected,
      };
    }).toEqual({
      shellHasRadius: true,
      shellIsConnected: true,
      shellOverflowX: 'hidden',
      shellOverflowY: 'hidden',
      toolbarHasRadius: true,
      toolbarIsConnected: true,
    });
  });
});

test.describe('mobile editor commands', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('surfaces undo and redo as mobile toolbar actions', async ({ page }) => {
    await restoreReadmeTestDocument(page);
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await expect(page.locator('[data-editor-command="undo"]').first()).toBeVisible();
    await expect(page.locator('[data-editor-command="redo"]').first()).toBeVisible();

    await replaceEditorContent(page, '# Mobile Undo\n\nChanged from mobile.\n');
    await expect.poll(async () => readEditorText(page)).toContain('Changed from mobile.');

    await page.locator('[data-editor-command="undo"]').first().click();
    await expect.poll(async () => readEditorText(page)).toContain('# My Vault');

    await page.locator('[data-editor-command="redo"]').first().click();
    await expect.poll(async () => readEditorText(page)).toContain('# Mobile Undo');
  });

  test('indents and outdents the current line from mobile toolbar actions', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await replaceEditorContent(page, '- parent\n- child\n');
    await setEditorSelection(page, '- child', { collapse: true });

    await page.locator('[data-editor-command="indentMore"]').first().click();
    await expect.poll(async () => getLineIndent(page, '- child')).toBeGreaterThan(0);
    await expect.poll(async () => getLineIndent(page, '- parent')).toBe(0);

    await page.locator('[data-editor-command="indentLess"]').first().click();
    await expect.poll(async () => getLineIndent(page, '- child')).toBe(0);
  });

  test('indents and outdents a selected list range from mobile toolbar actions', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await replaceEditorContent(page, '- alpha\n- beta\n');
    await setEditorSelection(page, '- alpha\n- beta');

    await page.locator('[data-editor-command="indentMore"]').first().click();
    await expect.poll(async () => getLineIndent(page, '- alpha')).toBeGreaterThan(0);
    await expect.poll(async () => getLineIndent(page, '- beta')).toBeGreaterThan(0);

    await page.locator('[data-editor-command="indentLess"]').first().click();
    await expect.poll(async () => getLineIndent(page, '- alpha')).toBe(0);
    await expect.poll(async () => getLineIndent(page, '- beta')).toBe(0);
  });

  test('opens find in file from the mobile editor header', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await expect(page.locator('#editorFindBtn')).toBeVisible();
    await page.locator('#editorFindBtn').click();

    await expect(page.locator('.cm-search')).toBeVisible();
    await expect(page.locator('.cm-search .cm-textfield').first()).toBeVisible();
    await expect.poll(async () => (
      page.evaluate(() => document.activeElement?.classList?.contains('cm-textfield') ?? false)
    )).toBe(true);
  });

  test('keeps the markdown toolbar pinned while the mobile editor scrolls', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });
    await page.locator('#mobileViewToggle').click();
    await waitForEditor(page);

    await replaceEditorContent(page, Array.from(
      { length: 80 },
      (_, index) => `Line ${index + 1}: ${'mobile toolbar sticky '.repeat(6)}`,
    ).join('\n\n'));

    const initialTop = await page.locator('#markdownToolbar').evaluate((element) => element.getBoundingClientRect().top);

    await page.locator('.editor-container .cm-scroller').evaluate((element) => {
      element.scrollTop = 1200;
    });

    await expect.poll(async () => (
      page.locator('#markdownToolbar').evaluate((element) => Math.round(element.getBoundingClientRect().top))
    )).toBe(Math.round(initialTop));
  });
});

test.describe('mobile presence', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('shows collaborator avatars in the mobile header', async ({ browser }) => {
    const viewport = { width: 390, height: 844 };
    const ownerContext = await browser.newContext({ viewport });
    const teammateContext = await browser.newContext({ viewport });

    const ownerPage = await ownerContext.newPage();
    const teammatePage = await teammateContext.newPage();

    await openFile(ownerPage, 'README.md', { userName: 'Owner', waitFor: 'preview' });
    await openFile(teammatePage, 'projects/collabmd.md', { userName: 'Teammate', waitFor: 'preview' });

    await expect(ownerPage.locator('#userCount')).toHaveText('2 online');
    await expect(ownerPage.locator('#userAvatars')).toBeVisible();
    await expect(ownerPage.locator('#userAvatars .user-avatar').first()).toBeVisible();
    await expect(ownerPage.locator('#userAvatars .user-avatar-button').first()).toBeVisible();
    await expect(ownerPage.locator('#userAvatars .user-avatar-button').first()).toHaveAttribute('aria-label', /Follow Teammate/);

    await ownerPage.locator('#userCount').click();
    await expect(ownerPage.locator('#presencePanel')).toBeVisible();
    await expect(ownerPage.locator('#presencePanel .presence-panel-user')).toHaveCount(2);
    await expect.poll(async () => (
      ownerPage.locator('#presencePanelList').evaluate((element) => getComputedStyle(element).overflowY)
    )).toBe('auto');
    await ownerPage.locator('#presencePanel .presence-panel-user-button').filter({ hasText: 'Teammate' }).click();
    await expect(ownerPage.locator('#presencePanel')).toBeHidden();
    await expect(ownerPage.locator('#activeFileName')).toHaveText('collabmd');
    await expect(ownerPage.locator('#previewContent')).toContainText('CollabMD Project');

    await ownerContext.close();
    await teammateContext.close();
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

    await restoreVaultFileFromTemplate(page, 'projects/collabmd.md');
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

test.describe('narrow mobile PlantUML preview', () => {
  test.use({
    viewport: { width: 320, height: 844 },
  });

  test('keeps all toolbar actions reachable through horizontal scrolling on narrow screens', async ({ page }) => {
    await page.route('**/api/plantuml/render', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 1400"><text x="40" y="120">narrow-mobile-plantuml</text></svg>',
        }),
        contentType: 'application/json',
        status: 200,
      });
    });

    await openFile(page, 'sample-plantuml.puml', { waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
    await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();

    const toolbar = page.locator('#previewContent .plantuml-toolbar');
    const initialMetrics = await toolbar.evaluate((element) => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    }));

    expect(initialMetrics.clientHeight).toBeGreaterThan(0);
    expect(initialMetrics.scrollWidth).toBeGreaterThanOrEqual(initialMetrics.clientWidth);

    await toolbar.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });

    const scrolledMetrics = await toolbar.evaluate((element) => {
      const toolbarRect = element.getBoundingClientRect();
      const lastButton = element.querySelector('.plantuml-tool-btn[aria-label="Maximize diagram"]');
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
    await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Maximize diagram"]')).toBeVisible();
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

  test('dims the workspace and closes the sidebar when tapping the backdrop', async ({ page }) => {
    await openHome(page);

    const sidebar = await ensureMobileSidebarVisible(page);
    const backdrop = page.locator('#sidebarBackdrop');
    await expect(backdrop).toBeVisible();
    await expect(backdrop).toHaveAttribute('aria-hidden', 'false');

    await backdrop.click({ position: { x: 380, y: 420 } });

    await expect(sidebar).toBeHidden();
    await expect(backdrop).toBeHidden();
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
    await expect(page.locator('.file-action-sheet')).toContainText('Download');

    await page.locator('.file-action-sheet-item', { hasText: 'Cancel' }).click();
    await expect(page.locator('.file-action-sheet')).toBeHidden();

    await longPress(page.locator('#fileTree'));
    await expect(page.locator('.file-action-sheet')).toBeVisible();
    await expect(page.locator('.file-action-sheet')).toContainText('New markdown file');
  });

  test('opens the create picker as a mobile action sheet', async ({ page }) => {
    await openHome(page);
    await ensureMobileSidebarVisible(page);

    await page.locator('#sidebarCreateBtn').click();
    await expect(page.locator('.create-action-sheet')).toBeVisible();
    await expect(page.locator('.create-action-sheet')).toContainText('draw.io diagram');

    await page.getByRole('button', { name: /Markdown note/i }).click();
    await expect(page.locator('#fileActionDialog')).toBeVisible();
    await expect(page.locator('#fileActionTitle')).toHaveText('Create markdown file');
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

    const popover = page.locator('#markdownBlockMenuPopover');
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
    await expect(page.locator('#chatToggleBtn')).toBeVisible();
    await expect(page.locator('#toolbarOverflowToggle')).toBeVisible();
    await expect(page.locator('#editNameBtn')).toBeHidden();
    await expect(page.locator('#shareBtn')).toBeHidden();

    await page.locator('#toolbarOverflowToggle').click();

    await expect(page.locator('#searchFilesBtn')).toBeVisible();
    await expect(page.locator('#editNameBtn')).toBeVisible();
    await expect(page.locator('#shareBtn')).toBeVisible();
    await expect(page.locator('#exportMenuGroup')).toBeVisible();
    const themeButton = page.locator('#themeToggleBtn');
    await expect(themeButton).toBeVisible();
    await expect(themeButton).toContainText('Theme');
    await expect(themeButton.locator('[data-theme-toggle-state]')).toContainText(/Dark|Light/);

    const currentTheme = await page.locator('html').getAttribute('data-theme');
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    await themeButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', nextTheme);
  });

  test('opens quick switcher from the mobile overflow search files action', async ({ page }) => {
    await openFile(page, 'README.md', { waitFor: 'preview' });

    await page.locator('#toolbarOverflowToggle').click();
    await expect(page.locator('#searchFilesBtn')).toBeVisible();

    await page.locator('#searchFilesBtn').click();

    await expect(page.locator('#quickSwitcher')).toBeVisible();
    await expect(page.locator('#quickSwitcherInput')).toBeVisible();
  });
});
