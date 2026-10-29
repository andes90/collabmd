import { expect, openFile, replaceEditorContent, test, waitForPreview } from './helpers/app-fixture.js';

test('opens and closes Markdown details using the mouse and keyboard', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, '<details>\n<summary>Meeting template</summary>\n\n## Agenda\n\n- [x] Discuss items\n\n</details>');
  await waitForPreview(page);
  const preview = page.locator('#previewContent');
  const summary = preview.locator('summary');
  const heading = preview.locator('h2');
  await expect(summary).toHaveText('Meeting template');
  await expect(heading).toBeHidden();
  await summary.click();
  await expect(heading).toBeVisible();
  await expect(preview.locator('input[type="checkbox"]')).toBeChecked();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(heading).toBeHidden();
});
