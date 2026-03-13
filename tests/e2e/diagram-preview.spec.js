import {
  ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR,
  ACTIVE_MAXIMIZED_PLANTUML_SELECTOR,
  duplicateVaultFile,
  expect,
  getMermaidZoomMetrics,
  getPlantUmlZoomMetrics,
  openFile,
  openHome,
  openSampleFull,
  replaceEditorContent,
  stubPlantUmlRender,
  test,
  waitForHeavyPreviewContent,
} from './helpers/app-fixture.js';

const README_TEST_DOCUMENT = `# My Vault

Welcome to the test vault. This is the top-level readme.

## Links

- [[daily/2026-03-05]]
- [[projects/collabmd]]
`;

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

test('opens excalidraw files with a direct iframe preview', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();

  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-excalidraw' }).first().click();

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', /file=sample-excalidraw\.excalidraw/);
  await expect(iframe).not.toHaveAttribute('src', /mode=preview/);
  await expect(page.locator('#previewContent .excalidraw-embed-label')).toHaveText('sample-excalidraw');
  await expect(page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]')).toHaveCount(0);
  await expect(page.locator('#previewContent .excalidraw-embed-placeholder')).toHaveCount(0);
  await expect(page.locator('#previewContent')).not.toContainText('Loading Excalidraw preview…');
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

  await page.locator('#previewContent .excalidraw-embed-btn[aria-label="Maximize diagram"]').click();
  await expect(page.locator(ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR)).toHaveClass(/is-maximized/);

  const maximizedWidths = await page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const embed = document.querySelector('[data-excalidraw-maximized-root="true"] .excalidraw-embed.is-maximized');
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

test('markdown excalidraw embeds use preview mode with an edit button', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).toHaveAttribute('src', /mode=preview/);
  await expect(page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').first()).toBeVisible();
});

test('embedded excalidraw edit button navigates to the diagram file', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').first().click();
  await expect(page).toHaveURL(/#file=sample-excalidraw\.excalidraw/);
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toHaveAttribute('src', /file=sample-excalidraw\.excalidraw/);
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).not.toHaveAttribute('src', /mode=preview/);
});

test('sample-full renders embedded PlantUML files', async ({ page }) => {
  await openSampleFull(page);

  await expect(page.locator('#previewContent .plantuml-placeholder-btn').first()).toBeVisible();
  await page.evaluate(() => {
    const button = document.querySelector('#previewContent .plantuml-placeholder-btn');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Missing PlantUML placeholder button');
    }

    button.click();
  });

  await expect(page.locator('#previewContent .plantuml-frame svg').first()).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-frame').first()).toContainText('sample-full-plantuml');
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

test('opening an embedded excalidraw file directly remounts it in editable mode', async ({ page }) => {
  test.slow();

  await openSampleFull(page);

  const embeddedIframe = page.locator('#previewContent .excalidraw-embed iframe[src*="sample-excalidraw.excalidraw"]').first();
  await expect.poll(async () => (
    embeddedIframe.count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe[src*="sample-excalidraw.excalidraw"]');
      return iframe?.contentWindow?.document?.readyState || '';
    })
  ), { timeout: 60000 }).toBe('complete');

  const firstInstanceId = await embeddedIframe.getAttribute('data-instance-id');

  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-excalidraw' }).first().click();
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

  const directIframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(directIframe).toBeVisible();
  await expect(directIframe).toHaveAttribute('src', /file=sample-excalidraw\.excalidraw/);
  await expect(directIframe).not.toHaveAttribute('src', /mode=preview/);
  await expect(page.locator('#previewContent')).not.toContainText('Loading Excalidraw preview…');
  await expect(page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]')).toHaveCount(0);

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id')
  ), { timeout: 60000 }).not.toBe(firstInstanceId);
});

test('switching away from a direct excalidraw preview hides stale iframe overlays immediately', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">switch-puml</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();
  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-excalidraw' }).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed iframe')).toBeVisible();

  const writeReadmeResponse = await page.request.put('http://127.0.0.1:4173/api/file', {
    data: {
      content: README_TEST_DOCUMENT,
      path: 'README.md',
    },
  });
  expect(writeReadmeResponse.ok()).toBeTruthy();

  await page.locator('#fileTree .file-tree-item', { hasText: 'README' }).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toBeHidden();
  await expect(page.locator('#previewContent')).toContainText('My Vault');

  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-plantuml' }).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toBeHidden();
  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('switch-puml');
});

