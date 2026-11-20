import { expect, openFile, replaceEditorContent, test, waitForPreview } from './helpers/app-fixture.js';

const meeting = '<details>\n<summary>Meeting template</summary>\n\n## Agenda\n\n- [x] Discuss items\n\n</details>';

test('opens and closes Markdown details using the mouse and keyboard', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, meeting);
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

test('keeps a reader’s disclosure choice across edits to the same note', async ({ page }) => {
  const renamed = `# Meeting\n\n${meeting.replace('Meeting template', 'Renamed template')}`;
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, meeting);
  const preview = page.locator('#previewContent');
  const details = preview.locator('details');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open');

  await replaceEditorContent(page, `# Meeting\n\n${meeting.replace('Discuss items', 'Discuss notes')}`);
  await expect(details.getByText('Discuss notes')).toBeVisible();

  await replaceEditorContent(page, renamed);
  await expect(details.locator('summary')).toHaveText('Renamed template');
  await expect(details.getByText('Discuss items')).toBeVisible();

  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open');
  const defaultOpen = renamed.replace('<details>', '<details open>');
  await replaceEditorContent(page, defaultOpen);
  await expect(details.getByText('Discuss items')).toBeVisible();

  await details.locator('summary').click();
  await replaceEditorContent(page, defaultOpen.replace('Discuss items', 'Discuss follow-ups'));
  await expect(details).toContainText('Discuss follow-ups');
  await expect(details).not.toHaveAttribute('open');
});

test('reveals nested headings reached by links and the outline', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  const markdown = `# Meeting\n\n[Jump to agenda](#agenda)\n\n<details>\n<summary>Outer</summary>\n\n${meeting}\n\n</details>`;
  await replaceEditorContent(page, markdown);
  const preview = page.locator('#previewContent');
  const agenda = preview.locator('#agenda');
  await expect(agenda).toHaveCount(1);
  await expect(agenda).toBeHidden();
  await preview.getByRole('link', { name: 'Jump to agenda' }).click();
  await expect(agenda).toBeVisible();
  await expect(preview.locator('details[open]')).toHaveCount(2);

  await preview.getByText('Outer', { exact: true }).click();
  await expect(agenda).toBeHidden();
  await page.locator('#outlineToggle').click();
  await page.locator('#outlineNav').getByRole('button', { name: 'Agenda' }).click();
  await expect(agenda).toBeVisible();
});

test('opens disclosures on the export surface before printing to PDF', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => {
      const closed = document.querySelector('#exportContent details:not([open])');
      document.body.dataset.printDisclosures = closed ? 'closed' : 'open';
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, meeting);
  await expect(page.locator('#previewContent summary')).toHaveText('Meeting template');
  await expect(page.locator('#previewContent details')).not.toHaveAttribute('open');

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportPdfBtn').click();
  const popup = await popupPromise;
  await expect(popup.locator('#exportStatus')).toContainText('Print dialog opened.');
  await expect(popup.locator('body')).toHaveAttribute('data-print-disclosures', 'open');
  await popup.emulateMedia({ media: 'print' });
  await expect(popup.locator('#exportContent').getByText('Discuss items')).toBeVisible();
});
