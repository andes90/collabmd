import {
  ACTIVE_MAXIMIZED_DRAWIO_SELECTOR,
  ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR,
  ACTIVE_MAXIMIZED_MERMAID_SELECTOR,
  ACTIVE_MAXIMIZED_PLANTUML_SELECTOR,
  README_TEST_DOCUMENT,
  duplicateVaultFile,
  expect,
  getMermaidZoomMetrics,
  getPlantUmlZoomMetrics,
  openFile,
  openHome,
  openSampleFull,
  replaceEditorContent,
  restoreReadmeTestDocument,
  seedStoredUserName,
  stubPlantUmlRender,
  test,
  waitForExcalidrawFrameHarness,
  waitForHeavyPreviewContent,
  writeVaultFileAndResetCollab,
} from './helpers/app-fixture.js';

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

test('debounces PlantUML WIP renders and keeps the last valid output on errors', async ({ page }) => {
  let renderRequests = 0;
  await page.route('**/api/plantuml/render', async (route) => {
    renderRequests += 1;
    const source = route.request().postDataJSON()?.source || '';
    if (source.includes('INVALID')) {
      await route.fulfill({
        body: JSON.stringify({ ok: false, error: 'Syntax error on line 4, column 8' }),
        contentType: 'application/json',
        status: 400,
      });
      return;
    }

    const label = source.includes('Fixed') ? 'plantuml-fixed' : 'plantuml-valid';
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">${label}</text></svg>`,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML WIP',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Hello',
    '@enduml',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('plantuml-valid');
  const initialRequestCount = renderRequests;

  await replaceEditorContent(page, [
    '# PlantUML WIP',
    '',
    '```plantuml',
    '@startuml',
    'INVALID',
    '@enduml',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .diagram-preview-error-card')).toContainText('needs attention');
  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('plantuml-valid');
  await expect(page.locator('#previewContent .diagram-preview-error-card details')).toContainText('line 4');
  expect(renderRequests).toBe(initialRequestCount + 1);
  await page.locator('#previewContent .diagram-preview-error-card .plantuml-placeholder-btn').click();
  await expect.poll(() => renderRequests).toBe(initialRequestCount + 2);
  await expect(page.locator('#previewContent .diagram-preview-error-card')).toContainText('needs attention');

  await replaceEditorContent(page, [
    '# PlantUML WIP',
    '',
    '```plantuml',
    '@startuml',
    'Fixed',
    '@enduml',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .diagram-preview-error-card')).toHaveCount(0);
  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('plantuml-fixed');
});

test('preserves PlantUML zoom and pan location across source edits', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    const source = route.request().postDataJSON()?.source || '';
    const label = source.includes('Updated') ? 'plantuml-updated' : 'plantuml-original';
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 4000"><text x="40" y="220">${label}</text></svg>`,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML View State',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Original',
    '@enduml',
    '```',
  ].join('\n'));

  await expect(page.locator('#previewContent .plantuml-frame')).toContainText('plantuml-original');
  const initialZoom = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await expect(page.locator('#previewContent .plantuml-zoom-label')).not.toHaveText(initialZoom || '');
  await page.waitForTimeout(250);

  const previousViewState = await page.evaluate(() => {
    const frame = document.querySelector('#previewContent .plantuml-frame');
    if (!(frame instanceof HTMLElement)) {
      return null;
    }

    frame.scrollLeft = 420;
    frame.scrollTop = 220;
    return {
      scrollLeft: frame.scrollLeft,
      scrollTop: frame.scrollTop,
      zoom: document.querySelector('#previewContent .plantuml-zoom-label')?.textContent || '',
    };
  });
  expect(previousViewState).not.toBeNull();
  expect(previousViewState.scrollLeft).toBeGreaterThan(0);
  expect(previousViewState.scrollTop).toBeGreaterThan(0);

  await page.evaluate((expectedViewState) => {
    window.__diagramPanMismatch = null;
    window.__stopDiagramPanProbe = false;
    const sampleAfterPaint = () => {
      setTimeout(() => {
        const frame = document.querySelector('#previewContent .plantuml-frame');
        if (
          !window.__diagramPanMismatch
          && frame
          && (frame.scrollLeft !== expectedViewState.scrollLeft || frame.scrollTop !== expectedViewState.scrollTop)
        ) {
          window.__diagramPanMismatch = {
            scrollLeft: frame.scrollLeft,
            scrollTop: frame.scrollTop,
          };
        }
        if (!window.__stopDiagramPanProbe) {
          requestAnimationFrame(sampleAfterPaint);
        }
      }, 0);
    };
    requestAnimationFrame(sampleAfterPaint);
  }, previousViewState);

  await replaceEditorContent(page, [
    '# PlantUML View State',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Updated',
    '@enduml',
    '```',
  ].join('\n'));

  const updatedFrames = page.locator('#previewContent .plantuml-frame');
  await expect(updatedFrames).toHaveText(['plantuml-updated']);
  const panMismatch = await page.evaluate(() => {
    window.__stopDiagramPanProbe = true;
    return window.__diagramPanMismatch;
  });
  expect(panMismatch).toBeNull();
  await expect.poll(async () => page.evaluate(() => {
    const frame = document.querySelector('#previewContent .plantuml-frame');
    return {
      scrollLeft: frame?.scrollLeft ?? 0,
      scrollTop: frame?.scrollTop ?? 0,
      zoom: document.querySelector('#previewContent .plantuml-zoom-label')?.textContent || '',
    };
  })).toEqual(previousViewState);
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

test('renders YouTube markdown image syntax as a video iframe embed', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Video Embed',
    '',
    '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
  ].join('\n'));

  const iframe = page.locator('#previewContent .video-embed-iframe').first();
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await expect(iframe).toHaveAttribute('title', 'Demo video');
  await expect(page.locator('#previewContent img')).toHaveCount(0);

  const heights = await page.evaluate(() => {
    const shell = document.querySelector('#previewContent .video-embed.is-youtube');
    const frame = document.querySelector('#previewContent .video-embed-frame-youtube');
    const embeddedIframe = document.querySelector('#previewContent .video-embed-iframe');
    if (!(shell instanceof HTMLElement) || !(frame instanceof HTMLElement) || !(embeddedIframe instanceof HTMLElement)) {
      return null;
    }

    return {
      frameHeight: Math.round(frame.getBoundingClientRect().height),
      iframeHeight: Math.round(embeddedIframe.getBoundingClientRect().height),
      shellContentHeight: Math.round(shell.clientHeight),
    };
  });
  expect(heights).not.toBeNull();
  expect(Math.abs(heights.frameHeight - heights.shellContentHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(heights.iframeHeight - heights.shellContentHeight)).toBeLessThanOrEqual(1);
});

test('renders direct public video files from markdown image syntax as native video', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Direct Video',
    '',
    '![Product demo](https://cdn.example.com/videos/demo.webm)',
  ].join('\n'));

  const video = page.locator('#previewContent .video-embed-player').first();
  const source = video.locator('source').first();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(source).toHaveAttribute('src', 'https://cdn.example.com/videos/demo.webm');
  await expect(source).toHaveAttribute('type', 'video/webm');
  await expect(page.locator('#previewContent img')).toHaveCount(0);
});