test('switching from an unrelated direct excalidraw file to sample-full removes the stale overlay', async ({ page }) => {
  await stubPlantUmlRender(page, 'sample-full-switch');
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();

  await duplicateVaultFile(page, 'sample-excalidraw.excalidraw', 'new-diagram.excalidraw');
  await page.locator('#refreshFilesBtn').click();
  await expect(page.locator('#fileTree')).toContainText('new-diagram');

  await page.locator('#fileTree .file-tree-item', { hasText: 'new-diagram' }).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed[data-file="new-diagram.excalidraw"] iframe')).toBeVisible();

  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-full' }).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed[data-file="new-diagram.excalidraw"]')).toBeHidden();
  await expect(page.locator('#previewContent')).toContainText('CollabMD');
  await expect(page.locator('#previewContent .excalidraw-embed[data-file="sample-excalidraw.excalidraw"]')).toBeVisible();
});

test('embedded excalidraw maximize preserves layout and modal sizing', async ({ page }) => {
  test.slow();

  await openSampleFull(page);

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await expect(page.locator('#previewContent .excalidraw-embed-btn[aria-label="Expand diagram"]')).toHaveCount(0);

  await page.locator('#previewContent .excalidraw-embed-btn[aria-label="Maximize diagram"]').first().click();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} .excalidraw-embed-btn[aria-label="Restore diagram size"]`).first()).toBeVisible();

  const afterMaximize = await page.evaluate(() => {
    const embed = document.querySelector('[data-excalidraw-maximized-root="true"] .excalidraw-embed.is-maximized');
    const previewContainer = document.getElementById('previewContainer');
    const resizer = document.getElementById('resizer');
    if (!embed || !previewContainer) {
      return null;
    }

    const rect = embed.getBoundingClientRect();
    const resizerRect = resizer?.getBoundingClientRect();
    const probeX = resizerRect ? Math.round(resizerRect.left + (resizerRect.width / 2)) : null;
    const probeY = Math.round(rect.top + 120);
    const topElement = probeX === null ? null : document.elementFromPoint(probeX, probeY);
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

  await expect.poll(async () => (
    page.evaluate(() => {
      const mermaid = document.querySelector('#previewContent .mermaid-shell');
      const excalidraw = document.querySelector('#previewContent .excalidraw-embed');
      if (!mermaid || !excalidraw) {
        return Number.POSITIVE_INFINITY;
      }

      return Math.abs(
        mermaid.getBoundingClientRect().width - excalidraw.getBoundingClientRect().width,
      );
    })
  ), { timeout: 60000 }).toBeLessThanOrEqual(2);
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

test('preserves embedded Mermaid file instances across unrelated preview rerenders', async ({ page }) => {
  test.slow();

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Mermaid Embed Preserve',
    '',
    'Intro copy before the diagram.',
    '',
    '![[sample-mermaid.mmd]]',
    '',
    'Closing copy after the diagram.',
  ].join('\n'));

  await expect.poll(async () => (
    page.evaluate(() => (
      document.querySelector('#previewContent .mermaid-shell[data-mermaid-target="sample-mermaid.mmd"]')?.getAttribute('data-mermaid-key') || ''
    ))
  ), { timeout: 60000 }).toBeTruthy();

  const mermaidKey = await page.evaluate(() => (
    document.querySelector('#previewContent .mermaid-shell[data-mermaid-target="sample-mermaid.mmd"]')?.getAttribute('data-mermaid-key') || ''
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

  await replaceEditorContent(page, [
    '# Mermaid Embed Preserve',
    '',
    'Updated intro copy without touching the diagram.',
    '',
    '![[sample-mermaid.mmd]]',
    '',
    'Updated closing copy after the diagram.',
  ].join('\n'));

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
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
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
  await expect(page.locator(`${ACTIVE_MAXIMIZED_PLANTUML_SELECTOR} .plantuml-tool-btn[aria-label="Restore diagram size"]`)).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  const maximizedFitLabel = await page.locator(`${ACTIVE_MAXIMIZED_PLANTUML_SELECTOR} .plantuml-zoom-label`).textContent();
  expect(maximizedFitLabel).not.toBe(zoomedInlineLabel);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  const resizedMaximizedLabel = await page.locator(`${ACTIVE_MAXIMIZED_PLANTUML_SELECTOR} .plantuml-zoom-label`).textContent();
  expect(resizedMaximizedLabel).not.toBe(maximizedFitLabel);

  await page.locator(`${ACTIVE_MAXIMIZED_PLANTUML_SELECTOR} .plantuml-tool-btn[aria-label="Zoom in"]`).click();
  const zoomedMaximizedLabel = await page.locator(`${ACTIVE_MAXIMIZED_PLANTUML_SELECTOR} .plantuml-zoom-label`).textContent();

  await page.locator(`${ACTIVE_MAXIMIZED_PLANTUML_SELECTOR} .plantuml-tool-btn[aria-label="Restore diagram size"]`).click();
  await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Maximize diagram"]')).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  const restoredLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  expect(restoredLabel).not.toBe(zoomedMaximizedLabel);
});

test('opens .mmd files with side-by-side Mermaid preview', async ({ page }) => {
  await openFile(page, 'sample-mermaid.mmd');

  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'split');
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getMermaidZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('Start');
  const initialLabel = await page.locator('#previewContent .mermaid-zoom-label').textContent();
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Zoom in"]').click();
  await expect(page.locator('#previewContent .mermaid-zoom-label')).not.toHaveText(initialLabel || '');
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Reset zoom"]').click();
  await expect.poll(async () => {
    const metrics = await getMermaidZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();
  await expect(page.locator('#outlineToggle')).toHaveClass(/hidden/);
  await expect(page.locator('#backlinksPanel')).toHaveClass(/hidden/);

  await page.locator('#previewContent .mermaid-maximize-btn[aria-label="Maximize diagram"]').click();
  await expect(page.locator('#previewContent .mermaid-shell.is-maximized .mermaid-maximize-btn[aria-label="Restore diagram size"]')).toBeVisible();

  const maximizedBounds = await page.evaluate(() => {
    const shell = document.querySelector('#previewContent .mermaid-shell.is-maximized');
    if (!(shell instanceof HTMLElement)) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    return {
      left: rect.left,
      position: window.getComputedStyle(shell).position,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });

  expect(maximizedBounds).not.toBeNull();
  expect(maximizedBounds.position).toBe('fixed');
  expect(maximizedBounds.left).toBeGreaterThanOrEqual(0);
  expect(maximizedBounds.right).toBeLessThanOrEqual(maximizedBounds.viewportWidth);
});

test('preserves manual Mermaid zoom after preview layout sync runs', async ({ page }) => {
  await openFile(page, 'sample-mermaid.mmd');

  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getMermaidZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();

  const initialLabel = await page.locator('#previewContent .mermaid-zoom-label').textContent();
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Zoom in"]').click();
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Zoom in"]').click();
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Zoom in"]').click();
  await expect(page.locator('#previewContent .mermaid-zoom-label')).not.toHaveText(initialLabel || '');

  await page.waitForTimeout(1000);
  await expect(page.locator('#previewContent .mermaid-zoom-label')).not.toHaveText(initialLabel || '');
});

test('renders embedded Mermaid files from markdown docs', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Mermaid Embed',
    '',
    '![[sample-mermaid.mmd|Embedded flow]]',
  ].join('\n'));

  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('Start');
  await expect(page.locator('#previewContent .mermaid-shell[data-mermaid-target="sample-mermaid.mmd"]')).toHaveCount(1);
});

test('renders historical Mermaid gantt charts without an oversized today marker canvas', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Mermaid Gantt',
    '',
    '```mermaid',
    'gantt',
    '    dateFormat  YYYY-MM-DD',
    '    title       Adding GANTT diagram functionality to mermaid',
    '    excludes    weekends',
    '    section A section',
    '    Completed task           :done,    des1, 2014-01-06,2014-01-08',
    '    Active task              :active,  des2, 2014-01-09, 3d',
    '    Future task              :         des3, after des2, 5d',
    '    Future task2             :         des4, after des3, 5d',
    '    section Critical tasks',
    '    Completed task in the critical line :crit, done, 2014-01-06,24h',
    '    Implement parser and json          :crit, done, after des1, 2d',
    '    Create tests for parser            :crit, active, 3d',
    '    Future task in critical line       :crit, 5d',
    '    Create tests for renderer          :2d',
    '    Add to mermaid                     :until isadded',
    '    Functionality added                :milestone, isadded, 2014-01-25, 0d',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('Completed task');
  await expect.poll(async () => (
    page.evaluate(() => {
      const frame = document.querySelector('#previewContent .mermaid-frame');
      const svg = frame?.querySelector('svg');
      if (!(frame instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
        return null;
      }

      return {
        scrollWidth: frame.scrollWidth,
        widthAttr: Number.parseFloat(svg.getAttribute('width') || '0'),
      };
    })
  )).toEqual({
    scrollWidth: expect.any(Number),
    widthAttr: expect.any(Number),
  });
  const metrics = await page.evaluate(() => {
    const frame = document.querySelector('#previewContent .mermaid-frame');
    const svg = frame?.querySelector('svg');
    if (!(frame instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      return null;
    }

    return {
      scrollWidth: frame.scrollWidth,
      widthAttr: Number.parseFloat(svg.getAttribute('width') || '0'),
    };
  });
  expect(metrics?.scrollWidth ?? 0).toBeLessThan(3000);
  expect(metrics?.widthAttr ?? 0).toBeLessThan(3000);
});

test('renders Mermaid state diagrams without oversized bounds or HTML labels', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Mermaid State',
    '',
    '```mermaid',
    'stateDiagram-v2',
    '    [*] --> Connecting',
    '    Connecting --> Connected: WebSocket open',
    '    Connecting --> Unreachable: Timeout',
    '    Connected --> Disconnected: WebSocket close',
    '    Disconnected --> Connecting: Auto-reconnect',
    '    Unreachable --> Connecting: Retry',
    '',
    '    state Connected {',
    '        [*] --> Idle',
    '        Idle --> Editing: Keystroke',
    '        Editing --> Idle: 3s inactivity',
    '        Idle --> Following: Click follow',
    '        Following --> Idle: Unfollow',
    '    }',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('Connecting');
  const metrics = await page.evaluate(() => {
    const svg = document.querySelector('#previewContent .mermaid-frame svg');
    if (!(svg instanceof SVGSVGElement)) {
      return null;
    }

    return {
      hasForeignObject: Boolean(svg.querySelector('foreignObject')),
      widthAttr: Number.parseFloat(svg.getAttribute('width') || '0'),
      heightAttr: Number.parseFloat(svg.getAttribute('height') || '0'),
    };
  });
  expect(metrics?.hasForeignObject).toBe(false);
  expect(metrics?.widthAttr ?? 0).toBeLessThan(2000);
  expect(metrics?.heightAttr ?? 0).toBeLessThan(2000);
});

