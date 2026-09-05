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
  waitForPreview,
  waitForHeavyPreviewContent,
  appendEditorContent,
  restoreReadmeTestDocument,
  restoreVaultFileFromTemplate,
  stubPlantUmlRender,
} from './helpers/app-fixture.js';

function createPdfFixture({ pageCount = 1, text = 'EmbedPDF preview', outline = [] } = {}) {
  const contentStream = `BT /F1 18 Tf 48 180 Td (${text}) Tj ET`;
  const pageReferences = Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`);
  const pageRefs = pageReferences.join(' ');
  const contentStart = pageCount + 3;
  const fontReference = contentStart + pageCount;
  const outlineRootReference = outline.length > 0 ? (2 * pageCount) + 4 : null;
  const outlineItemReferences = outline.map((_, index) => outlineRootReference + index + 1);
  const catalog = outlineRootReference
    ? `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRootReference} 0 R /PageMode /UseOutlines >>`
    : '<< /Type /Catalog /Pages 2 0 R >>';
  const objects = [
    catalog,
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) => (
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Contents ${contentStart + index} 0 R /Resources << /Font << /F1 ${fontReference} 0 R >> >> >>`
    )),
    ...Array.from({ length: pageCount }, () => (
      `<< /Length ${Buffer.byteLength(contentStream, 'binary')} >>\nstream\n${contentStream}\nendstream`
    )),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  if (outlineRootReference) {
    objects.push(
      `<< /Type /Outlines /First ${outlineItemReferences[0]} 0 R /Last ${outlineItemReferences.at(-1)} 0 R /Count ${outline.length} >>`,
      ...outline.map((entry, index) => {
        const previous = index > 0 ? ` /Prev ${outlineItemReferences[index - 1]} 0 R` : '';
        const next = index < outlineItemReferences.length - 1 ? ` /Next ${outlineItemReferences[index + 1]} 0 R` : '';
        const pageReference = pageReferences[Math.max(0, Math.min(pageCount - 1, entry.page - 1))];
        return `<< /Title (${entry.title}) /Parent ${outlineRootReference} 0 R /Dest [${pageReference} /Fit]${previous}${next} >>`;
      }),
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
  ].join('\n');

  return Buffer.from(pdf, 'binary');
}

async function applyBlockToolbarAction(page, action) {
  await page.locator('[data-markdown-block-menu-toggle]').click();
  await page.locator(`[data-markdown-block-action="${action}"]`).click();
}

async function chooseCreateAction(page, actionName, { from = 'sidebar' } = {}) {
  const trigger = from === 'empty-state'
    ? page.locator('#emptyStateNewFileBtn')
    : page.locator('#sidebarCreateBtn');

  await trigger.click();
  await expect(page.locator('.create-menu, .create-action-sheet').first()).toBeVisible();
  await page.locator('.create-menu-item, .create-action-sheet-item').filter({ hasText: actionName }).first().click();
}

async function dragFileTreeFileToDirectory(page, { sourceFilePath, targetDirectoryPath }) {
  await page.evaluate(({ sourcePath, targetPath }) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(sourcePath)}"]`);
    const target = document.querySelector(`#fileTree .file-tree-dir[data-path="${CSS.escape(targetPath)}"]`);

    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error(`Missing drag source or target for ${sourcePath} -> ${targetPath}`);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', source.dataset.path || sourcePath);

    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  }, {
    sourcePath: sourceFilePath,
    targetPath: targetDirectoryPath,
  });
}

async function dragFileTreeFileToRoot(page, { sourceFilePath }) {
  await page.evaluate(({ sourcePath }) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(sourcePath)}"]`);
    const target = document.querySelector('#fileTree .file-tree-root-drop-zone');

    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error(`Missing drag source or root target for ${sourcePath}`);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', source.dataset.path || sourcePath);

    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  }, {
    sourcePath: sourceFilePath,
  });
}

test('shows empty state when no file is selected', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('.empty-state-title')).toContainText('Welcome to CollabMD');
  await expect(page.locator('#sidebarCreateBtn')).toBeVisible();
  await expect(page.locator('#refreshFilesBtn')).toHaveCount(0);
});

test('missing and invalid file routes do not mount phantom editors', async ({ page }) => {
  await openFile(page, 'README.md');

  for (const route of ['__qa_missing_file__.md', '../README.md', '']) {
    await page.goto(`/#file=${encodeURIComponent(route)}`);
    await expect(page.locator('#editorLoading')).toContainText('File not found');
    await expect(page.locator('.cm-editor')).toHaveCount(0);
  }
});

test('skip to editor preserves the file route and focuses CodeMirror', async ({ page }) => {
  await openFile(page, 'README.md');
  const expectedUrl = page.url();

  await page.locator('#skipToEditor').focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(expectedUrl);
  await expect(page.locator('.cm-content')).toBeFocused();
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
  const guestName = await page.evaluate(() => window.localStorage.getItem('collabmd-user-name'));
  expect(guestName).not.toBeNull();

  await page.reload();
  await expect(page.locator('#displayNameDialog')).not.toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('collabmd-user-name'))).toBe(guestName);

  await page.close();
});

