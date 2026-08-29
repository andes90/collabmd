import {
  createComment,
  createLongMarkdownDocument,
  clearReadmeCollaborationSidecars,
  dragEditorSelection,
  expect,
  README_TEST_DOCUMENT,
  openChat,
  openFile,
  replaceEditorContent,
  restoreReadmeTestDocument,
  restoreVaultFileFromTemplate,
  setEditorSelection,
  seedStoredUserName,
  sendChatMessage,
  stubPlantUmlRender,
  test,
  waitForCommentSelectionChip,
  waitForExcalidrawFrameHarness,
  waitForExcalidrawTestHarness,
  writeVaultFileAndResetCollab,
} from './helpers/app-fixture.js';

function createSeededMultiplayerScene() {
  const timestamp = 1_710_000_000_000;

  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    appState: {
      gridSize: 20,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
    elements: [
      {
        id: 'table-shell',
        type: 'rectangle',
        x: 160,
        y: 120,
        width: 420,
        height: 220,
        angle: 0,
        strokeColor: '#1f2937',
        backgroundColor: '#f8fafc',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: { type: 3 },
        roughness: 0,
        opacity: 100,
        seed: 101,
        version: 11,
        versionNonce: 1001,
        index: 'a0',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-1',
        type: 'line',
        x: 300,
        y: 120,
        width: 0,
        height: 220,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 102,
        version: 11,
        versionNonce: 1002,
        index: 'a1',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [0, 220]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-2',
        type: 'line',
        x: 440,
        y: 120,
        width: 0,
        height: 220,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 103,
        version: 11,
        versionNonce: 1003,
        index: 'a2',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [0, 220]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-3',
        type: 'line',
        x: 160,
        y: 193,
        width: 420,
        height: 0,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 104,
        version: 11,
        versionNonce: 1004,
        index: 'a3',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [420, 0]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-divider-4',
        type: 'line',
        x: 160,
        y: 266,
        width: 420,
        height: 0,
        angle: 0,
        strokeColor: '#94a3b8',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 105,
        version: 11,
        versionNonce: 1005,
        index: 'a4',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        points: [[0, 0], [420, 0]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
      {
        id: 'table-note',
        type: 'text',
        x: 205,
        y: 145,
        width: 154.078125,
        height: 25,
        angle: 0,
        strokeColor: '#0f172a',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 106,
        version: 11,
        versionNonce: 1006,
        index: 'a5',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
        fontSize: 20,
        fontFamily: 1,
        text: 'Quarterly pipeline',
        textAlign: 'left',
        verticalAlign: 'top',
        containerId: null,
        originalText: 'Quarterly pipeline',
        autoResize: true,
        lineHeight: 1.25,
      },
      {
        id: 'status-pill',
        type: 'ellipse',
        x: 640,
        y: 175,
        width: 84,
        height: 84,
        angle: 0,
        strokeColor: '#2563eb',
        backgroundColor: '#bfdbfe',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 107,
        version: 11,
        versionNonce: 1007,
        index: 'a6',
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: timestamp,
        link: null,
        locked: false,
      },
    ],
  };
}

function createEmptyExcalidrawScene() {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
    elements: [],
  };
}

function createImageScene() {
  const timestamp = 1_710_000_100_000;
  const fileId = 'remote-image-file';

  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    appState: {
      gridSize: 20,
      viewBackgroundColor: '#ffffff',
    },
    files: {
      [fileId]: {
        id: fileId,
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zt9kAAAAASUVORK5CYII=',
        created: timestamp,
        lastRetrieved: timestamp,
        version: 1,
      },
    },
    elements: [{
      id: 'remote-image-element',
      type: 'image',
      x: 120,
      y: 80,
      width: 96,
      height: 96,
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roundness: null,
      roughness: 0,
      opacity: 100,
      seed: 2001,
      version: 2,
      versionNonce: 2002,
      index: 'a0',
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: timestamp,
      link: null,
      locked: false,
      fileId,
      status: 'saved',
      scale: [1, 1],
      crop: null,
    }],
  };
}

async function hoverPreviewQuotedText(page, quote) {
  const rect = await page.evaluate((targetQuote) => {
    const root = document.getElementById('previewContent');
    if (!root) {
      return null;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent || '';
      const start = text.indexOf(targetQuote);
      if (start < 0) {
        continue;
      }

      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + targetQuote.length);
      const rects = Array.from(range.getClientRects());
      const firstRect = rects[0];
      if (!firstRect) {
        continue;
      }

      return {
        x: firstRect.left + Math.min(firstRect.width / 2, 12),
        y: firstRect.top + Math.max(firstRect.height / 2, 4),
      };
    }

    return null;
  }, quote);

  expect(rect).toBeTruthy();
  await page.mouse.move(rect.x, rect.y);
}

async function seedExcalidrawMultiplayerScene(page) {
  const scene = createSeededMultiplayerScene();
  await page.evaluate((nextScene) => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(nextScene);
  }, scene);
  return scene;
}

async function prepareExcalidrawTestFile(page, filePath) {
  await writeVaultFileAndResetCollab(page, {
    path: filePath,
    content: JSON.stringify(createEmptyExcalidrawScene()),
  });
}

async function getSceneElementIds(page) {
  return page.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds());
}

