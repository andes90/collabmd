import { test, expect } from '@playwright/test';

async function waitForEditor(page) {
  await expect(page.locator('.cm-editor')).toBeVisible();
}

async function appendEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(content, { delay: 5 });
}

async function replaceEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(content);
}

function createLongMarkdownDocument(lineCount = 80) {
  const lines = ['# Follow Target', ''];

  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(`Line ${index} for follow testing.`);
  }

  return lines.join('\n');
}

function createScrollSyncRegressionDocument(itemCount = 80) {
  const lines = [
    '# Scroll Sync Regression',
    '',
    '## First section',
    '',
  ];

  for (let index = 1; index <= itemCount; index += 1) {
    lines.push(`- First section item ${index}.`);
  }

  lines.push('', '## Second section', '');

  for (let index = 1; index <= itemCount; index += 1) {
    const suffix = index === 52 ? ' sync target.' : '.';
    lines.push(`- Second section item ${index}${suffix}`);
  }

  return lines.join('\n');
}

test('renders markdown preview for a room', async ({ page }) => {
  await page.goto('/#room=e2e-preview');
  await waitForEditor(page);

  await appendEditorContent(page, '# Blackbox Heading\n\nParagraph from Playwright.');

  await expect(page.locator('#previewContent')).toContainText('Paragraph from Playwright.');
});

test('syncs collaborative edits across two users', async ({ browser }) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageA.goto('/#room=e2e-collaboration');
  await pageB.goto('/#room=e2e-collaboration');

  await Promise.all([waitForEditor(pageA), waitForEditor(pageB)]);
  await expect(pageA.locator('#userCount')).toHaveText('2 online');

  await appendEditorContent(pageA, '# Shared Draft\n\nUpdated from browser A.');

  await expect(pageB.locator('#previewContent')).toContainText('Shared Draft');
  await expect(pageB.locator('#previewContent')).toContainText('Updated from browser A.');

  await pageA.close();
  await pageB.close();
});

test('follows another user to their current cursor position', async ({ browser }) => {
  const followerPage = await browser.newPage();
  const targetPage = await browser.newPage();

  await followerPage.goto('/#room=e2e-follow');
  await targetPage.goto('/#room=e2e-follow');

  await Promise.all([waitForEditor(followerPage), waitForEditor(targetPage)]);
  await expect(followerPage.locator('#userCount')).toHaveText('2 online');

  await appendEditorContent(targetPage, createLongMarkdownDocument());
  await expect(followerPage.locator('#previewContent')).toContainText('Line 80 for follow testing.');

  const initialScrollTop = await followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop);
  await followerPage.locator('#userAvatars .user-avatar-button').first().click();

  await expect.poll(async () => (
    followerPage.locator('.cm-scroller').evaluate((element) => element.scrollTop)
  )).toBeGreaterThan(initialScrollTop + 150);

  await followerPage.close();
  await targetPage.close();
});

test('keeps preview and outline aligned when scrolling list-heavy editor content', async ({ page }) => {
  await page.goto('/#room=e2e-scroll-sync');
  await waitForEditor(page);

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
  await page.goto('/#room=e2e-outline-editor-sync');
  await waitForEditor(page);

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

test('keeps the outline open on desktop after selecting a section', async ({ page }) => {
  await page.goto('/#room=e2e-desktop-outline');
  await waitForEditor(page);

  await page.locator('#outlineToggle').click();
  await expect(page.locator('#outlinePanel')).toBeVisible();

  await page.locator('#outlineNav .outline-item', { hasText: 'Features' }).click();

  await expect(page.locator('#outlinePanel')).toBeVisible();
});

test.describe('mobile outline', () => {
  test.use({
    viewport: { width: 390, height: 844 },
  });

  test('closes the outline after selecting a section on mobile', async ({ page }) => {
    await page.goto('/#room=e2e-mobile-outline');
    await waitForEditor(page);

    await page.locator('#mobileViewToggle').click();

    await expect(page.locator('#outlineToggle')).toBeVisible();
    await page.locator('#outlineToggle').click();

    await expect(page.locator('#outlinePanel')).toBeVisible();
    await expect(page.locator('#outlineNav')).toContainText('Welcome to CollabMD');
    await expect(page.locator('#outlineNav')).toContainText('Features');

    await page.locator('#outlineNav .outline-item', { hasText: 'Features' }).click();

    await expect(page.locator('#outlinePanel')).toBeHidden();
  });
});