test('preserves YouTube video embed instances across unrelated preview rerenders', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Video Preserve',
    '',
    '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
  ].join('\n'));

  await expect(page.locator('#previewContent .video-embed-iframe').first()).toBeVisible();

  await page.evaluate(() => {
    const iframe = document.querySelector('#previewContent .video-embed-iframe');
    if (iframe) {
      iframe.__collabmdPreserveProbe = 'alive';
      iframe.__collabmdSrcSetCount = 0;
      const originalSetAttribute = iframe.setAttribute.bind(iframe);
      iframe.setAttribute = function patchedSetAttribute(name, value) {
        if (name === 'src') {
          this.__collabmdSrcSetCount += 1;
        }
        return originalSetAttribute(name, value);
      };
    }
  });

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .video-embed-iframe')?.__collabmdPreserveProbe || '')
  ), { timeout: 60000 }).toBe('alive');
  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .video-embed-iframe')?.__collabmdSrcSetCount ?? -1)
  ), { timeout: 60000 }).toBe(0);
});

test('preserves direct video embed instances across unrelated preview rerenders', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Direct Video Preserve',
    '',
    '![Product demo](https://cdn.example.com/videos/demo.webm)',
  ].join('\n'));

  await expect(page.locator('#previewContent .video-embed-player').first()).toBeVisible();

  await page.evaluate(() => {
    const video = document.querySelector('#previewContent .video-embed-player');
    const source = video?.querySelector('source');
    if (video) {
      video.__collabmdPreserveProbe = 'alive';
    }
    if (source) {
      source.__collabmdSrcSetCount = 0;
      const originalSetAttribute = source.setAttribute.bind(source);
      source.setAttribute = function patchedSetAttribute(name, value) {
        if (name === 'src') {
          this.__collabmdSrcSetCount += 1;
        }
        return originalSetAttribute(name, value);
      };
    }
  });

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .video-embed-player')?.__collabmdPreserveProbe || '')
  ), { timeout: 60000 }).toBe('alive');
  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .video-embed-player source')?.__collabmdSrcSetCount ?? -1)
  ), { timeout: 60000 }).toBe(0);
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
    const embed = document.querySelector('.excalidraw-embed.is-maximized[data-excalidraw-maximized="true"]');
    if (!container || !embed) {
      return null;
    }

    const rect = embed.getBoundingClientRect();
    return {
      containerWidth: container.getBoundingClientRect().width,
      embedWidth: rect.width,
      position: window.getComputedStyle(embed).position,
      left: rect.left,
      right: rect.right,
      innerWidth: window.innerWidth,
    };
  });
  expect(maximizedWidths).not.toBeNull();
  expect(maximizedWidths.position).toBe('fixed');
  expect(maximizedWidths.embedWidth).toBeGreaterThan(maximizedWidths.containerWidth - 48);
  expect(maximizedWidths.left).toBeGreaterThanOrEqual(0);
  expect(maximizedWidths.right).toBeLessThanOrEqual(maximizedWidths.innerWidth);
});