async function waitForExcalidrawSceneFrame(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function waitForExcalidrawBackground(page, expectedColor) {
  await expect.poll(async () => (
    page.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe(expectedColor);
}

async function waitForExcalidrawAuthoritativeReady(page) {
  await expect.poll(async () => (
    page.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.isAuthoritativeReady())
  ), { timeout: 15000 }).toBe(true);
}

async function waitForExcalidrawElementIds(page, expectedIds) {
  await expect.poll(async () => getSceneElementIds(page)).toEqual(expectedIds);
}

async function waitForExcalidrawHistoryState(page, key, expectedValue) {
  await expect.poll(async () => (
    page.evaluate((stateKey) => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState()[stateKey], key)
  )).toBe(expectedValue);
}

async function getSceneElementCount(page) {
  return page.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementCount());
}

async function getViewportElementCenter(page, elementId) {
  const center = await page.evaluate((id) => {
    const bounds = window.__COLLABMD_EXCALIDRAW_TEST__.getElementBounds(id);
    if (!bounds) {
      return null;
    }

    const viewport = window.__COLLABMD_EXCALIDRAW_TEST__.getViewport() || {};
    const zoom = Number(viewport.zoom) > 0 ? Number(viewport.zoom) : 1;
    const sceneX = bounds.centerX ?? (bounds.x + (bounds.width / 2));
    const sceneY = bounds.centerY ?? (bounds.y + (bounds.height / 2));

    return {
      sceneX,
      sceneY,
      viewportX: (sceneX * zoom) + Number(viewport.scrollX || 0),
      viewportY: (sceneY * zoom) + Number(viewport.scrollY || 0),
      zoom,
    };
  }, elementId);

  if (!center) {
    throw new Error(`Missing bounds for element ${elementId}`);
  }

  return center;
}

async function readExcalidrawFile(page, filePath) {
  return page.evaluate(async (path) => {
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      throw new Error(`Failed to read ${path}`);
    }

    return response.json();
  }, filePath);
}

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

  await replaceEditorContent(pageB, '# Takeover Owner\n\nOnly once.\n');

  await context.close();

  const verifyContext = await browser.newContext();
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto('/');
  await expect.poll(async () => {
    const fileData = await verifyPage.evaluate(async () => {
      const response = await fetch('/api/file?path=README.md');
      return response.json();
    });
    return fileData.content;
  }).toBe('# Takeover Owner\n\nOnly once.\n');

  await verifyContext.close();
});

test('direct Excalidraw fallback does not wipe live room state from another page', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#123456',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await pageA.waitForTimeout(150);

  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&syncTimeoutMs=0');
  await waitForExcalidrawTestHarness(pageB);

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#123456');

  await context.close();
});

test('direct Excalidraw collaboration registers binary files before applying remote image elements', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);
  await waitForExcalidrawAuthoritativeReady(pageA);
  await waitForExcalidrawAuthoritativeReady(pageB);

  const imageScene = createImageScene();

  await pageA.evaluate((scene) => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  }, imageScene);

  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementIds())
  )).toContain('remote-image-element');
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getFileIds())
  )).toContain('remote-image-file');
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getElementStatus('remote-image-element'))
  )).toBe('saved');

  await context.close();
});

test('direct Excalidraw follow tracks remote viewport updates', async ({ browser }) => {
  const context = await browser.newContext();
  const followerPage = await context.newPage();
  const targetPage = await context.newPage();

  await followerPage.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&userName=Follower');
  await targetPage.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1&userName=Target');
  await waitForExcalidrawTestHarness(followerPage);
  await waitForExcalidrawTestHarness(targetPage);

  const targetPeerId = await targetPage.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalPeerId());

  await followerPage.evaluate((peerId) => {
    window.postMessage({
      source: 'collabmd-host',
      type: 'follow-user',
      peerId,
    }, window.location.origin);
  }, targetPeerId);

  await targetPage.evaluate(() => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setViewport({
      scrollX: 640,
      scrollY: 320,
      zoom: 1.6,
    });
  });

  await expect.poll(async () => (
    followerPage.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getViewport())
  )).toMatchObject({
    scrollX: 640,
    scrollY: 320,
    zoom: 1.6,
  });

  await context.close();
});

test('taking over an Excalidraw file tab preserves the live scene', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await seedStoredUserName(pageA);
  await seedStoredUserName(pageB);

  await pageA.goto('/?test=1#file=sample-excalidraw.excalidraw');
  const frameA = await waitForExcalidrawFrameHarness(pageA);
  await expect.poll(async () => (
    frameA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.isAuthoritativeReady())
  )).toBe(true);

  await frameA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#345678',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await expect.poll(async () => (
    frameA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#345678');

  await pageB.goto('/?test=1#file=sample-excalidraw.excalidraw');
  await expect(pageB.locator('#tabLockOverlay')).toBeVisible();
  await pageB.locator('#tabLockTakeoverBtn').click();

  await expect(pageB.locator('#tabLockOverlay')).toBeHidden();
  await expect(pageA.locator('#tabLockOverlay')).toBeVisible();

  const frameB = await waitForExcalidrawFrameHarness(pageB);
  await expect.poll(async () => (
    frameB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#345678');

  await context.close();
});

test('local Excalidraw undo and redo sync the resulting scene to collaborators', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = 'history-undo-redo.e2e.excalidraw';

  await prepareExcalidrawTestFile(pageA, filePath);

  await pageA.goto(`/excalidraw-editor.html?file=${encodeURIComponent(filePath)}&test=1`);
  await pageB.goto(`/excalidraw-editor.html?file=${encodeURIComponent(filePath)}&test=1`);
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#111111',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await waitForExcalidrawSceneFrame(pageA);
  await waitForExcalidrawBackground(pageA, '#111111');
  await waitForExcalidrawBackground(pageB, '#111111');
  await waitForExcalidrawSceneFrame(pageB);
  await waitForExcalidrawAuthoritativeReady(pageB);
  await waitForExcalidrawHistoryState(pageA, 'canUndo', true);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#222222',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await waitForExcalidrawSceneFrame(pageA);
  await waitForExcalidrawBackground(pageA, '#222222');
  await waitForExcalidrawBackground(pageB, '#222222');

  await waitForExcalidrawHistoryState(pageA, 'canUndo', true);
  await waitForExcalidrawHistoryState(pageB, 'canUndo', false);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await waitForExcalidrawBackground(pageA, '#111111');
  await waitForExcalidrawBackground(pageB, '#111111');
  await waitForExcalidrawHistoryState(pageA, 'canRedo', true);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());

  await waitForExcalidrawBackground(pageA, '#222222');
  await waitForExcalidrawBackground(pageB, '#222222');

  await context.close();
});

