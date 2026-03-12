import {
  createComment,
  createLongMarkdownDocument,
  dragEditorSelection,
  expect,
  openChat,
  openFile,
  replaceEditorContent,
  setEditorSelection,
  seedStoredUserName,
  sendChatMessage,
  stubPlantUmlRender,
  test,
  waitForCommentSelectionChip,
  waitForExcalidrawFrameHarness,
  waitForExcalidrawTestHarness,
} from './helpers/app-fixture.js';

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

test('taking over an Excalidraw file tab preserves the live scene', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await seedStoredUserName(pageA);
  await seedStoredUserName(pageB);

  await pageA.goto('/?test=1#file=sample-excalidraw.excalidraw');
  const frameA = await waitForExcalidrawFrameHarness(pageA);

  await frameA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#345678',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });
  await frameA.waitForTimeout(150);

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

test('shared Excalidraw undo and redo replay the room history across two users', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
  await pageB.goto('/excalidraw-editor.html?file=sample-excalidraw.excalidraw&test=1');
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

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#222222',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');
  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');

  await pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');
  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await context.close();
});

test('shared Excalidraw history drops redo after undo followed by a new edit', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

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
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#111111');

  await pageA.evaluate(() => {
    const scene = JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson());
    scene.appState = {
      ...(scene.appState || {}),
      viewBackgroundColor: '#333333',
    };
    window.__COLLABMD_EXCALIDRAW_TEST__.setScene(scene);
  });

  await expect.poll(async () => (
    pageB.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#333333');
  await expect.poll(async () => (
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canRedo)
  )).toBe(false);

  await pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.redoShared());

  await expect.poll(async () => (
    pageA.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#333333');

  await context.close();
});

test('shared Excalidraw history is ephemeral after the room fully closes', async ({ browser }) => {
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
    pageB.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getHistoryState().canUndo)
  )).toBe(true);

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
    head: 0,
    length: 1,
  });

  await pageC.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.undoShared());

  await expect.poll(async () => (
    pageC.evaluate(() => JSON.parse(window.__COLLABMD_EXCALIDRAW_TEST__.getSceneJson()).appState.viewBackgroundColor)
  )).toBe('#222222');

  await reopenContext.close();
});

test('renaming in the app updates the mounted Excalidraw iframe user name', async ({ page }) => {
  await seedStoredUserName(page, 'Before Name');
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  const frame = await waitForExcalidrawFrameHarness(page, '#previewContent .excalidraw-embed iframe');
  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('Before Name');

  await page.locator('#editNameBtn').click();
  await expect(page.locator('#displayNameDialog')).toBeVisible();
  await page.locator('#displayNameInput').fill('After Name');
  await page.locator('#displayNameSubmit').click();

  await expect.poll(async () => (
    frame.evaluate(() => window.__COLLABMD_EXCALIDRAW_TEST__.getLocalUserName())
  )).toBe('After Name');
});

test('renders comment controls for text files', async ({ page }) => {
  await openFile(page, 'README.md');

  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await expect(page.locator('#commentsToggle')).toBeVisible();
  await expect(page.locator('.comment-selection-chip')).toBeHidden();
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
  await page.keyboard.type('inline');
  await expect(page.locator('.comment-card-input')).toHaveValue('inline');
  await expect(page.locator('.cm-content')).not.toContainText('inline');
  await page.locator('.comment-card').getByRole('button', { name: 'Cancel' }).click();

  await setEditorSelection(page, 'Welcome to the test vault. This is the top-level readme.', { collapse: true });
  await page.locator('#commentSelectionBtn').click();
  await expect(page.locator('.comment-card')).toBeVisible();
  await expect(page.locator('.comment-card-input')).toBeFocused();
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
  await expect(page.locator('.comment-card-input')).toHaveValue('multiline');
  await expect(page.locator('.cm-content')).not.toContainText('multiline');
});