test('fits embedded excalidraw content on first load', async ({ page }) => {
  await openHome(page);
  await writeVaultFileAndResetCollab(page, {
    path: 'viewport-fit.excalidraw',
    content: JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'collabmd',
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [{
        id: 'viewport-fit',
        type: 'rectangle',
        x: 1000,
        y: 1000,
        width: 240,
        height: 160,
        angle: 0,
        strokeColor: '#1f2937',
        backgroundColor: '#f8fafc',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        index: 'a0',
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      }],
      files: {},
    }),
  });
  await writeVaultFileAndResetCollab(page, {
    path: 'viewport-fit.md',
    content: '# Viewport fit\n\n![[viewport-fit.excalidraw]]',
  });
  await page.goto('/?test=1#file=viewport-fit.md');
  await expect(page.locator('#previewContent')).toBeVisible();

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).toBeVisible();
  const frame = page.frameLocator('#previewContent .excalidraw-embed iframe');
  await expect(frame.locator('canvas')).toHaveCount(2);
  await expect(frame.getByRole('button', { name: 'Scroll back to content' })).toHaveCount(0);
});

test('opens drawio files with a maximizable direct preview', async ({ page }) => {
  await writeVaultFileAndResetCollab(page, {
    path: 'sample-drawio.drawio',
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
  });

  await openFile(page, 'sample-drawio.drawio', { waitFor: 'preview' });

  const iframe = page.locator('#previewContent .drawio-embed-iframe').first();
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', /file=sample-drawio\.drawio/);
  await expect(page.locator('#previewContent .drawio-embed-label')).toHaveText('sample-drawio');

  await page.locator('#previewContent .drawio-embed-btn[aria-label="Maximize diagram"]').click();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_DRAWIO_SELECTOR} .drawio-embed-btn[aria-label="Restore diagram size"]`)).toBeVisible();

  const maximizedBounds = await page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const embed = document.querySelector('.drawio-embed.is-maximized[data-drawio-maximized="true"]');
    if (!container || !embed) {
      return null;
    }

    const rect = embed.getBoundingClientRect();
    return {
      containerWidth: container.getBoundingClientRect().width,
      embedHeight: rect.height,
      embedWidth: rect.width,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      position: window.getComputedStyle(embed).position,
    };
  });

  expect(maximizedBounds).not.toBeNull();
  expect(maximizedBounds.position).toBe('fixed');
  expect(maximizedBounds.embedWidth).toBeGreaterThan(maximizedBounds.containerWidth - 48);
  expect(maximizedBounds.embedHeight).toBeGreaterThan(maximizedBounds.innerHeight - 220);
  expect(maximizedBounds.top).toBeGreaterThanOrEqual(0);
  expect(maximizedBounds.left).toBeGreaterThanOrEqual(0);
  expect(maximizedBounds.right).toBeLessThanOrEqual(maximizedBounds.innerWidth);
});

test('direct drawio preview ignores duplicate frame init events during resize', async ({ page }) => {
  let frameDocumentRequests = 0;
  await page.route('https://embed.diagrams.net/**', async (route) => {
    frameDocumentRequests += 1;
    await route.fulfill({
      body: `
        <!doctype html>
        <html>
          <body data-load-count="0">
            <script>
              function emit(event) {
                parent.postMessage(JSON.stringify({ event }), '*');
              }
              window.__emitDrawioInit = () => emit('init');
              window.addEventListener('message', (event) => {
                const payload = JSON.parse(event.data || '{}');
                if (payload.action === 'load') {
                  document.body.dataset.loadCount = String(Number(document.body.dataset.loadCount || '0') + 1);
                }
              });
              emit('init');
            </script>
          </body>
        </html>
      `,
      contentType: 'text/html',
      status: 200,
    });
  });

  await writeVaultFileAndResetCollab(page, {
    path: 'sample-drawio.drawio',
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
  });

  await openFile(page, 'sample-drawio.drawio', { waitFor: 'preview' });
  const iframe = page.locator('#previewContent .drawio-embed-iframe').first();
  await expect(iframe).toBeVisible();
  const initialSrc = await iframe.getAttribute('src');
  await page.evaluate(() => {
    const frame = document.querySelector('#previewContent .drawio-embed-iframe');
    if (frame) {
      frame.dataset.resizeProbe = 'alive';
    }
  });

  const getFakeDrawioFrame = () => page.frames().find((frame) => frame.url().startsWith('https://embed.diagrams.net/'));
  await expect.poll(async () => {
    const frame = getFakeDrawioFrame();
    return frame?.evaluate(() => document.body.dataset.loadCount || '0').catch(() => '0') ?? '0';
  }, { timeout: 60000 }).toBe('1');
  expect(frameDocumentRequests).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await getFakeDrawioFrame()?.evaluate(() => window.__emitDrawioInit());

  await expect.poll(async () => {
    const frame = getFakeDrawioFrame();
    return frame?.evaluate(() => document.body.dataset.loadCount || '0').catch(() => '0') ?? '0';
  }, { timeout: 60000 }).toBe('1');
  await expect(iframe).toHaveAttribute('src', initialSrc);
  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .drawio-embed-iframe')?.dataset.resizeProbe || '')
  ), { timeout: 60000 }).toBe('alive');
  await expect(page.locator('#previewContent')).not.toContainText('Loading draw.io preview…');

  await page.locator('#previewContent .drawio-embed-btn[aria-label="Maximize diagram"]').click();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_DRAWIO_SELECTOR} .drawio-embed-btn[aria-label="Restore diagram size"]`)).toBeVisible();
  await page.locator(`${ACTIVE_MAXIMIZED_DRAWIO_SELECTOR} .drawio-embed-btn[aria-label="Restore diagram size"]`).click();
  await expect(page.locator('#previewContent .drawio-embed-btn[aria-label="Maximize diagram"]')).toBeVisible();
  expect(frameDocumentRequests).toBe(1);
  await expect(iframe).toHaveAttribute('src', initialSrc);
  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .drawio-embed-iframe')?.dataset.resizeProbe || '')
  ), { timeout: 60000 }).toBe('alive');
});