test('sidebar shows vault file tree', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();
  await expect(page.locator('#fileTree')).toContainText('README');
});

test('balances vertical whitespace in the sidebar tabs', async ({ page }) => {
  await openHome(page);

  const spacing = await page.locator('#sidebarTabs').evaluate((container) => {
    const icon = container.querySelector('.ui-nav-tab:not(.hidden) .ui-nav-tab-icon');
    const containerRect = container.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();

    return {
      bottom: containerRect.bottom - iconRect.bottom,
      top: iconRect.top - containerRect.top,
    };
  });

  expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(1);
});

test('renders markdown preview when a file is opened', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#previewContent')).toContainText('My Vault');
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');
});

test('reveals the first find match in a long PlantUML document', async ({ page }) => {
  await page.setViewportSize({ width: 1172, height: 1044 });
  await stubPlantUmlRender(page);
  await openFile(page, 'sample-plantuml.puml');

  const content = [
    '@startuml',
    'needle near the top',
    ...Array.from({ length: 478 }, (_, index) => `note over Foo: Filler line ${index + 1}`),
    '@enduml',
  ].join('\n');
  await replaceEditorContent(page, content);
  await expect(page.locator('#previewContent .plantuml-frame')).toBeVisible();
  await page.locator('.cm-content').press('Meta+Alt+g');
  await page.locator('.cm-dialog input').fill('254');
  await page.locator('.cm-dialog input').press('Enter');

  await page.locator('.cm-content').press('Meta+f');
  const searchInput = page.locator('.cm-search .cm-textfield').first();
  await expect(searchInput).toBeVisible();
  await searchInput.fill('');
  await searchInput.type('needle near the top');

  await expect(page.locator('.cm-searchMatch-selected').first()).toBeVisible();
});

test('frontmatter preview can be collapsed and stays collapsed across rerenders', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, [
    '---',
    'title: Preview toggle',
    'tags:',
    '  - one',
    '  - two',
    '---',
    '',
    '# Heading',
    '',
    'Body copy',
  ].join('\n'));

  const frontmatter = page.locator('#previewContent .frontmatter-block');
  const toggle = frontmatter.locator('.frontmatter-toggle');
  const summary = frontmatter.locator('.frontmatter-summary');
  const content = frontmatter.locator('.frontmatter-content');

  await expect(frontmatter).toBeVisible();
  await expect(content).toBeVisible();

  await toggle.click();

  await expect(frontmatter).toHaveAttribute('data-collapsed', 'true');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('2 properties hidden');
  await expect(content).toBeHidden();

  await appendEditorContent(page, 'Another paragraph');

  await expect(frontmatter).toHaveAttribute('data-collapsed', 'true');
  await expect(content).toBeHidden();

  await toggle.click();

  await expect(frontmatter).toHaveAttribute('data-collapsed', 'false');
  await expect(content).toBeVisible();
});

test('indents nested task list items in markdown preview', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '## Todo\n\n- [ ] First todo\n  - [ ] Nested todo\n');
  await expect(page.locator('#previewContent .task-list-item')).toHaveCount(2);

  const checkboxOffsets = await page.locator('#previewContent').evaluate((root) => (
    Array.from(root.querySelectorAll('.task-list-item input[type="checkbox"]'))
      .slice(0, 2)
      .map((input) => input.getBoundingClientRect().left)
  ));

  expect(checkboxOffsets[1]).toBeGreaterThan(checkboxOffsets[0] + 12);
});

test('clicking a preview task list item toggles the markdown checkbox', async ({ page }) => {
  await openFile(page, 'README.md');
  await waitForCollaborativeEditor(page);

  await replaceEditorContent(page, '## Todo\n\n- [ ] First todo\n');
  const previewCheckbox = page.locator('#previewContent .task-list-item input[type="checkbox"]').first();
  await expect(previewCheckbox).toBeVisible();

  await previewCheckbox.click();

  await expect(page.locator('.cm-content').first()).toContainText('- [x] First todo');
  await expect(page.locator('#previewContent .task-list-item input[type="checkbox"]').first()).toBeChecked();

  await previewCheckbox.click();

  await expect(page.locator('.cm-content').first()).toContainText('- [ ] First todo');
  await expect(page.locator('#previewContent .task-list-item input[type="checkbox"]').first()).not.toBeChecked();
});