test('keeps the inline chip hidden during pointer drag and hides it when scrolled out of view', async ({ page }) => {
  await openFile(page, 'README.md');

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

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await createComment(pageA, {
    body: 'Please tighten this intro.',
    collapseSelection: true,
    targetText: 'Welcome to the test vault. This is the top-level readme.',
  });

  await expect(pageA.locator('#commentsToggle')).toContainText('1');
  await expect(pageB.locator('#commentsToggle')).toContainText('1');
  await expect(pageB.locator('#previewContent .comment-preview-badge')).toHaveCount(1);

  await pageB.locator('#commentsToggle').click();
  await expect(pageB.locator('#commentsDrawer')).toBeVisible();
  await pageB.locator('#previewContent .comment-preview-badge').click();
  await expect(pageB.locator('.comment-card')).toContainText('Please tighten this intro.');

  await pageA.close();
  await pageB.close();
});

test('creates a selected-text comment and surfaces it in the preview bubble card', async ({ page }) => {
  await openFile(page, 'README.md');

  await createComment(page, {
    body: 'This phrase should stay visible in preview.',
    targetText: 'Welcome to the test vault',
    useInlineChip: true,
  });

  await expect(page.locator('#previewContent .comment-preview-highlight')).toHaveCount(1);
  await page.locator('#previewContent .comment-preview-badge').click();
  await expect(page.locator('.comment-card')).toContainText('Welcome to the test vault');
  await expect(page.locator('.comment-card')).toContainText('This phrase should stay visible in preview.');
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
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(1);

  await openFile(page, 'sample-plantuml.puml');
  await expect(page.locator('#commentSelectionBtn')).toBeVisible();
  await createComment(page, {
    body: 'PlantUML source comment',
    collapseSelection: true,
    targetText: '@startuml',
  });
  await expect(page.locator('#previewContent .comment-preview-badge')).toHaveCount(1);
});

test('does not render comment UI controls for Excalidraw', async ({ page }) => {
  await page.goto('/?test=1#file=sample-excalidraw.excalidraw');

  await expect(page.locator('#commentSelectionBtn')).toBeHidden();
  await expect(page.locator('#commentsToggle')).toBeHidden();
});

test('syncs collaborative edits across two users on the same file', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

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

test('syncs disposable lobby chat and tracks unread messages', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await sendChatMessage(pageA, 'Quick sync: reviewing README right now.');

  await expect(pageB.locator('#chatToggleBadge')).toHaveText('1');

  await openChat(pageB);
  await expect(pageB.locator('#chatMessages')).toContainText('Quick sync: reviewing README right now.');
  await expect(pageB.locator('#chatToggleBadge')).toBeHidden();

  await pageA.close();
  await pageB.close();
});

test('shows a browser notification for a background chat message when alerts are enabled', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageB.addInitScript(() => {
    window.__testNotifications = [];

    class TestNotification {
      static permission = 'granted';

      static async requestPermission() {
        return 'granted';
      }

      constructor(title, options = {}) {
        this.title = title;
        this.options = options;
        window.__testNotifications.push({ title, ...options });
      }

      addEventListener() { }

      close() { }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: TestNotification,
    });
  });

  await openFile(pageA, 'README.md');
  await openFile(pageB, 'README.md');

  await openChat(pageB);
  await pageB.locator('#chatNotificationBtn').click();
  await expect(pageB.locator('#chatNotificationBtn')).toHaveText('Alerts on');
  await pageB.locator('#chatToggleBtn').click();

  await pageB.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
  });

  await sendChatMessage(pageA, 'Background ping from README.');

  await expect.poll(async () => (
    pageB.evaluate(() => window.__testNotifications.length)
  )).toBe(1);

  const notification = await pageB.evaluate(() => window.__testNotifications[0]);
  expect(notification.title).toContain('CollabMD chat');
  expect(notification.body).toBe('README: Background ping from README.');

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