test('embedded drawio uses the shared diagram preview header chrome', async ({ page }) => {
  await openHome(page);
  await writeVaultFileAndResetCollab(page, {
    path: 'sample-drawio.drawio',
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Drawio Embed',
    '',
    '![[sample-drawio.drawio]]',
  ].join('\n'));

  const embed = page.locator('#previewContent .drawio-embed').first();
  await expect(embed).toBeVisible();
  await expect(embed.locator('.drawio-embed-header .drawio-embed-icon')).toBeVisible();
  await expect(embed.locator('.drawio-embed-btn[aria-label="Edit in draw.io"]')).toBeVisible();
  await expect(embed.locator('.drawio-embed-btn').filter({ hasText: 'Open' })).toHaveCount(0);

  await page.locator('.view-btn[data-view="preview"]').click();
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

  await expect.poll(() => page.evaluate(() => {
    const preview = document.querySelector('#previewContent');
    const drawioEmbed = preview?.querySelector('.drawio-embed');
    if (!(preview instanceof HTMLElement) || !(drawioEmbed instanceof HTMLElement)) {
      return null;
    }

    const previewStyle = getComputedStyle(preview);
    const availableWidth = preview.getBoundingClientRect().width
      - Number.parseFloat(previewStyle.paddingLeft)
      - Number.parseFloat(previewStyle.paddingRight);
    return Math.abs(availableWidth - drawioEmbed.getBoundingClientRect().width);
  })).toBeLessThanOrEqual(1);
});

test('preserves embedded drawio preview instances across unrelated preview rerenders', async ({ page }) => {
  await openHome(page);
  await writeVaultFileAndResetCollab(page, {
    path: 'sample-drawio.drawio',
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Drawio Preserve',
    '',
    '![[sample-drawio.drawio]]',
  ].join('\n'));

  await expect(page.locator('#previewContent .drawio-embed').first()).toBeVisible();
  await page.evaluate(() => {
    const embed = document.querySelector('#previewContent .drawio-embed');
    if (embed) {
      embed.__collabmdPreserveProbe = 'alive';
    }
  });

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(' ');
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (
    page.evaluate(() => document.querySelector('#previewContent .drawio-embed')?.__collabmdPreserveProbe || '')
  ), { timeout: 60000 }).toBe('alive');
  await expect(page.locator('#previewContent .drawio-embed-placeholder.is-hydrated').first()).toBeAttached();
});