test('keeps desktop secondary actions behind the toolbar overflow menu', async ({ page }) => {
  await openFile(page, 'README.md', { waitFor: 'preview' });

  await expect(page.locator('#toolbarOverflowToggle')).toBeVisible();
  await expect(page.locator('#chatToggleBtn')).toBeVisible();
  await expect(page.locator('#editorFindBtn')).toBeHidden();
  await expect(page.locator('#searchFilesBtn')).toBeHidden();
  await expect(page.locator('[data-editor-command="undo"]').first()).toBeHidden();
  await expect(page.locator('#editNameBtn')).toBeHidden();
  await expect(page.locator('#shareBtn')).toBeHidden();
  await expect(page.locator('#themeToggleBtn')).toBeHidden();

  await page.locator('#toolbarOverflowToggle').click();

  await expect(page.locator('#editNameBtn')).toBeVisible();
  await expect(page.locator('#shareBtn')).toBeVisible();
  await expect(page.locator('#exportMenuGroup')).toBeVisible();
  await expect(page.locator('#themeToggleBtn')).toBeVisible();
  await expect(page.locator('#themeToggleBtn')).toContainText('Theme');
  await expect(page.locator('#themeToggleBtn [data-theme-toggle-state]')).toContainText(/Dark|Light/);
});

test('opens the quick switcher from the top toolbar search action', async ({ page }) => {
  await openFile(page, 'README.md', { waitFor: 'preview' });

  const searchButton = page.locator('#toolbarSearchBtn');
  await expect(searchButton).toBeVisible();
  await expect(searchButton).toContainText('Search');
  await expect(searchButton.locator('kbd')).toHaveText('⌘K');
  expect(await searchButton.evaluate((element) => element.parentElement?.id)).toBe('toolbarCenter');

  const initialSearchBox = await searchButton.boundingBox();
  await page.locator('#activeFileName').evaluate((element) => {
    element.textContent = 'A deliberately long filename that should not move global actions';
  });
  const updatedSearchBox = await searchButton.boundingBox();
  expect(initialSearchBox).not.toBeNull();
  expect(updatedSearchBox).not.toBeNull();
  expect(Math.abs((updatedSearchBox?.x ?? 0) - (initialSearchBox?.x ?? 0))).toBeLessThanOrEqual(1);

  await searchButton.click();

  await expect(page.locator('#quickSwitcher')).toBeVisible();
  await expect(page.locator('#quickSwitcherInput')).toBeFocused();
});

test('export html downloads a self-contained rendered document', async ({ page, context }) => {
  await restoreReadmeTestDocument(page);
  await openFile(page, 'README.md', { waitFor: 'preview' });

  const popupDownloadPromise = context.waitForEvent('page').then(async (popup) => ({
    download: await popup.waitForEvent('download'),
    popup,
  }));
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportHtmlBtn').click();
  const { download, popup } = await popupDownloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk);
  }
  const html = Buffer.concat(chunks).toString('utf8');

  expect(download.suggestedFilename()).toBe('README.html');
  expect(html).toContain('<style>');
  expect(html).toContain('My Vault');
  expect(html).not.toContain('data-export-docx-src');
  await expect(popup.locator('#exportStatus')).toContainText('HTML download started.');
});

test('keeps basic markdown visually aligned between preview and HTML export', async ({ page, context }) => {
  await restoreReadmeTestDocument(page);
  await openFile(page, 'README.md', { waitFor: 'preview' });
  await replaceEditorContent(page, [
    '# Export parity',
    '',
    'A paragraph with **strong text**, *emphasis*, and [a link](https://example.com).',
    '',
    '> A short blockquote for visual comparison.',
    '',
    '- First item',
    '- Second item',
  ].join('\n'));
  await waitForPreview(page);
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.mouse.move(0, 0);

  const previewContent = page.locator('#previewContent');
  await expect(previewContent).toContainText('A paragraph with strong text');
  const previewPresentation = await previewContent.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      maxWidth: style.maxWidth,
      padding: style.padding,
      paragraphColor: getComputedStyle(element.querySelector('p') || element).color,
    };
  });
  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportHtmlBtn').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('#exportStatus')).toContainText('HTML download started.');
  await popup.setViewportSize({ height: 900, width: 1280 });
  await popup.mouse.move(0, 0);
  const exportContent = popup.locator('#exportContent');
  const exportPresentation = await exportContent.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      maxWidth: style.maxWidth,
      padding: style.padding,
      paragraphColor: getComputedStyle(element.querySelector('p') || element).color,
    };
  });

  expect(exportPresentation).toEqual(previewPresentation);
  await expect(previewContent).toHaveScreenshot('markdown-preview-parity-app.png', { animations: 'disabled' });
  await expect(exportContent).toHaveScreenshot('markdown-preview-parity-export.png', { animations: 'disabled' });
  await restoreReadmeTestDocument(page);
});