test('local Excalidraw redo is dropped after local undo followed by a new local edit', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const filePath = 'history-drop-redo.e2e.excalidraw';

  await prepareExcalidrawTestFile(pageA, filePath);

  await pageA.goto(`/excalidraw-editor.html?file=${encodeURIComponent(filePath)}&test=1`);
  await pageB.goto(`/excalidraw-editor.html?file=${encodeURIComponent(filePath)}&test=1`);
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);
  await waitForExcalidrawAuthoritativeReady(pageA);
  await waitForExcalidrawAuthoritativeReady(pageB);

  await pageA.evaluate(() => {
    const base = {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [{
        id: 'shape-1',
        isDeleted: false,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
      }],
      files: {},
      source: 'collabmd',
      type: 'excalidraw',
      version: 2,
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(base);
  });

  await waitForExcalidrawSceneFrame(pageA);
  await waitForExcalidrawElementIds(pageA, ['shape-1']);
  await waitForExcalidrawElementIds(pageB, ['shape-1']);
  await waitForExcalidrawSceneFrame(pageB);
  await waitForExcalidrawAuthoritativeReady(pageB);

  await pageA.evaluate(() => {
    const base = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    const withSecondShape = {
      ...base,
      elements: [
        ...base.elements,
        {
          id: 'shape-2',
          isDeleted: false,
          type: 'ellipse',
          x: 180,
          y: 0,
          width: 100,
          height: 80,
        },
      ],
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(withSecondShape);
  });

  await waitForExcalidrawSceneFrame(pageA);
  await waitForExcalidrawElementIds(pageA, ['shape-1', 'shape-2']);
  await waitForExcalidrawElementIds(pageB, ['shape-1', 'shape-2']);
  await waitForExcalidrawSceneFrame(pageB);
  await waitForExcalidrawAuthoritativeReady(pageB);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await waitForExcalidrawElementIds(pageA, ['shape-1']);
  await waitForExcalidrawElementIds(pageB, ['shape-1']);

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.elements = [
      ...(scene.elements || []),
      {
        id: 'shape-3',
        isDeleted: false,
        type: 'diamond',
        x: 320,
        y: 0,
        width: 100,
        height: 80,
      },
    ];
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await waitForExcalidrawSceneFrame(pageA);
  await waitForExcalidrawElementIds(pageA, ['shape-1', 'shape-3']);
  await waitForExcalidrawElementIds(pageB, ['shape-1', 'shape-3']);
  await waitForExcalidrawHistoryState(pageA, 'canRedo', false);
  await waitForExcalidrawHistoryState(pageB, 'canUndo', false);

  await pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());

  await waitForExcalidrawElementIds(pageA, ['shape-1', 'shape-3']);

  await context.close();
});

test('local Excalidraw history resets after the room fully closes', async ({ browser }) => {
  const editContext = await browser.newContext();
  const pageA = await editContext.newPage();
  const pageB = await editContext.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);

  await pageA.evaluate(() => {
    const first = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    first.appState = {
      ...(first.appState || {}),
      viewBackgroundColor: '#111111',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(first);

    const second = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    second.appState = {
      ...(second.appState || {}),
      viewBackgroundColor: '#222222',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(second);
  });

  await expect.poll(async () => (
    pageA.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(true);
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(false);

  await editContext.close();

  const reopenContext = await browser.newContext();
  const pageC = await reopenContext.newPage();

  await pageC.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageC);

  await expect.poll(async () => (
    pageC.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');
  await expect.poll(async () => (
    pageC.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState())
  )).toEqual({
    canRedo: false,
    canUndo: false,
    head: null,
    length: null,
  });

  await pageC.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageC.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await reopenContext.close();
});

test('keeps multiplayer Excalidraw scenes stable while one user drags and another user edits', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const expectedIds = [
    'table-shell',
    'table-divider-1',
    'table-divider-2',
    'table-divider-3',
    'table-divider-4',
    'table-note',
    'status-pill',
  ].sort();

  await restoreVaultFileFromTemplate(pageA, 'sample-excalidraw.excalidraw');
  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await waitForExcalidrawTestHarness(pageA);
  await waitForExcalidrawTestHarness(pageB);
  await expect.poll(async () => ({
    idsA: await getSceneElementIds(pageA),
    idsB: await getSceneElementIds(pageB),
  })).toEqual({
    idsA: [],
    idsB: [],
  });

  await seedExcalidrawMultiplayerScene(pageA);

  await expect.poll(async () => getSceneElementIds(pageB)).toEqual(expectedIds);
  await expect.poll(async () => getSceneElementCount(pageA)).toBe(expectedIds.length);
  await expect.poll(async () => getSceneElementCount(pageB)).toBe(expectedIds.length);

  const dragStart = await getViewportElementCenter(pageA, 'table-shell');
  await pageA.mouse.move(dragStart.viewportX, dragStart.viewportY);
  await pageA.mouse.down();
  await pageA.mouse.move(dragStart.viewportX + 160, dragStart.viewportY + 90, { steps: 8 });

  await pageB.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#dbeafe',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => ({
    countA: await getSceneElementCount(pageA),
    countB: await getSceneElementCount(pageB),
    idsA: await getSceneElementIds(pageA),
    idsB: await getSceneElementIds(pageB),
  })).toEqual({
    countA: expectedIds.length,
    countB: expectedIds.length,
    idsA: expectedIds,
    idsB: expectedIds,
  });

  await pageA.mouse.up();

  await expect.poll(async () => {
    const [centerA, centerB] = await Promise.all([
      getViewportElementCenter(pageA, 'table-shell'),
      getViewportElementCenter(pageB, 'table-shell'),
    ]);
    const minimumSceneDeltaX = 80 / dragStart.zoom;
    const minimumSceneDeltaY = 40 / dragStart.zoom;

    return {
      movedOnA: centerA.sceneX > dragStart.sceneX + minimumSceneDeltaX
        && centerA.sceneY > dragStart.sceneY + minimumSceneDeltaY,
      movedOnB: centerB.sceneX > dragStart.sceneX + minimumSceneDeltaX
        && centerB.sceneY > dragStart.sceneY + minimumSceneDeltaY,
    };
  }).toEqual({
    movedOnA: true,
    movedOnB: true,
  });

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#dbeafe');

  await expect.poll(async () => (
    (await readExcalidrawFile(pageA, 'sample-excalidraw.excalidraw')).content
  )).toContain('table-shell');
  const persistedScene = JSON.parse((await readExcalidrawFile(pageA, 'sample-excalidraw.excalidraw')).content);
  expect(persistedScene.elements.map((element) => element.id).sort()).toEqual(expectedIds);

  await context.close();
});