test('embedded drawio maximize clears inline overlay geometry', async ({ page }) => {
  await page.addInitScript(() => {
    const renderViewerFrame = (element) => {
      element.style.position = 'relative';
      element.style.overflow = 'auto';
      element.style.width = '281px';
      element.style.height = '242px';
      element.replaceChildren();
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 281 242');
      svg.style.display = 'block';
      svg.style.width = '100%';
      svg.style.height = '100%';
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '80');
      rect.setAttribute('y', '60');
      rect.setAttribute('width', '120');
      rect.setAttribute('height', '60');
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'currentColor');
      svg.appendChild(rect);
      element.appendChild(svg);
    };

    window.GraphViewer = {
      createViewerForElement: renderViewerFrame,
      processElements: () => {
        document.querySelectorAll('.mxgraph').forEach(renderViewerFrame);
      },
    };
  });

  await openHome(page);
  await writeVaultFileAndResetCollab(page, {
    path: 'sample-drawio.drawio',
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# Drawio Maximize',
    '',
    '![[sample-drawio.drawio]]',
  ].join('\n'));

  const staticPreview = page.locator('#previewContent .drawio-embed.is-static-preview').first();
  await expect(staticPreview.locator('.drawio-viewer-frame')).toBeVisible({ timeout: 60000 });
  await staticPreview.locator('.drawio-embed-btn[aria-label="Maximize diagram"]').click();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_DRAWIO_SELECTOR} .drawio-embed-btn[aria-label="Restore diagram size"]`).first()).toBeVisible();

  const bounds = await page.evaluate(() => {
    const embed = document.querySelector('.drawio-embed.is-maximized[data-drawio-maximized="true"]');
    if (!(embed instanceof HTMLElement)) {
      return null;
    }

    const rect = embed.getBoundingClientRect();
    const style = window.getComputedStyle(embed);
    return {
      height: rect.height,
      left: rect.left,
      position: style.position,
      top: rect.top,
      width: rect.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(bounds).not.toBeNull();
  expect(bounds.position).toBe('fixed');
  expect(bounds.width).toBeGreaterThan(bounds.viewportWidth - 64);
  expect(bounds.height).toBeGreaterThan(bounds.viewportHeight - 64);
  expect(bounds.left).toBeLessThanOrEqual(24);
  expect(bounds.top).toBeLessThanOrEqual(24);

  const viewerAlignment = await page.evaluate(() => {
    const shell = document.querySelector('.drawio-embed.is-maximized .drawio-viewer-shell');
    const frame = document.querySelector('.drawio-embed.is-maximized .drawio-viewer-frame');
    if (!(shell instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
      return null;
    }

    const shellRect = shell.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      deltaX: Math.abs((frameRect.left + frameRect.width / 2) - (shellRect.left + shellRect.width / 2)),
      deltaY: Math.abs((frameRect.top + frameRect.height / 2) - (shellRect.top + shellRect.height / 2)),
      frameHeight: frameRect.height,
      frameWidth: frameRect.width,
    };
  });

  expect(viewerAlignment).not.toBeNull();
  expect(viewerAlignment.frameWidth).toBeGreaterThan(0);
  expect(viewerAlignment.frameHeight).toBeGreaterThan(0);
  expect(viewerAlignment.deltaX).toBeLessThanOrEqual(4);
  expect(viewerAlignment.deltaY).toBeLessThanOrEqual(4);
});

test('markdown excalidraw embeds use preview mode with an edit button', async ({ page }) => {
  test.slow();

  await openSampleFull(page, { waitFor: 'preview' });
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  const iframe = page.locator('#previewContent .excalidraw-embed iframe').first();
  await expect(iframe).toHaveAttribute('src', /mode=preview/);
  await expect(page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').first()).toBeVisible();
  await expect.poll(async () => (
    page.evaluate(() => {
      const iframeElement = document.querySelector('#previewContent .excalidraw-embed iframe');
      const iframeDocument = iframeElement?.contentDocument;
      if (!iframeDocument || iframeDocument.body?.dataset.documentMode !== 'preview') {
        return 'loading';
      }

      const hasVisibleButton = Array.from(iframeDocument.querySelectorAll('.disable-view-mode')).some((button) => {
        if (!(button instanceof HTMLElement)) {
          return false;
        }

        const style = iframeElement.contentWindow.getComputedStyle(button);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
      return hasVisibleButton ? 'visible' : 'hidden';
    })
  ), { timeout: 60000 }).toBe('hidden');
});

test('embedded excalidraw edit button navigates to the diagram file', async ({ page }) => {
  test.slow();

  await openSampleFull(page, { waitFor: 'preview' });
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').first().click();
  await expect(page).toHaveURL(/#file=sample-excalidraw\.excalidraw/);
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toHaveAttribute('src', /file=sample-excalidraw\.excalidraw/);
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).not.toHaveAttribute('src', /mode=preview/);
});

test('embedded excalidraw maximize then edit clears the stale modal overlay', async ({ page }) => {
  test.slow();

  await openSampleFull(page);
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]').count()
  ), { timeout: 60000 }).toBeGreaterThan(0);

  await page.locator('#previewContent .excalidraw-embed-btn[aria-label="Maximize diagram"]').first().click();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} .excalidraw-embed-btn[aria-label="Restore diagram size"]`).first()).toBeVisible();

  await page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} .excalidraw-embed-btn[aria-label="Edit in Excalidraw"]`).first().click();

  await expect(page).toHaveURL(/#file=sample-excalidraw\.excalidraw/);
  await expect(page.locator('body')).not.toHaveClass(/excalidraw-maximized-open/);
  await expect(page.locator(ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR)).toHaveCount(0);
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

test('embedded excalidraw height resize preserves the iframe instance', async ({ page }) => {
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
      iframe.contentWindow.__collabmdResizeProbe = 'alive';
    }
  });

  const firstInstanceId = await page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id');
  const firstSrc = await page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('src');
  const resizerBox = await page.locator('#previewContent .excalidraw-embed-resizer').first().boundingBox();
  expect(resizerBox).not.toBeNull();

  await page.mouse.move(resizerBox.x + (resizerBox.width / 2), resizerBox.y + (resizerBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(resizerBox.x + (resizerBox.width / 2), resizerBox.y + 80, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id')
  ), { timeout: 60000 }).toBe(firstInstanceId);
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toHaveAttribute('src', firstSrc);
  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
      return iframe?.contentWindow?.__collabmdResizeProbe || '';
    })
  ), { timeout: 60000 }).toBe('alive');
  await expect(page.locator('#previewContent .excalidraw-embed.is-loading')).toHaveCount(0);
});

test('opening an embedded excalidraw file directly promotes the same iframe into editable mode', async ({ page }) => {
  test.slow();

  await stubPlantUmlRender(page, 'sample-full-plantuml');
  await seedStoredUserName(page);
  await page.goto('/?test=1#file=sample-full.md');
  await expect(page.locator('#previewContent')).toBeVisible();

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
  ), { timeout: 60000 }).toBe(firstInstanceId);

  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
      return iframe?.contentWindow?.__COLLABMD_EXCALIDRAW_TEST__?.isReady?.() || false;
    })
  ), { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
      return iframe?.contentWindow?.__COLLABMD_EXCALIDRAW_TEST__?.isViewMode?.();
    })
  ), { timeout: 60000 }).toBe(false);
});

test('switching directly between excalidraw files reuses the warm iframe instance', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#fileTree')).toBeVisible();

  await writeVaultFileAndResetCollab(page, {
    path: 'new-diagram.excalidraw',
    content: JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'collabmd',
      appState: {
        gridSize: null,
        viewBackgroundColor: '#ffffff',
      },
      elements: [{
        id: 'shape-new',
        type: 'rectangle',
        x: 32,
        y: 48,
        width: 144,
        height: 96,
        angle: 0,
        strokeColor: '#1f2937',
        backgroundColor: '#f8fafc',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        index: 'a0',
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        seed: 1,
        version: 11,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      }],
      files: {},
    }),
  });
  await page.reload();
  await expect(page.locator('#fileTree')).toContainText('new-diagram');

  await page.locator('#fileTree .file-tree-item', { hasText: 'sample-excalidraw' }).first().click();
  const firstIframe = page.locator('#previewContent .excalidraw-embed[data-file="sample-excalidraw.excalidraw"] iframe').first();
  await expect(firstIframe).toBeVisible();
  const firstInstanceId = await firstIframe.getAttribute('data-instance-id');

  await page.locator('#fileTree .file-tree-item', { hasText: 'new-diagram' }).first().click();
  const secondIframe = page.locator('#previewContent .excalidraw-embed[data-file="new-diagram.excalidraw"] iframe').first();
  await expect(secondIframe).toBeVisible();
  await expect.poll(async () => (
    page.locator('#previewContent .excalidraw-embed[data-file="new-diagram.excalidraw"] iframe').first().getAttribute('data-instance-id')
  ), { timeout: 60000 }).toBe(firstInstanceId);
  await expect(page.locator('#previewContent')).not.toContainText('Loading Excalidraw preview…');
});

test('switching directly between excalidraw files updates the reused iframe scene', async ({ page }) => {
  await writeVaultFileAndResetCollab(page, {
    path: 'new-diagram.excalidraw',
    content: JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'collabmd',
      appState: {
        gridSize: null,
        viewBackgroundColor: '#ffffff',
      },
      elements: [{
        id: 'shape-new',
        type: 'rectangle',
        x: 32,
        y: 48,
        width: 144,
        height: 96,
        angle: 0,
        strokeColor: '#1f2937',
        backgroundColor: '#f8fafc',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        index: 'a0',
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        seed: 1,
        version: 11,
        versionNonce: 1,
        isDeleted: false,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
      }],
      files: {},
    }),
  });

  const writtenDiagram = await page.request.get('/api/file?path=new-diagram.excalidraw');
  expect(writtenDiagram.ok()).toBe(true);
  expect(await writtenDiagram.text()).toContain('shape-new');

  await seedStoredUserName(page);
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');
  await expect.poll(async () => {
    try {
      const frame = await waitForExcalidrawFrameHarness(page);
      return frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds());
    } catch {
      return null;
    }
  }, { timeout: 60000 }).toEqual([]);

  await expect(page.locator('#fileTree')).toContainText('new-diagram');
  await page.locator('#fileTree .file-tree-item', { hasText: 'new-diagram' }).first().click();

  await expect.poll(async () => {
    try {
      const frame = await waitForExcalidrawFrameHarness(page);
      return frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds());
    } catch {
      return null;
    }
  }, { timeout: 60000 }).toEqual(['shape-new']);
});

test('switching away from a direct excalidraw preview hides stale iframe overlays immediately', async ({ page }) => {
  const switchMarkdownPath = 'switch-readme.md';

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

  await restoreReadmeTestDocument(page);
  await writeVaultFileAndResetCollab(page, {
    content: README_TEST_DOCUMENT,
    path: switchMarkdownPath,
  });
  await page.reload();
  await expect(page.locator('#fileTree')).toContainText('switch-readme');

  await page.locator('#fileTree .file-tree-item', { hasText: 'switch-readme' }).first().click();
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

  await page.evaluate(() => {
    const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.__collabmdMaximizeProbe = 'alive';
    }
  });
  const firstInstanceId = await page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('data-instance-id');
  const firstSrc = await page.locator('#previewContent .excalidraw-embed iframe').first().getAttribute('src');

  await page.locator('#previewContent .excalidraw-embed-btn[aria-label="Maximize diagram"]').first().click();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} .excalidraw-embed-btn[aria-label="Restore diagram size"]`).first()).toBeVisible();
  await expect(page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} iframe`).first()).toHaveAttribute('data-instance-id', firstInstanceId);
  await expect(page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} iframe`).first()).toHaveAttribute('src', firstSrc);
  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('.excalidraw-embed.is-maximized[data-excalidraw-maximized="true"] iframe');
      return iframe?.contentWindow?.__collabmdMaximizeProbe || '';
    })
  ), { timeout: 60000 }).toBe('alive');

  const afterMaximize = await page.evaluate(() => {
    const embed = document.querySelector('.excalidraw-embed.is-maximized[data-excalidraw-maximized="true"]');
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

  await page.locator(`${ACTIVE_MAXIMIZED_EXCALIDRAW_SELECTOR} .excalidraw-embed-btn[aria-label="Restore diagram size"]`).first().click();
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toHaveAttribute('data-instance-id', firstInstanceId);
  await expect(page.locator('#previewContent .excalidraw-embed iframe').first()).toHaveAttribute('src', firstSrc);
  await expect.poll(async () => (
    page.evaluate(() => {
      const iframe = document.querySelector('#previewContent .excalidraw-embed iframe');
      return iframe?.contentWindow?.__collabmdMaximizeProbe || '';
    })
  ), { timeout: 60000 }).toBe('alive');
});