test('export docx uses the export page and posts the rendered snapshot html', async ({ page, context }) => {
  await restoreReadmeTestDocument(page);
  await openFile(page, 'README.md', { waitFor: 'preview' });
  await expect(page.locator('#exportMenuGroup')).not.toHaveClass(/hidden/);

  let exportRequestBody = null;
  await context.route('**/export/docx', async (route) => {
    exportRequestBody = route.request().postDataJSON();
    await route.fulfill({
      body: Buffer.from('PK\x03\x04'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      headers: {
        'Content-Disposition': 'attachment; filename="README.docx"',
      },
      status: 200,
    });
  });

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportDocxBtn').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await expect.poll(() => exportRequestBody).not.toBeNull();
  expect(exportRequestBody.filePath).toBe('README.md');
  expect(exportRequestBody.title).toBe('README');
  expect(exportRequestBody.html).toContain('My Vault');
  expect(exportRequestBody.html).not.toContain('toolbarOverflowMenu');
  await expect(popup.locator('#exportStatus')).toContainText('DOCX download started.');
});

test('export pdf uses the export page and prints the rendered snapshot html', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, '__collabmdPrinted', {
      configurable: true,
      value: false,
      writable: true,
    });

    window.print = () => {
      window.__collabmdPrinted = true;
      window.dispatchEvent(new Event('afterprint'));
    };
  });

  await openFile(page, 'README.md', { waitFor: 'preview' });

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportPdfBtn').click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/export-document\.html$/);

  await expect.poll(() => popup.evaluate(() => window.__collabmdPrinted)).toBe(true);
  await expect(popup.locator('#exportContent')).toContainText('My Vault');
  await expect(popup.locator('#exportStatus')).toContainText('Print dialog opened.');
  await expect.poll(() => popup.evaluate(() => ({
    bodyMatchesViewport: document.body.clientWidth === window.innerWidth,
    htmlMatchesViewport: document.documentElement.clientWidth === window.innerWidth,
  }))).toEqual({
    bodyMatchesViewport: true,
    htmlMatchesViewport: true,
  });
});

test('shows provisional content before delayed websocket sync and upgrades to collaborative editing', async ({ page }) => {
  await setHydrateDelay(page, 2000);

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

test('file explorer uploads multiple supported vault files', async ({ page }) => {
  await openHome(page);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await chooseCreateAction(page, 'Upload files');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([
    {
      buffer: Buffer.from('# Uploaded note\n'),
      mimeType: 'text/markdown',
      name: 'uploaded-note.md',
    },
    {
      buffer: Buffer.from('<mxfile />'),
      mimeType: 'application/xml',
      name: 'uploaded-diagram.drawio',
    },
    {
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPgF9f6D8IMMAYAKWgFPch3sv8AAAAASUVORK5CYII=', 'base64'),
      mimeType: 'image/png',
      name: 'uploaded-image.png',
    },
    {
      buffer: createPdfFixture({
        pageCount: 5,
        outline: [
          { title: 'Introduction', page: 1 },
          { title: 'Chapter 2', page: 3 },
        ],
      }),
      mimeType: 'application/pdf',
      name: 'uploaded-guide.pdf',
    },
  ]);

  await expect(page.locator('#fileTree')).toContainText('uploaded-note');
  await expect(page.locator('#fileTree')).toContainText('uploaded-diagram');
  await expect(page.locator('#fileTree')).toContainText('uploaded-image');
  await expect(page.locator('#fileTree')).toContainText('uploaded-guide');

  await page.locator('#fileTree').getByText('uploaded-image').click();
  await expect(page.locator('#previewContent .image-file-preview-image')).toBeVisible();

  await page.locator('#fileTree').getByText('uploaded-guide').click();
  const pdfViewer = page.locator('#previewContent embedpdf-container');
  await expect(pdfViewer).toBeVisible();
  await expect(pdfViewer.getByText('5', { exact: true })).toBeVisible();
  await expect(pdfViewer.getByRole('tab', { name: /annotate/i })).toHaveCount(0);
  await expect(page.locator('#outlineToggle')).toBeHidden();

  await pdfViewer.getByRole('button', { name: 'Search' }).click();
  await pdfViewer.getByPlaceholder('Search').fill('EmbedPDF preview');
  await expect(pdfViewer.getByText('5 results found')).toBeVisible();

  await pdfViewer.getByRole('textbox', { name: 'Set zoom' }).fill('100');
  await pdfViewer.getByRole('textbox', { name: 'Set zoom' }).press('Enter');
  await expect(pdfViewer.getByRole('textbox', { name: 'Set zoom' })).toHaveValue('100');
  await pdfViewer.getByRole('button', { name: 'Zoom In' }).click();
  await expect.poll(async () => Number(
    await pdfViewer.getByRole('textbox', { name: 'Set zoom' }).inputValue(),
  )).toBeGreaterThan(100);

  const response = await page.request.get('/api/download/file?path=uploaded-note.md');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe('# Uploaded note\n');
});

test('image toolbar uploads a vault attachment and inserts inline markdown', async ({ page }) => {
  await openFile(page, 'README.md');
  await waitForCollaborativeEditor(page);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-markdown-action="image"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPgF9f6D8IMMAYAKWgFPch3sv8AAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
    name: 'inline-diagram.png',
  });

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toMatch(/!\[inline diagram\]\(assets\/inline-diagram-[^)]+\.webp\)/i);

  await expect(page.locator('#fileTree')).toContainText('assets');
  const uploadedImage = page.locator('#previewContent img[src$=".webp"]');
  await expect(uploadedImage).toBeVisible();
  await expect(uploadedImage).toHaveAttribute(
    'src',
    /\/api\/(?:v\/[^/]+\/)?attachment\?path=assets%2Finline-diagram-[^?]+\.webp/,
  );

  const uploadedMarkdown = await page.evaluate(async () => {
    const response = await fetch('/api/file?path=README.md');
    const data = await response.json();
    return data.content || '';
  });
  const uploadedPath = uploadedMarkdown.match(/!\[inline diagram\]\((assets\/inline-diagram-[^)]+\.webp)\)/i)?.[1];
  if (!uploadedPath) {
    throw new Error('Expected uploaded image markdown to contain an asset path.');
  }

  await openFile(page, uploadedPath, { waitFor: 'preview' });
  await expect(page.locator('#previewContent .image-file-preview-image')).toBeVisible();
  await expect(page.locator('#backlinksPanel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#backlinksPanel .backlinks-count')).toHaveText('1');
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

  await page.locator('#fileTree').getByText('assets').click();
  await page.locator('#fileTree .file-tree-item', { hasText: 'preview-switch' }).click();

  await expect(page.locator('#previewContent').locator('.image-file-preview-image')).toBeVisible();
  await expect(page.locator('#previewContent .video-embed-iframe')).toHaveCount(0);
  await expect(page.locator('#previewContent [data-video-overlay-root="true"]')).toHaveCount(0);
});

