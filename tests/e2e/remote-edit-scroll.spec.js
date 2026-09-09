import { readFile } from 'node:fs/promises';
import { test, expect, openFile, replaceEditorContent, restoreReadmeTestDocument, setEditorSelection } from './helpers/app-fixture.js';

for (const selector of ['.cm-scroller', '#previewContainer']) {
  test(`remote typing preserves the reader viewport in ${selector}`, async ({ browser }) => {
    const writer = await browser.newPage();
    const reader = await browser.newPage();
    try {
      await openFile(writer, 'README.md');
      await replaceEditorContent(writer, await readFile('test-vault/sample-full.md', 'utf8'));
      await openFile(reader, 'README.md');
      await expect(reader.locator('#previewContent')).toContainText('Wiki-Link Resolution');
      await setEditorSelection(reader, '# CollabMD', { collapse: true });
      await reader.locator('.cm-content').focus();
      const pane = reader.locator(selector);
      const bounds = await pane.boundingBox();
      await reader.mouse.move(bounds.x + 20, bounds.y + 100);
      await reader.mouse.wheel(0, 2400);
      await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(1500);
      await reader.waitForTimeout(2000);
      const controlStart = await pane.evaluate((element) => element.scrollTop);
      await reader.waitForTimeout(1500);
      const before = await pane.evaluate((element) => element.scrollTop);
      expect(Math.abs(before - controlStart)).toBeLessThan(2);
      await setEditorSelection(writer, '# CollabMD', { collapse: true });
      await writer.locator('.cm-content').focus();
      await writer.keyboard.type('Remote typing here. ', { delay: 50 });
      await expect(reader.locator('#previewContent')).toContainText('Remote typing here.');
      await reader.waitForTimeout(1500);
      const after = await pane.evaluate((element) => element.scrollTop);
      expect(Math.abs(after - before)).toBeLessThan(100);
    } finally {
      // This spec replaces README.md content; restore it so later tests in
      // the same worker (which share one vault snapshot) see a clean file.
      await restoreReadmeTestDocument(writer);
      await writer.close();
      await reader.close();
    }
  });
}