test('embedded excalidraw matches mermaid width in preview-only view', async ({ page }) => {
  test.slow();

  await openSampleFull(page, { waitFor: 'preview' });
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
  await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Copy image"]')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Download SVG"]')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-tool-btn[aria-label="Reload diagram"]')).toBeVisible();
  const frameLayout = await page.evaluate(() => {
    const content = document.querySelector('#previewContent');
    const frame = content?.querySelector('.plantuml-frame');
    if (!content || !frame) {
      return null;
    }

    return {
      bottomGap: Math.round(content.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom),
      maxHeight: getComputedStyle(frame).maxHeight,
    };
  });
  expect(frameLayout).not.toBeNull();
  expect(frameLayout.bottomGap).toBeLessThanOrEqual(16);
  expect(frameLayout.maxHeight).toBe('none');
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await expect(page.locator('#previewContent .plantuml-zoom-label')).toHaveText('110%');
  await expect(page.locator('#outlineToggle')).toHaveClass(/hidden/);
  await expect(page.locator('#backlinksPanel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#backlinksPanel .backlinks-count')).toHaveText('1');
});

test('preserves manual standalone PlantUML zoom after preview layout sync runs', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 400"><text x="40" y="220">manual-standalone-puml</text></svg>',
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

  const initialLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await expect(page.locator('#previewContent .plantuml-zoom-label')).not.toHaveText(initialLabel || '');
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

test('renders Mermaid sequence blank lines without changing the saved source', async ({ page }) => {
  const source = [
    'sequenceDiagram',
    'actor Mobile',
    'participant LoanApp',
    'Mobile->>LoanApp: Prepare<br/>',
    'Note right of LoanApp: TBA<br/><br/>Callback from Loan application',
  ].join('\n');
  await writeVaultFileAndResetCollab(page, { path: 'sample-mermaid.mmd', content: source });
  await openFile(page, 'sample-mermaid.mmd');
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('Callback from Loan application');
  await expect(page.locator('#previewContent .diagram-preview-error-card')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Download SVG"]').click();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk);
  }
  expect(Buffer.concat(chunks).toString('utf8')).toContain('Callback from Loan application');

  await openFile(page, 'README.md');
  await replaceEditorContent(page, `# Sequence\n\n\`\`\`mermaid\n${source}\n\`\`\``);
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-frame')).toContainText('Callback from Loan application');

  const response = await page.request.get('/api/file?path=sample-mermaid.mmd');
  expect(response.ok()).toBe(true);
  expect((await response.json()).content).toBe(source);
});

test('opens .mmd files with side-by-side Mermaid preview', async ({ page }) => {
  await openFile(page, 'sample-mermaid.mmd');

  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'split');
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-zoom-btn[aria-label="Copy image"]')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-zoom-btn[aria-label="Download SVG"]')).toBeVisible();
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
  await expect(page.locator(`${ACTIVE_MAXIMIZED_MERMAID_SELECTOR} .mermaid-maximize-btn[aria-label="Restore diagram size"]`)).toBeVisible();

  const maximizedBounds = await page.evaluate(() => {
    const shell = document.querySelector('[data-mermaid-maximized-root="true"] .mermaid-shell.is-maximized');
    const restoreButton = document.querySelector('[data-mermaid-maximized-root="true"] .mermaid-maximize-btn[aria-label="Restore diagram size"]');
    if (!(shell instanceof HTMLElement)) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    const restoreRect = restoreButton?.getBoundingClientRect();
    const probeX = restoreRect ? Math.round(restoreRect.left + (restoreRect.width / 2)) : null;
    const probeY = restoreRect ? Math.round(restoreRect.top + (restoreRect.height / 2)) : null;
    const topElement = probeX === null || probeY === null ? null : document.elementFromPoint(probeX, probeY);
    return {
      hitRestoreButton: Boolean(topElement?.closest('.mermaid-maximize-btn[aria-label="Restore diagram size"]')),
      left: rect.left,
      position: window.getComputedStyle(shell).position,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });

  expect(maximizedBounds).not.toBeNull();
  expect(maximizedBounds.hitRestoreButton).toBeTruthy();
  expect(maximizedBounds.position).toBe('fixed');
  expect(maximizedBounds.left).toBeGreaterThanOrEqual(0);
  expect(maximizedBounds.right).toBeLessThanOrEqual(maximizedBounds.viewportWidth);

  await page.locator(`${ACTIVE_MAXIMIZED_MERMAID_SELECTOR} .mermaid-maximize-btn[aria-label="Restore diagram size"]`).click();
  await expect(page.locator(ACTIVE_MAXIMIZED_MERMAID_SELECTOR)).toHaveCount(0);
  await expect(page.locator('#previewContent .mermaid-maximize-btn[aria-label="Maximize diagram"]')).toBeVisible();
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
  await expect(page.locator('#previewContent .mermaid-shell[data-mermaid-target="sample-mermaid.mmd"] .mermaid-zoom-btn[aria-label="Copy image"]')).toBeVisible();
  await expect(page.locator('#previewContent .mermaid-shell[data-mermaid-target="sample-mermaid.mmd"] .mermaid-zoom-btn[aria-label="Download SVG"]')).toBeVisible();
});