test('pasting an image uploads a vault attachment and inserts inline markdown', async ({ page }) => {
  await openFile(page, 'README.md');
  await waitForCollaborativeEditor(page);

  await pasteClipboardImage(page, {
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPgF9f6D8IMMAYAKWgFPch3sv8AAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
  });

  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      const data = await response.json();
      return data.content || '';
    })
  )).toMatch(/!\[[^\]]+\]\(assets\/[a-z-]+-[^)]+\.webp\)/i);

  await expect(page.locator('#fileTree')).toContainText('assets');
  const uploadedImage = page.locator('#previewContent img[src$=".webp"]');
  await expect(uploadedImage).toBeVisible();
  await expect(uploadedImage).toHaveAttribute(
    'src',
    /\/api\/(?:v\/[^/]+\/)?attachment\?path=assets%2F[^?]+\.webp/,
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

test('quick switcher reveals the opened file in the file tree', async ({ page }) => {
  await openHome(page);

  for (let index = 0; index < 40; index += 1) {
    const padded = String(index).padStart(2, '0');
    const response = await page.request.put('/api/file', {
      data: {
        content: `# note-${padded}\n`,
        path: `zz-folder-${padded}/note-${padded}.md`,
      },
    });
    expect(response.ok()).toBe(true);
  }

  await expect(page.locator('#fileTree')).toContainText('zz-folder-39');
  await expect(page.locator('#fileTree .file-tree-dir[data-path^="zz-folder-"]')).toHaveCount(40);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.locator('#quickSwitcher')).toBeVisible();
  await page.locator('#quickSwitcherInput').fill('note-39');
  await page.locator('#quickSwitcherResults .qs-result-item').first().click();

  await waitForEditor(page);

  await expect.poll(async () => page.locator('#fileTree').evaluate((element) => {
    const active = element.querySelector('.file-tree-file.active');
    const activeRect = active?.getBoundingClientRect();
    const treeRect = element.getBoundingClientRect();

    return {
      activePath: active?.getAttribute('data-path') ?? null,
      isVisible: Boolean(
        activeRect
        && activeRect.top >= treeRect.top
        && activeRect.bottom <= treeRect.bottom + 1
      ),
    };
  })).toEqual({
    activePath: 'zz-folder-39/note-39.md',
    isVisible: true,
  });
});

