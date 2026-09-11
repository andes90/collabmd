import {
  expect,
  openFile,
  replaceEditorContent,
  test,
  waitForPreview,
} from './helpers/app-fixture.js';

test('renders KaTeX math in the markdown preview', async ({ page }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(
    page,
    [
      '# Math notes',
      '',
      'Inline $E = mc^2$ here.',
      '',
      '$$',
      '\\frac{a}{b}',
      '$$',
      '',
      'Price is $5 and $10 total.',
    ].join('\n'),
  );
  await waitForPreview(page);

  const preview = page.locator('#previewContent');
  await expect(preview.locator('.katex').first()).toBeVisible();
  await expect(preview.locator('.katex-block')).toBeVisible();
  await expect(preview).toContainText('Price is $5 and $10 total.');
  await expect(preview.locator('.katex-error')).toHaveCount(0);
});

test('exports math as a self-contained HTML document with inlined fonts', async ({ page, context }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, '# Math notes\n\nInline $E = mc^2$ here.');
  await waitForPreview(page);
  await expect(page.locator('#previewContent .katex').first()).toBeVisible();

  const popupDownloadPromise = context.waitForEvent('page').then(async (popup) => ({
    download: await popup.waitForEvent('download'),
    popup,
  }));
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportHtmlBtn').click();
  const { download, popup } = await popupDownloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk);
  }
  const html = Buffer.concat(chunks).toString('utf8');

  expect(html).toContain('class="katex"');
  expect((html.match(/data:font\/woff2;base64,/g) || []).length).toBeGreaterThanOrEqual(20);
  expect(html).not.toMatch(/url\((?!data:)https?:[^)]*KaTeX_[^)]*\)/);
  await expect(popup.locator('#exportStatus')).toContainText('HTML download started.');
});

test('posts OMML markers for DOCX export', async ({ page, context }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(
    page,
    '# Math notes\n\nInline $E = mc^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\n- [x] Done task',
  );
  await waitForPreview(page);
  await expect(page.locator('#previewContent .katex').first()).toBeVisible();

  let exportRequestBody = null;
  await context.route('**/export/docx', async (route) => {
    exportRequestBody = route.request().postDataJSON();
    await route.fulfill({
      body: Buffer.from('PK\x03\x04'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 200,
    });
  });

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportDocxBtn').click();
  const popup = await popupPromise;

  await expect.poll(() => exportRequestBody).not.toBeNull();
  expect(exportRequestBody.html).toContain('COLLABMD-MATH-');
  expect(exportRequestBody.html).toContain('data-mml="%3Cmath');
  expect(exportRequestBody.html).not.toContain('katex-html');
  expect(exportRequestBody.html).toContain('\u2611 Done task');
  await expect(popup.locator('#exportStatus')).toContainText('DOCX download started.');
});

test('renders styled math on the PDF export page before printing', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => {
      window.dispatchEvent(new Event('afterprint'));
    };
  });

  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(page, '# Math notes\n\nInline $E = mc^2$ here.');
  await waitForPreview(page);

  const popupPromise = context.waitForEvent('page');
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportPdfBtn').click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/export-document\.html$/);

  const math = popup.locator('#exportContent .katex').first();
  await expect(math).toBeVisible();
  await expect.poll(() => math.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/KaTeX_Main/);
  await expect(popup.locator('#exportStatus')).toContainText('Print dialog opened.');
});