test('renders embedded PlantUML previews with copy and download actions', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">plantuml-actions</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML Embed',
    '',
    '![[sample-plantuml.puml|Embedded sequence]]',
  ].join('\n'));

  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-shell[data-plantuml-target="sample-plantuml.puml"] .plantuml-tool-btn[aria-label="Copy image"]')).toBeVisible();
  await expect(page.locator('#previewContent .plantuml-shell[data-plantuml-target="sample-plantuml.puml"] .plantuml-tool-btn[aria-label="Download SVG"]')).toBeVisible();
});

test('preserves manual embedded PlantUML zoom after preview layout sync runs', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 400"><text x="40" y="220">manual-embedded-puml</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'README.md');
  await replaceEditorContent(page, [
    '# PlantUML Embed',
    '',
    '![[sample-plantuml.puml|Embedded sequence]]',
  ].join('\n'));

  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();
  await expect.poll(async () => {
    const metrics = await getPlantUmlZoomMetrics(page);
    return metrics ? metrics.currentLabel === metrics.expectedLabel : false;
  }).toBeTruthy();

  const initialLabel = await page.locator('#previewContent .plantuml-zoom-label').textContent();
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Zoom in"]').click();
  await expect(page.locator('#previewContent .plantuml-zoom-label')).not.toHaveText(initialLabel || '');
});

