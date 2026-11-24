import { createRequire } from 'node:module';

import sharp from 'sharp';

import {
  expect,
  openFile,
  replaceEditorContent,
  test,
  waitForExportPage,
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

test('downloads DOCX with editable equations and inline preview pictures', async ({ page, context }) => {
  await openFile(page, 'sample-full.md', { waitFor: 'preview' });
  await replaceEditorContent(
    page,
    '# Math notes\n\nInline $E = mc^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\n- [x] Done task',
  );
  await waitForPreview(page);
  await expect(page.locator('#previewContent .katex').first()).toBeVisible();

  const requestPromise = context.waitForEvent('request', (request) => request.url().endsWith('/export/docx'));
  const downloadPromise = context.waitForEvent('page').then(async (popup) => ({
    download: await popup.waitForEvent('download'),
    popup,
  }));
  await page.locator('#toolbarOverflowToggle').click();
  await page.locator('#exportMenuGroup > summary').click();
  await page.locator('#exportDocxBtn').click();
  const { download, popup } = await downloadPromise;
  const exportRequestBody = (await requestPromise).postDataJSON();
  const JSZip = createRequire(import.meta.resolve('@turbodocx/html-to-docx'))('jszip');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const documentXml = await zip.file('word/document.xml').async('string');
  const equations = await popup.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(document.getElementsByTagNameNS('*', 'AlternateContent'), (alternate) => ({
      math: alternate.getElementsByTagNameNS('*', 'Choice')[0].textContent,
      image: alternate.getElementsByTagNameNS('*', 'Fallback')[0].getElementsByTagNameNS('*', 'blip')[0]?.getAttribute('r:embed'),
      paragraph: alternate.parentNode.textContent.trim(),
    }));
  }, documentXml);
  expect(equations.map(({ math }) => math)).toEqual(['E=mc2', 'ab']);
  expect(equations.every(({ image }) => image)).toBe(true);
  expect(equations[0].paragraph).toMatch(/Inline.*here\./);
  const pictures = zip.file(/^word\/media\/.+\.png$/);
  expect(pictures).toHaveLength(2);
  for (const picture of pictures) {
    const { channels } = await sharp(await picture.async('nodebuffer')).stats();
    expect(channels[3].min).toBe(0);
    expect(channels[3].max).toBeGreaterThan(0);
  }
  expect(exportRequestBody.html).toContain('COLLABMD-MATH-');
  expect(exportRequestBody.html).toContain('data-mml="%3Cmath');
  expect(exportRequestBody.html).not.toContain('katex-html');
  const taskText = await popup.evaluate((html) => (
    new DOMParser().parseFromString(html, 'text/html').querySelector('main li')?.textContent.trim()
  ), exportRequestBody.html);
  expect(taskText).toBe('\u2611 Done task');
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
  await waitForExportPage(popup);

  const math = popup.locator('#exportContent .katex').first();
  await expect(math).toBeVisible();
  await expect.poll(() => math.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/KaTeX_Main/);
  await expect.poll(() => popup.evaluate(() => document.fonts?.status ?? 'loaded')).toBe('loaded');
  await expect.poll(() => popup.evaluate(() => document.fonts?.check('16px "KaTeX_Main"') ?? false)).toBe(true);
  await expect(popup.locator('#exportStatus')).toContainText('Print dialog opened.');
});