test('renaming in the app updates the mounted Excalidraw iframe user name', async ({ page }) => {
  await seedStoredUserName(page, 'Before Name');
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  const frame = await waitForExcalidrawFrameHarness(page, '#previewContent .excalidraw-embed iframe');
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('Before Name');

  await expect(page.locator('#toolbarOverflowToggle')).toBeVisible();
  await page.locator('#toolbarOverflowToggle').click();
  await expect(page.locator('#editNameBtn')).toBeVisible();
  await page.locator('#editNameBtn').click();
  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await page.locator('#displayNameInput').fill('After Name');
  await page.locator('#displayNameSubmit').click();

  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('After Name');
});

test('shows Excalidraw comments in the workspace overview and opens the selected thread', async ({ page }) => {
  await prepareExcalidrawTestFile(page, 'sample-excalidraw.excalidraw');
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  const frame = await waitForExcalidrawFrameHarness(page);
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.isAuthoritativeReady())
  )).toBe(true);

  await frame.evaluate((scene) => {
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  }, createSeededMultiplayerScene());
  await frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.selectElement('table-shell'));
  await frame.getByTestId('diagram-comments-toggle').click();
  await frame.getByTestId('diagram-add-comment').click();
  await frame.locator('textarea[aria-label="Comment"]').fill('Review this diagram');
  await frame.getByRole('button', { name: 'Post comment' }).click();

  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getCommentThreads().length)
  )).toBe(1);
  await expect.poll(async () => {
    const response = await page.request.get('/api/comments/overview');
    const payload = await response.json();
    return payload?.overview?.totalThreadCount ?? payload?.totalThreadCount ?? 0;
  }).toBe(1);

  await frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.setViewport({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
  }));
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getViewport()?.zoom)
  )).toBe(1);

  await page.locator('#commentsSidebarTab').click();
  const overviewRow = page.locator('.comment-overview-thread');
  await expect(overviewRow).toContainText('Review this diagram');
  await expect(overviewRow).toContainText('Diagram element');
  await overviewRow.click();

  await expect(frame.getByTestId('diagram-comments-drawer')).toBeVisible();
  await expect(frame.getByTestId('diagram-comments-drawer')).toContainText('Review this diagram');
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getViewport()?.zoom)
  )).toBeGreaterThan(1);
});

test('renders comment controls for text files', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await expect(page.locator('#commentsToggle')).toBeVisible();
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
});

test('uses a flat blended hover surface for comment overview rows', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await createComment(page, {
    body: 'Check the overview hover treatment.',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('#commentsSidebarTab').click();
  const overviewRow = page.locator('.comment-overview-thread');
  await expect(overviewRow).toBeVisible();
  await overviewRow.hover();

  const hoverStyle = await overviewRow.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
    };
  });

  expect(hoverStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(hoverStyle.backgroundImage).toBe('none');
  expect(hoverStyle.boxShadow).toBe('none');
});

test('reveals a stable inline chip only after selection commit', async ({ page }) => {
  await openFile(page, 'README.md');

  await setEditorSelection(page, 'Welcome to the test vault');
  const chip = await waitForCommentSelectionChip(page);
  const firstBox = await chip.boundingBox();

  await setEditorSelection(page, 'Welcome to the test vault. This is the top-level readme.');
  const updatedChip = await waitForCommentSelectionChip(page);
  const secondBox = await updatedChip.boundingBox();

  expect(firstBox?.x).toBeTruthy();
  expect(secondBox?.x).toBeTruthy();
  expect(Math.abs((firstBox?.x ?? 0) - (secondBox?.x ?? 0))).toBeLessThanOrEqual(1);

  await setEditorSelection(page, 'Welcome to the test vault', { collapse: true });
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
});

test('focuses the comment textbox when opening the composer', async ({ page }) => {
  await openFile(page, 'README.md');

  await setEditorSelection(page, 'Welcome to the test vault');
  await (await waitForCommentSelectionChip(page)).click();
  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.comment-card-input')).toBeFocused();
  const composerStyle = await page.locator('.comment-card-input').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      paddingTop: Number.parseFloat(style.paddingTop),
    };
  });
  expect(composerStyle.paddingTop).toBeGreaterThanOrEqual(8);
  expect(composerStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-focused/);
  await page.keyboard.type('inline');
  await expect(page.locator('.comment-card-input')).toHaveValue('inline');
  await expect(page.locator('.cm-content')).not.toContainText('inline');
  await page.locator('.comment-card').getByRole('button', { name: 'Cancel' }).click();

  await setEditorSelection(page, 'Welcome to the test vault. This is the top-level readme.', { collapse: true });
  await page.locator('#commentSelectionBtn').click();
  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.comment-card-input')).toBeFocused();
  await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-focused/);
  await page.keyboard.type('toolbar');
  await expect(page.locator('.comment-card-input')).toHaveValue('toolbar');
  await expect(page.locator('.cm-content')).not.toContainText('toolbar');
});