test('downloads standalone Mermaid previews as SVG with the diagram file name', async ({ page }) => {
  await openFile(page, 'sample-mermaid.mmd');
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Download SVG"]').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('sample-mermaid.svg');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const svgMarkup = Buffer.concat(chunks).toString('utf8');
  expect(svgMarkup).toContain('Start');
  expect(svgMarkup).toContain('Review');
  expect(svgMarkup).toContain('Ship');
  expect(svgMarkup).not.toContain('foreignObject');
});

test('PlantUML standalone download saves SVG with the diagram file name', async ({ page }) => {
  await page.route('**/api/plantuml/render', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 48"><text x="8" y="28">standalone-puml-download</text></svg>',
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await openFile(page, 'sample-plantuml.puml');
  await expect(page.locator('#previewContent .plantuml-frame svg')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#previewContent .plantuml-tool-btn[aria-label="Download SVG"]').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('sample-plantuml.svg');
});

test('copies standalone Mermaid previews as PNG when image clipboard write succeeds', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFile(page, 'sample-mermaid.mmd');
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();

  await page.evaluate(() => {
    window.__diagramClipboardWrites = [];
    if (typeof ClipboardItem !== 'function') {
      window.ClipboardItem = class ClipboardItem {
        constructor(payload) {
          this.types = Object.keys(payload || {});
        }
      };
    }

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        ...(navigator.clipboard || {}),
        async write(items) {
          window.__diagramClipboardWrites.push(items.map((item) => Array.from(item.types || [])));
        },
      },
    });
  });

  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Copy image"]').click();

  await expect.poll(async () => (
    page.evaluate(() => window.__diagramClipboardWrites?.[0]?.[0]?.[0] || '')
  )).toBe('image/png');
  await expect(page.locator('#toastContainer')).toContainText('Diagram copied');
});

test('falls back to a PNG download when image clipboard write is unavailable', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFile(page, 'sample-mermaid.mmd');
  await expect(page.locator('#previewContent .mermaid-frame svg')).toBeVisible();

  await page.evaluate(() => {
    if (typeof ClipboardItem !== 'function') {
      window.ClipboardItem = class ClipboardItem {
        constructor(payload) {
          this.types = Object.keys(payload || {});
        }
      };
    }

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        ...(navigator.clipboard || {}),
        async write() {
          throw new Error('Clipboard blocked');
        },
      },
    });
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#previewContent .mermaid-zoom-btn[aria-label="Copy image"]').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('sample-mermaid.png');
  await expect(page.locator('#toastContainer')).toContainText('Clipboard image copy is unavailable here. Downloaded PNG instead.');
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
