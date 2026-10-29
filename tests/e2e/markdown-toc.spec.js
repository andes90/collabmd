import { expect, openFile, replaceEditorContent, test, waitForPreview } from './helpers/app-fixture.js';

test('TOC links navigate to the correct repeated heading without leaving the note', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, '[TOC]\n\n# First\n\n## Updates\n\n' + 'Filler paragraph.\n\n'.repeat(80) + '# Second\n\n## Updates\n\nTarget content.');
  await waitForPreview(page);
  const preview = page.locator('#previewContent');
  const links = preview.locator('nav[aria-label="Table of contents"] a');
  await expect(links).toHaveCount(4);
  const targets = await links.evaluateAll((elements) => elements.map((element) => decodeURIComponent(element.getAttribute('href').slice(1))));
  const headings = await preview.locator('h1, h2').evaluateAll((elements) => elements.map((element) => element.id));
  expect(targets).toEqual(headings);
  const url = page.url();
  await links.last().click();
  await expect.poll(() => page.evaluate((id) => {
    const heading = document.getElementById(id).getBoundingClientRect();
    const pane = document.getElementById('previewContent').getBoundingClientRect();
    return heading.top >= pane.top && heading.bottom <= pane.bottom;
  }, targets.at(-1))).toBe(true);
  expect(page.url()).toBe(url);
});
