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

function createLongMarkdownDocument(lineCount = 80) {
  const lines = ['# Follow Target', ''];

  for (let index = 1; index <= lineCount; index += 1) {
    lines.push(`Line ${index} for follow testing.`);
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