test('typing immediately after opening a multiline comment goes into the composer', async ({ page }) => {
  await openFile(page, 'README.md');
  await replaceEditorContent(page, createLongMarkdownDocument(20));

  await setEditorSelection(page, 'Line 1 for follow testing.\nLine 2 for follow testing.\nLine 3 for follow testing.');
  await (await waitForCommentSelectionChip(page)).click();
  await page.keyboard.type('multiline');

  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-focused/);
  await expect(page.locator('.comment-card-input')).toHaveValue('multiline');
  await expect(page.locator('.cm-content')).not.toContainText('multiline');
});

test('keeps the inline chip hidden during pointer drag and hides it when scrolled out of view', async ({ page }) => {
  await restoreReadmeTestDocument(page);
  await openFile(page, 'README.md');
  await expect(page.locator('.cm-editor')).toContainText('Welcome to the test vault');

  await dragEditorSelection(page, 'Welcome to the test vault');
  await expect(page.locator('.comment-selection-chip')).toBeHidden();

  await page.mouse.up();
  await waitForCommentSelectionChip(page);

  await replaceEditorContent(page, createLongMarkdownDocument(180));
  await setEditorSelection(page, 'Line 1 for follow testing.');
  await waitForCommentSelectionChip(page);

  await page.locator('.cm-scroller').evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight });
  });
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
});

test('creates and syncs a line comment across collaborators', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await clearReadmeCollaborationSidecars();
  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');
  await replaceEditorContent(pageA, README_TEST_DOCUMENT);
  await expect(pageB.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(pageA, {
    body: 'Please tighten this intro.',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await expect(pageA.locator('#commentsToggle')).toContainText('1');
  await expect(pageB.locator('#commentsToggle')).toContainText('1');
  await expect(pageB.locator('.comment-editor-badge')).toHaveCount(1);
  await expect(pageB.locator('#previewContent .comment-preview-badge')).toHaveCount(0);

  await pageB.locator('#commentsToggle').click();
  await expect(pageB.locator('#commentsDrawer')).toBeVisible();
  await expect(pageB.locator('.comments-drawer-item')).toHaveCount(1);
  await pageB.locator('.comments-drawer-item').first().click();
  await expect(pageB.locator('.comment-card')).toContainText('Please tighten this intro.');

  await pageA.close();
  await pageB.close();
});

test('renders icon-based editor thread markers with counts for grouped comments', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(page, {
    body: 'First grouped comment',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });
  await createComment(page, {
    body: 'Second grouped comment',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  const editorBadge = page.locator('.comment-editor-badge[data-count="2"]').first();

  await expect(editorBadge.locator('.comment-marker-icon')).toBeVisible();
  await expect(editorBadge.locator('.comment-marker-count')).toHaveText('2');
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(0);
});

test('hides editor thread markers when their anchor scrolls out of view', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, createLongMarkdownDocument(180));

  await createComment(page, {
    body: 'Scroll-away editor anchor.',
    collapseSelection: true,
    targetText: 'Line 4 for follow testing.',
  });

  const editorBadge = page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first();
  await expect(editorBadge).toBeVisible();

  await page.locator('.cm-scroller').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });

  await expect(editorBadge).toHaveCount(0);
});

test('scrolls the editor and preview to a comment selected from the drawer', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, Array.from(
    { length: 180 },
    (_, index) => `## Section ${index + 1}\n\nLine ${index + 1} for comment navigation testing.`,
  ).join('\n\n'));

  await createComment(page, {
    body: 'Return to this anchored line.',
    collapseSelection: true,
    targetText: 'Line 4 for comment navigation testing.',
  });

  await page.locator('.cm-scroller').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => (
    page.locator('#previewContainer').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(0);

  await page.locator('#commentsToggle').click();
  await page.locator('.comments-drawer-item').click();

  await expect.poll(async () => (
    page.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll((elements) => (
      elements.some((element) => element.textContent === '15')
    ))
  )).toBe(true);
  await expect.poll(async () => page.evaluate(() => {
    const container = document.getElementById('previewContainer');
    const target = document.querySelector('#previewContent [data-source-line="15"]');
    if (!container || !target) {
      return false;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return targetRect.bottom >= containerRect.top && targetRect.top <= containerRect.bottom;
  })).toBe(true);
});

test('keeps reply action aligned by using an active Reply toggle state', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(page, {
    body: 'Please clarify this section.',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
  const replyButton = page.locator('.comment-thread-card-action').filter({ hasText: 'Reply' }).first();

  await expect(replyButton).toHaveText('Reply');
  await replyButton.click();
  await expect(replyButton).toHaveText('Reply');
  await expect(replyButton).toHaveClass(/is-active/);
  await expect(page.locator('.comment-reply-form')).toBeVisible();
});

test('creates a selected-text comment and surfaces it through the editor marker', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(page, {
    body: 'This phrase should stay visible in preview.',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await expect(page.locator('#previewContent .comment-preview-highlight')).toHaveCount(1);
  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
  await expect(page.locator('.comment-card')).toContainText('Welcome to the test vault');
  await expect(page.locator('.comment-card')).toContainText('This phrase should stay visible in preview.');
});

test('promotes preview highlights on hover and active editor thread selection', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Hover promotion check.',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  const badge = page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first();
  const highlight = page.locator('#previewContent .comment-preview-highlight').first();
  await expect(badge).toHaveClass(/is-passive/);
  await expect(highlight).toHaveClass(/is-passive/);

  await hoverPreviewQuotedText(page, 'Welcome to the test vault');
  await expect(highlight).toHaveClass(/is-hovered/);

  await badge.click();
  await expect(badge).toHaveClass(/is-active/);
  await expect(highlight).toHaveClass(/is-active/);
});

test('renders multiline markdown comments with fenced code blocks in the thread card', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'First line\nSecond line\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();

  await expect(page.locator('.comment-message-card-body')).toContainText('First line');
  await expect(page.locator('.comment-message-card-body')).toContainText('Second line');
  await expect(page.locator('.comment-message-card-body pre code')).toContainText('const answer = 42;');
  await expect.poll(async () => (
    page.locator('.comment-message-card-body pre').evaluate((element) => getComputedStyle(element).overflowX)
  )).toBe('auto');
});

