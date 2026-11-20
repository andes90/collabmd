import { expect, openFile, replaceEditorContent, test, waitForPreview } from './helpers/app-fixture.js';

test('renders emoji shortcodes while preserving literal code in the live preview', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, '# Meeting :computer:\n\n- [ ] **:clock8: Weekly sync** [[README|:rocket: Guide]]\n\n`:computer:`');
  await waitForPreview(page);
  const preview = page.locator('#previewContent');
  await expect(preview.locator('h1')).toContainText('Meeting 💻');
  const checkbox = preview.getByRole('checkbox', { name: '🕗 Weekly sync 🚀 Guide' });
  await expect(checkbox).toBeVisible();
  const wikiLink = preview.getByRole('link', { name: '🚀 Guide' });
  await expect(wikiLink).toHaveClass('wiki-link');
  await expect(preview.locator('code')).toHaveText(':computer:');
  await preview.getByText('🕗 Weekly sync', { exact: true }).click();
  await expect(checkbox).toBeChecked();
  await wikiLink.click();
  await expect(page.locator('#activeFileName')).toContainText('README');
});