test('quick switcher text search opens a grouped match at the matching line', async ({ page }) => {
  await openHome(page);

  const alphaLines = [
    '# Global Search Alpha',
    '',
    'Context before the target.',
    'Another ordinary line.',
    'Needle-E2E appears in alpha line.',
    'Context after the target.',
  ];
  const betaLines = [
    '# Global Search Beta',
    '',
    'Needle-E2E appears in beta line.',
  ];
  const files = [
    {
      content: `${alphaLines.join('\n')}\n`,
      path: 'search/global-search-alpha.md',
    },
    {
      content: `${betaLines.join('\n')}\n`,
      path: 'search/global-search-beta.md',
    },
    {
      content: '{"type":"excalidraw","elements":[{"type":"text","text":"Needle-E2E appears in the sketch."}]}\n',
      path: 'search/global-search-sketch.excalidraw',
    },
  ];

  for (const file of files) {
    const response = await page.request.put('/api/file', { data: file });
    expect(response.ok()).toBe(true);
  }
  const resetResponse = await page.request.post('/api/test/reset-state');
  expect(resetResponse.ok()).toBe(true);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.locator('#quickSwitcher')).toBeVisible();
  await page.locator('[data-qs-mode="text"]').click();
  await page.locator('#quickSwitcherInput').fill('needle-e2e');

  const results = page.locator('#quickSwitcherResults');
  const alphaGroup = results.locator('.qs-text-group', { hasText: 'global-search-alpha' });
  const betaGroup = results.locator('.qs-text-group', { hasText: 'global-search-beta' });
  const sketchGroup = results.locator('.qs-text-group', { hasText: 'global-search-sketch' });
  await expect(alphaGroup).toBeVisible();
  await expect(betaGroup).toBeVisible();
  await expect(sketchGroup).toBeVisible();
  await expect(sketchGroup.locator('.qs-text-item')).toContainText('Needle-E2E appears in the sketch.');

  await alphaGroup.locator('.qs-text-item', { hasText: 'Needle-E2E appears in alpha line.' }).click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('global-search-alpha');
  await expect(page.locator('.cm-content').first()).toContainText('Needle-E2E appears in alpha line.');
  await expect(page.locator('#lineInfo')).toContainText('Ln 5');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('file=search%2Fglobal-search-alpha.md');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('line=5');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('column=1');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('matchLength=10');
});

test('creates files from the sidebar with the custom dialog', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /Markdown note/i);
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

  await chooseCreateAction(page, /^Folder/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();

  await page.locator('#fileActionInput').fill('plans/archive');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('plans');
  await expect(page.locator('#fileTree')).toContainText('archive');
});

test('empty state create uses the shared create picker', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /Markdown note/i, { from: 'empty-state' });
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create markdown file');
});

test('creates draw.io diagrams from the sidebar create picker', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /draw\.io diagram/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Create draw.io diagram');

  await page.locator('#fileActionInput').fill('diagrams/system-map');
  await page.locator('#fileActionSubmit').click();

  await waitForPreview(page);
  await expect(page.locator('#activeFileName')).toContainText('system-map');
  await expect(page.locator('#fileTree')).toContainText('system-map');
});

test('creates files inside a folder from the tree context menu', async ({ page }) => {
  await openHome(page);

  const projectsFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'projects' }).first();
  await projectsFolder.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'New…' }).click();
  await page.locator('.create-menu').getByRole('menuitem', { name: /Markdown note/i }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionNote')).toContainText('Parent folder: projects');
  await page.locator('#fileActionInput').fill('context-menu-note');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('context-menu-note');
  await expect(page.locator('#fileTree')).toContainText('projects');
  await expect(page.locator('#fileTree')).toContainText('context-menu-note');
});

test('creates root files from empty tree space context menu', async ({ page }) => {
  await openHome(page);

  await page.locator('#fileSearchInput').fill('zzzz-no-match');
  await expect(page.locator('#fileTree')).toContainText('No matches');

  await page.locator('#fileTree').click({ button: 'right', position: { x: 24, y: 24 } });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'New PlantUML diagram' }).click();

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

  await chooseCreateAction(page, /Markdown note/i);
  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await page.locator('#fileActionInput').fill('scratchpad');
  await page.locator('#fileActionSubmit').click();

  await waitForEditor(page);
  const scratchpadItem = page.locator('#fileTree .file-tree-item', { hasText: 'scratchpad' }).first();
  await scratchpadItem.click({ button: 'right' });
  await expect(page.locator('.file-context-menu')).toBeVisible();
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Rename / move' }).click();

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
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionField')).toHaveAttribute('hidden', '');
  await expect(page.locator('#fileActionNote')).toContainText('release-notes.md');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#fileTree')).not.toContainText('release-notes');
});