test('shows wrapped excerpts and the latest comment preview in the comments drawer', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Initial comment',
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });
  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
  await page.locator('.comment-thread-card-action').filter({ hasText: 'Reply' }).first().click();
  await page.locator('.comment-card-input').last().fill('Latest reply with\n\n- bullet one\n- bullet two');
  await page.locator('.comment-reply-form').getByRole('button', { name: 'Reply' }).click();
  await expect(page.locator('.comment-reply-form')).toBeHidden();

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();
  await expect(page.locator('.comments-drawer-item-preview')).toContainText('Latest reply with');
  await expect(page.locator('.comments-drawer-item-preview')).toContainText('bullet one');
  await expect.poll(async () => (
    page.locator('.comments-drawer-item-quote').evaluate((element) => getComputedStyle(element).whiteSpace)
  )).toBe('pre-wrap');
});

test('keeps the preview container width stable when comments open in preview mode', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Keep this sidebar floating.',
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });
  await expect(page.locator('#commentsToggle')).toContainText('1');

  await page.locator('.view-btn[data-view="preview"]').click();
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');

  const widthBefore = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();

  const widthAfter = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(1);
});

test('keeps the preview container width stable when comments open in split mode', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Keep this sidebar floating in split mode.',
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });
  await expect(page.locator('#commentsToggle')).toContainText('1');
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'split');

  const widthBefore = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();

  const widthAfter = await page.locator('#previewContainer').evaluate((element) => element.clientWidth);

  expect(Math.abs(widthAfter - widthBefore)).toBeLessThanOrEqual(1);
});

test('shows only one preview overlay at a time', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Mutually exclusive overlay.',
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();
  await expect(page.locator('#outlinePanel')).toBeHidden();

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();
  await expect(page.locator('#commentsDrawer')).toBeHidden();

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();
  await expect(page.locator('#outlinePanel')).toBeHidden();
});

test('closes preview overlays when clicking the editor pane', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Dismiss on outside click.',
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();
  await page.locator('.cm-content').first().click();
  await expect(page.locator('#commentsDrawer')).toBeHidden();

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();
  await page.locator('.cm-content').first().click();
  await expect(page.locator('#outlinePanel')).toBeHidden();
});

test('keeps the refreshed comment card within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 780 });
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: '```js\nconst veryLongLine = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n```\n\nLine one\nLine two\nLine three\nLine four\nLine five',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await hoverPreviewQuotedText(page, 'Welcome to the test vault');
  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
  await expect(page.locator('.comment-card-scroll')).toBeVisible();
  await expect.poll(async () => (
    page.locator('.comment-card-scroll').evaluate((element) => getComputedStyle(element).overflowY)
  )).toBe('auto');

  const box = await page.locator('.comment-card').boundingBox();
  expect(box).toBeTruthy();
  expect((box?.x ?? 0) >= 0).toBe(true);
  expect((box?.y ?? 0) >= 0).toBe(true);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(780);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(900);
});

test('hides preview comment markers in narrow split layouts while keeping comments accessible', async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 780 });
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);
  await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'split');

  await createComment(page, {
    body: 'Narrow layout comment.',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  const previewBadge = page.locator('#previewContent .comment-preview-badge[aria-label="1 comment thread"]');
  await expect(previewBadge).toHaveCount(0);

  await page.locator('#commentsToggle').click();
  await expect(page.locator('#commentsDrawer')).toBeVisible();
  await expect(page.locator('.comments-drawer-item')).toHaveCount(1);
});

test('toggles a preset emoji reaction on a comment message', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Reaction ready',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
  await page.locator('.comment-reaction-quick-add').filter({ hasText: '👍' }).first().click();

  const chip = page.locator('.comment-reaction-chip').filter({ hasText: '👍' }).first();
  await expect(chip).toContainText('1');
  await expect(chip).toHaveClass(/is-active/);
  await expect(page.locator('.comment-reaction-quick-add').filter({ hasText: '👍' })).toHaveCount(0);

  await chip.click();
  await expect(page.locator('.comment-reaction-chip').filter({ hasText: '👍' })).toHaveCount(0);
});