test('renders Mermaid class diagrams without oversized bounds or HTML labels', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Mermaid Class',
    '',
    '```mermaid',
    'classDiagram',
    '    class User {',
    '        +UUID id',
    '        +String fullName',
    '        +String phoneNumber',
    '        +String email',
    '        +UserStatus status',
    '        +login()',
    '        +updateProfile()',
    '    }',
    '    class Rider {',
    '        +Decimal rating',
    '        +requestRide()',
    '        +cancelRide()',
    '    }',
    '    class Driver {',
    '        +String licenseNumber',
    '        +DriverAvailability availability',
    '        +Decimal rating',
    '        +acceptRide()',
    '        +startTrip()',
    '        +completeTrip()',
    '    }',
    '    class Vehicle {',
    '        +UUID id',
    '        +String plateNumber',
    '        +String brand',
    '        +String model',
    '        +VehicleType type',
    '        +Integer year',
    '    }',
    '    class Ride {',
    '        +UUID id',
    '        +RideStatus status',
    '        +Money estimatedFare',
    '        +Money finalFare',
    '        +DateTime requestedAt',
    '        +DateTime startedAt',
    '        +DateTime completedAt',
    '    }',
    '    User <|-- Rider',
    '    User <|-- Driver',
    '    Driver --> Vehicle : uses',
    '    Rider --> Ride : requests',
    '    Driver --> Ride : fulfills',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('User');
  const metrics = await page.evaluate(() => {
    const svg = document.querySelector('#previewContent .mermaid-frame svg');
    if (!(svg instanceof SVGSVGElement)) {
      return null;
    }

    return {
      hasForeignObject: Boolean(svg.querySelector('foreignObject')),
      widthAttr: Number.parseFloat(svg.getAttribute('width') || '0'),
      heightAttr: Number.parseFloat(svg.getAttribute('height') || '0'),
    };
  });
  expect(metrics?.hasForeignObject).toBe(false);
  expect(metrics?.widthAttr ?? 0).toBeLessThan(2000);
  expect(metrics?.heightAttr ?? 0).toBeLessThan(2500);
});