test('moves files between folders by drag and drop in the sidebar', async ({ page }) => {
  await openHome(page);
  await page.locator('#fileSearchInput').fill('');

  const fileName = `scratchpad-${Date.now()}`;

  await chooseCreateAction(page, /Markdown note/i);
  await page.locator('#fileActionInput').fill(fileName);
  await page.locator('#fileActionSubmit').click();
  await waitForEditor(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('notes');
  await page.locator('#fileActionSubmit').click();

  const sourceFilePath = `${fileName}.md`;
  const movedFilePath = `notes/${fileName}.md`;

  await expect(page.locator(`#fileTree .file-tree-file[data-path="${sourceFilePath}"]`)).toBeVisible();
  await expect(page.locator('#fileTree .file-tree-dir[data-path="notes"]')).toBeVisible();

  let moved = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dragFileTreeFileToDirectory(page, {
      sourceFilePath,
      targetDirectoryPath: 'notes',
    });

    moved = await page.evaluate(async (pathValue) => {
      const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return response.ok;
    }, movedFilePath);
    if (moved) {
      break;
    }

    try {
      await expect.poll(async () => page.evaluate(async (pathValue) => {
        const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
        return response.ok;
      }, movedFilePath), { timeout: 1250 }).toBeTruthy();
      moved = true;
      break;
    } catch {
      // Retry the drag; WebKit/Chromium can occasionally miss the first drop event.
    }
  }

  expect(moved).toBe(true);

  await expect(page.locator('#activeFileName')).toContainText(fileName);
  await expect(page.locator('#fileTree')).toContainText('notes');
  await expect(page.locator('#fileTree')).toContainText(fileName);
  await expect(page.locator('#fileTree .file-tree-file').filter({ hasText: fileName })).toHaveCount(1);
  await expect.poll(async () => (
    page.evaluate(async (pathValue) => {
      const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return response.ok;
    }, movedFilePath)
  ), {
    timeout: 20000,
  }).toBe(true);
});

test('moves files back to the vault root through the root drop target', async ({ page }) => {
  await openHome(page);
  await page.locator('#fileSearchInput').fill('');

  const fileName = `scratchpad-${Date.now()}`;
  const nestedFilePath = `notes/${fileName}.md`;
  const rootFilePath = `${fileName}.md`;

  await chooseCreateAction(page, /Markdown note/i);
  await page.locator('#fileActionInput').fill(`notes/${fileName}`);
  await page.locator('#fileActionSubmit').click();
  await waitForEditor(page);

  await expect(page.locator(`#fileTree .file-tree-file[data-path="${nestedFilePath}"]`)).toBeVisible();

  const rootDropZone = page.locator('#fileTree .file-tree-root-drop-zone');
  await expect(rootDropZone).toBeHidden();

  await page.evaluate((pathValue) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(pathValue)}"]`);
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  }, nestedFilePath);
  await expect(rootDropZone).toBeVisible();
  await page.evaluate((pathValue) => {
    const source = document.querySelector(`#fileTree .file-tree-file[data-path="${CSS.escape(pathValue)}"]`);
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
  }, nestedFilePath);
  await expect(rootDropZone).toBeHidden();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dragFileTreeFileToRoot(page, { sourceFilePath: nestedFilePath });

    const movedToRoot = await page.evaluate(async (pathValue) => {
      const response = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return response.ok;
    }, rootFilePath);
    if (movedToRoot) {
      break;
    }

    await page.waitForTimeout(200);
  }

  await expect(page.locator('#activeFileName')).toContainText(fileName);
  await expect.poll(async () => (
    page.evaluate(async ({ nestedPath, rootPath }) => {
      const rootResponse = await fetch(`/api/file?path=${encodeURIComponent(rootPath)}`);
      const nestedResponse = await fetch(`/api/file?path=${encodeURIComponent(nestedPath)}`);
      return JSON.stringify({
        nestedExists: nestedResponse.ok,
        rootExists: rootResponse.ok,
      });
    }, {
      nestedPath: nestedFilePath,
      rootPath: rootFilePath,
    })
  ), {
    timeout: 20000,
  }).toContain('"rootExists":true');
  await expect.poll(async () => (
    page.evaluate(async (pathValue) => {
      const nestedResponse = await fetch(`/api/file?path=${encodeURIComponent(pathValue)}`);
      return nestedResponse.status;
    }, nestedFilePath)
  ), {
    timeout: 20000,
  }).toBe(404);
});

test('rejects dragging a folder into one of its descendants', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('guides/archive');
  await page.locator('#fileActionSubmit').click();

  const guidesItem = page.locator('#fileTree .file-tree-dir', { hasText: 'guides' }).first();
  const archiveItem = page.locator('#fileTree .file-tree-dir', { hasText: 'archive' }).first();
  await guidesItem.dragTo(archiveItem);

  await expect(page.locator('#fileTree')).toContainText('guides');
  await expect(page.locator('#fileTree')).toContainText('archive');
  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/api/files');
      const data = await response.json();
      return JSON.stringify(data.tree || []);
    })
  )).toContain('"path":"guides/archive"');
});

test('renames folders from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('drafts-old');
  await page.locator('#fileActionSubmit').click();

  const folderItem = page.locator('#fileTree .file-tree-dir', { hasText: 'drafts-old' }).first();
  await folderItem.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Rename / move' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Rename or move folder');
  await expect(page.locator('#fileActionLabel')).toHaveText('Path');
  await page.locator('#fileActionInput').fill('drafts-new');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).toContainText('drafts-new');
  await expect(page.locator('#fileTree')).not.toContainText('drafts-old');
});