test('supports reacting to reply messages through the extended reaction picker', async ({ page }) => {
  await clearReadmeCollaborationSidecars();
  await openFile(page, 'README.md');
  await replaceEditorContent(page, README_TEST_DOCUMENT);

  await createComment(page, {
    body: 'Initial comment',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await page.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
  await page.locator('.comment-thread-card-action').filter({ hasText: 'Reply' }).first().click();
  await page.locator('.comment-card-input').last().fill('Reply with reaction');
  await page.locator('.comment-reply-form').getByRole('button', { name: 'Reply' }).click();
  await expect(page.locator('.comment-reply-form')).toBeHidden();

  const replyCard = page.locator('.comment-message-card').last();
  await replyCard.locator('.comment-reaction-more-trigger').click();
  await expect(replyCard.locator('.comment-reaction-picker')).toBeVisible();
  await replyCard.locator('.comment-reaction-picker-btn').filter({ hasText: '💡' }).click();

  const chip = replyCard.locator('.comment-reaction-chip').filter({ hasText: '💡' });
  await expect(chip).toContainText('1');
  await expect(chip).toHaveClass(/is-active/);
});

test('syncs reaction counts across collaborators while keeping active state local', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await clearReadmeCollaborationSidecars();
  await openFile(pageA, 'README.md', { userName: 'Andes A' });
  await openFile(pageB, 'README.md', { userName: 'Andes B' });
  await replaceEditorContent(pageA, README_TEST_DOCUMENT);
  await expect(pageB.locator('#previewContent')).toContainText('Welcome to the test vault');

  await createComment(pageA, {
    body: 'Sync reaction',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  const openThread = async (targetPage) => {
    await targetPage.locator('.comment-editor-badge[aria-label="1 comment thread"]').first().click();
    await expect(targetPage.locator('.comment-card')).toBeVisible();
  };

  await openThread(pageA);
  await pageA.locator('.comment-reaction-quick-add').filter({ hasText: '👍' }).first().click();

  await openThread(pageB);
  const pageBChip = pageB.locator('.comment-reaction-chip').filter({ hasText: '👍' }).first();
  await expect(pageBChip).toContainText('1');
  await expect(pageBChip).not.toHaveClass(/is-active/);

  await pageBChip.click();
  await expect(pageBChip).toContainText('2');
  await expect(pageBChip).toHaveClass(/is-active/);
  await expect(pageA.locator('.comment-reaction-chip').filter({ hasText: '👍' }).first()).toContainText('2');

  await contextA.close();
  await contextB.close();
});

test('supports comments for Mermaid and PlantUML files', async ({ page }) => {
  await stubPlantUmlRender(page, 'commentable-plantuml');

  await openFile(page, 'sample-mermaid.mmd');
  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await createComment(page, {
    body: 'Mermaid source comment',
    collapseSelection: true,
    targetText: 'flowchart TD',
  });
  await expect(page.locator('.comment-editor-badge')).toHaveCount(1);
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(0);

  await openFile(page, 'sample-plantuml.puml');
  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await createComment(page, {
    body: 'PlantUML source comment',
    collapseSelection: true,
    targetText: '@startuml',
  });
  await expect(page.locator('.comment-editor-badge')).toHaveCount(1);
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(0);
});

test('does not render comment UI controls for Excalidraw', async ({ page }) => {
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  await expect(page.locator('#commentSelectionBtn')).toBeHidden();
  await expect(page.locator('#commentsToggle')).toBeHidden();
});

test('syncs collaborative edits across two users on the same file', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await clearReadmeCollaborationSidecars();
  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');
  await replaceEditorContent(pageA, README_TEST_DOCUMENT);
  await expect(pageB.locator('#previewContent')).toContainText('Welcome to the test vault');

  await expect(pageA.locator('#userCount')).toHaveText('2 online');

  await pageA.locator('.cm-content').first().click();
  await pageA.keyboard.press('Control+End');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.type('# Shared Draft\n\nUpdated from browser A.', { delay: 5 });

  await expect(pageB.locator('#previewContent')).toContainText('Shared Draft');
  await expect(pageB.locator('#previewContent')).toContainText('Updated from browser A.');

  await pageA.close();
  await pageB.close();
});

test('shows a foreground toast and stronger unread state for visible remote chat messages', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md', { userName: 'Sender' });
  await openFile(pageB, 'README.md', { userName: 'Receiver' });

  await openChat(pageB);
  await pageB.locator('#chatToggleBtn').click();

  await sendChatMessage(pageA, 'Quick sync: reviewing README right now.');

  const chatToast = pageB.locator('#chatToastContainer .toast').filter({
    hasText: 'Sender: Quick sync: reviewing README right now.',
  }).first();
  await expect(chatToast).toBeVisible();
  await expect(chatToast).toContainText(
    'Sender: Quick sync: reviewing README right now.',
  );
  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');
  await expect(pageB.locator('#chatToggleBtn')).toHaveClass(/is-unread/);

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText('Quick sync: reviewing README right now.');
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();
  await expect(pageB.locator('#chatToggleBtn')).not.toHaveClass(/is-unread/);

  await pageA.close();
  await pageB.close();
});

test('shows a desktop notification for a remote chat message once alerts are enabled', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageB.addInitScript(() => {
    const events = [];
    class FakeNotification {
      static permission = 'default';

      static requestPermission() {
        FakeNotification.permission = 'granted';
        return Promise.resolve('granted');
      }

      constructor(title, options) {
        events.push({ title, options });
      }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: FakeNotification,
    });
    window.__collabmdNotificationEvents = events;
  });

  await openFile(pageA, 'README.md', { userName: 'Sender' });
  await openFile(pageB, 'README.md', { userName: 'Receiver' });

  await openChat(pageB);
  await pageB.locator('#chatNotificationBtn').click();
  await expect(pageB.locator('#chatNotificationBtn')).toBeHidden();
  await expect(pageB.locator('#chatNotificationStatus')).toHaveText('Alerts on');
  await expect(pageB.locator('#chatNotificationMuteBtn')).toBeVisible();
  await expect(pageB.locator('#chatNotificationMuteBtn')).toHaveAttribute(
    'aria-label',
    'Mute desktop alerts for one hour',
  );
  await expect(pageB.locator('#chatPanel')).toBeVisible();
  await pageB.locator('#chatToggleBtn').click();
  await expect(pageB.locator('#chatPanel')).toBeHidden();
  await pageB.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => false,
    });
  });

  await pageA.bringToFront();
  await sendChatMessage(pageA, 'Background alert: reviewing README right now.');

  await expect.poll(async () => pageB.evaluate(
    () => window.__collabmdNotificationEvents?.length ?? 0,
  )).toBe(1);

  const notification = await pageB.evaluate(() => window.__collabmdNotificationEvents[0]);
  expect(notification.title).toBe('New message from Sender');
  expect(notification.options.body).toBe('Background alert: reviewing README right now.');
  await expect(pageB.locator('#chatMessages')).not.toContainText(
    'Background alert: reviewing README right now.',
  );
  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');
  await expect(pageB.locator('#chatToggleBadge')).toBeVisible();
  await expect(pageB.locator('#chatToastContainer .toast')).toHaveCount(0);

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText(
    'Background alert: reviewing README right now.',
  );
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();

  await pageB.locator('#chatNotificationMuteBtn').click();
  await expect(pageB.locator('#chatNotificationMuteBtn')).toHaveAttribute(
    'aria-label',
    'Unmute desktop alerts',
  );
  await expect(pageB.locator('#chatNotificationMuteBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(pageB.locator('#chatNotificationStatus')).toHaveText('Alerts muted');
  await pageB.locator('#chatToggleBtn').click();

  await pageA.bringToFront();
  await pageA.locator('#chatInput').fill('Muted alert: reviewing the final section now.');
  await pageA.locator('#chatForm').getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => pageB.evaluate(
    () => window.__collabmdNotificationEvents?.length ?? 0,
  )).toBe(1);
  await expect(pageB.locator('#chatToastContainer .toast')).toHaveCount(0);
  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText(
    'Muted alert: reviewing the final section now.',
  );
  await pageB.locator('#chatNotificationMuteBtn').click();
  await expect(pageB.locator('#chatNotificationMuteBtn')).toHaveAttribute(
    'aria-label',
    'Mute desktop alerts for one hour',
  );
  await expect(pageB.locator('#chatNotificationMuteBtn')).toHaveAttribute('aria-pressed', 'false');
  await expect(pageB.locator('#chatNotificationStatus')).toHaveText('Alerts on');

  await pageA.close();
  await pageB.close();
});

