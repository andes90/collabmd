import { expect, openFile, replaceEditorContent, test, waitForPreview } from './helpers/app-fixture.js';

test('renders emoji shortcodes while preserving literal code in the live preview', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, '# Meeting :computer:\n\n:clock8: Weekly sync\n\n`:computer:`');
  await waitForPreview(page);
  const preview = page.locator('#previewContent');
  await expect(preview.locator('h1')).toContainText('Meeting 💻');
  await expect(preview).toContainText('🕗 Weekly sync');
  await expect(preview.locator('code')).toHaveText(':computer:');
});