test('downloads files and directories from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  const fileDownloadPromise = page.waitForEvent('download');
  await page.locator('#fileTree .file-tree-file', { hasText: 'README' }).first().click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Download' }).click();
  const fileDownload = await fileDownloadPromise;
  expect(fileDownload.suggestedFilename()).toBe('README.md');

  const directoryDownloadPromise = page.waitForEvent('download');
  await page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first().click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Download source ZIP' }).click();
  const directoryDownload = await directoryDownloadPromise;
  expect(directoryDownload.suggestedFilename()).toBe('daily.zip');
});

test('exports a folder as one self-contained HTML document', async ({ page, context }) => {
  await openHome(page);

  const popupDownloadPromise = context.waitForEvent('page').then(async (popup) => ({
    download: await popup.waitForEvent('download'),
    popup,
  }));
  await page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first().click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Export HTML' }).click();
  const { download, popup } = await popupDownloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk);
  }
  const html = Buffer.concat(chunks).toString('utf8');

  expect(download.suggestedFilename()).toBe('daily.html');
  expect(html).toContain('daily/2026-03-05.md');
  expect(html).toContain('export-document-section');
  await expect(popup.locator('#exportStatus')).toContainText('HTML download started.');
});

test('prints all markdown notes in a folder as one PDF document', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => {
      window.__collabmdPrinted = true;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await openHome(page);

  const popupPromise = context.waitForEvent('page');
  await page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first().click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Print / save PDF' }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/export-document\.html$/);

  await expect.poll(() => popup.evaluate(() => window.__collabmdPrinted)).toBe(true);
  await expect(popup.locator('#exportContent')).toContainText('daily/2026-03-05.md');
  await expect(popup.locator('.export-document-section')).toHaveCount(1);
  await expect(popup.locator('#exportStatus')).toContainText('Print dialog opened.');
});

test('deletes empty folders from the sidebar context menu', async ({ page }) => {
  await openHome(page);

  await chooseCreateAction(page, /^Folder/i);
  await page.locator('#fileActionInput').fill('scratch-empty');
  await page.locator('#fileActionSubmit').click();

  const folderItem = page.locator('#fileTree .file-tree-dir', { hasText: 'scratch-empty' }).first();
  await folderItem.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Delete folder');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).not.toContainText('scratch-empty');
});

test('deletes non-empty folders with an explicit recursive confirmation', async ({ page }) => {
  await openHome(page);

  const dailyFolder = page.locator('#fileTree .file-tree-dir', { hasText: 'daily' }).first();
  await dailyFolder.click({ button: 'right' });
  await page.locator('.file-context-menu').getByRole('menuitem', { name: 'Delete' }).click();

  await expect(page.locator('#fileActionDialog')).toBeVisible();
  await expect(page.locator('#fileActionTitle')).toHaveText('Delete folder and contents');
  await expect(page.locator('#fileActionCopy')).toContainText('file');
  await page.locator('#fileActionSubmit').click();

  await expect(page.locator('#fileTree')).not.toContainText('daily');
});

test('search returns files from matching paths without directory rows', async ({ page }) => {
  await restoreVaultFileFromTemplate(page, 'daily/2026-03-05.md');
  await openHome(page);

  await page.locator('#fileSearchInput').fill('daily');

  await expect(page.locator('#fileTree .file-tree-dir')).toHaveCount(0);
  await expect(page.locator('#fileTree .file-tree-file')).toContainText('2026-03-05.md');
  await expect(page.locator('#fileTree .file-tree-search-path')).toHaveText('daily');
});

test('creates and opens unresolved wiki-link targets', async ({ page }) => {
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Create\n\nGo to [[notes/new-page]]');
  await expect(page.locator('#previewContent .wiki-link-new')).toHaveCount(1);

  await page.locator('#previewContent .wiki-link-new').first().click();
  await waitForEditor(page);
  await expect(page.locator('#activeFileName')).toContainText('new-page');
});

test('does not create unresolved wiki-link targets when auto-create is disabled', async ({ page }) => {
  await page.route('**/app-config.js', async (route) => {
    await route.fulfill({
      body: 'window.__COLLABMD_CONFIG__ = {"wikiLinkAutoCreate":false};\n',
      contentType: 'text/javascript; charset=utf-8',
      status: 200,
    });
  });
  await openFile(page, 'README.md');

  await replaceEditorContent(page, '# Wiki Missing\n\nGo to [[notes/hidden-page]]');
  const missingLink = page.locator('#previewContent .wiki-link-new').first();
  await expect(missingLink).toHaveAttribute('title', 'Missing "notes/hidden-page"');

  await missingLink.click();

  await expect(page.locator('#toastContainer')).toContainText('Wiki-link target does not exist');
  await expect(page.locator('#activeFileName')).toContainText('README');

  const response = await page.request.get('/api/file?path=notes%2Fhidden-page.md');
  expect(response.status()).toBe(404);
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