test('follows another user to their current cursor position', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await openFile(followerPage, 'README.md');
  await openFile(targetPage, 'README.md');

  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  await replaceEditorContent(targetPage, createLongMarkdownDocument());
  await expect(followerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');

  const initialScrollTop = await followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);
  await followerPage.locator('#userAvatars .user-avatar-button').first().click();

  await expect.poll(async () => (
    followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(initialScrollTop + 150);

  await followerPage.close();
  await targetPage.close();
});

test('stops following when the follower takes manual control', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await openFile(followerPage, 'README.md');
  await openFile(targetPage, 'README.md');
  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  const targetAvatar = followerPage.locator('#userAvatars .user-avatar-button').first();
  const startFollowing = async () => {
    await targetAvatar.click();
    await expect(targetAvatar).toHaveAttribute('aria-label', /^Stop following /);
  };
  const expectStopped = () => expect(targetAvatar).toHaveAttribute('aria-label', /^Follow /);

  await startFollowing();
  await followerPage.locator('.cm-content').click();
  await expectStopped();

  await startFollowing();
  await followerPage.keyboard.press('Escape');
  await expectStopped();

  await startFollowing();
  await followerPage.locator('.cm-scroller').dispatchEvent('wheel');
  await expectStopped();

  await startFollowing();
  await followerPage.locator('#fileTree .file-tree-dir[data-path="daily"]').click();
  await followerPage.locator('#fileTree .file-tree-file[data-path="daily/2026-03-05.md"]').click();
  await expect(followerPage).toHaveURL(/file=daily%2F2026-03-05\.md/u);
  await expectStopped();

  await followerPage.close();
  await targetPage.close();
});

test('pins and labels the current user in the header avatar list', async ({ browser }) => {
  const localPage = await browser.newPage();
  const remotePage = await browser.newPage();

  await openFile(localPage, 'README.md', { userName: 'Owner' });
  await openFile(remotePage, 'README.md', { userName: 'Teammate' });

  await expect(localPage.locator('#userCount')).toHaveText('2 online');

  const localAvatar = localPage.locator('#userAvatars > .user-avatar').first();
  await expect(localAvatar).toHaveClass(/is-local/);
  await expect(localAvatar).toContainText('You');
  await expect(localAvatar).toHaveAttribute('aria-label', /Owner \(you\) — README/);
  await expect(localPage.locator('#userAvatars .user-avatar-button')).toHaveCount(1);

  await localPage.close();
  await remotePage.close();
});

test('opens the participant panel for hidden collaborators and follows them', async ({ browser }) => {
  const names = ['Owner', 'Amy', 'Ben', 'Cara', 'Drew', 'Eli', 'Farah'];
  const contexts = await Promise.all(names.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    for (const [index, page] of pages.entries()) {
      await openFile(page, 'README.md', { userName: names[index] });
    }

    const ownerPage = pages[0];
    const hiddenTargetPage = pages.at(-1);

    await replaceEditorContent(hiddenTargetPage, createLongMarkdownDocument(140));
    await expect(ownerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');
    await expect(ownerPage.locator('#userCount')).toHaveText('7 online');
    await expect(ownerPage.locator('#userAvatars .user-avatar-overflow-trigger')).toHaveText('+2');
    await expect(ownerPage.locator('#userAvatars .user-avatar-button[aria-label*="Farah"]')).toHaveCount(0);

    const initialScrollTop = await ownerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);

    await ownerPage.locator('#userCount').click();
    await expect(ownerPage.locator('#presencePanel')).toBeVisible();
    await expect(ownerPage.locator('#presencePanel .presence-panel-user')).toHaveCount(7);
    await ownerPage.locator('#presencePanel .presence-panel-user-button').filter({ hasText: 'Farah' }).click();
    await expect(ownerPage.locator('#presencePanel')).toBeHidden();

    await expect.poll(async () => (
      ownerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
    )).toBeGreaterThan(initialScrollTop + 150);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  }
});
