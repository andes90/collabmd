import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

afterEach(() => document.body.replaceChildren());

it('expands and collapses a disclosure rendered by the preview worker', async () => {
  const markdownText = '<details>\n<summary>Meeting template</summary>\n\n## Agenda\n\n- [x] Discuss items\n\n</details>';
  const worker = new Worker(new URL('../../src/client/application/preview-render-worker.js', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = reject;
      worker.postMessage({ markdownText, renderVersion: 1 });
    });
    expect(result.error).toBeUndefined();
    expect(result.html).toBe(compilePreviewDocument({ markdownText }).html);
    document.body.innerHTML = result.html;
    const details = document.querySelector('details');
    const heading = document.querySelector('h2');
    await expect.element(heading).not.toBeVisible();
    await page.getByText('Meeting template').click();
    expect(details.open).toBe(true);
    await expect.element(heading).toBeVisible();
    expect(document.querySelector('input').checked).toBe(true);
    // Native summary activation also works without a mouse.
    document.querySelector('summary').focus();
    await userEvent.keyboard('{Enter}');
    expect(details.open).toBe(false);
    await expect.element(heading).not.toBeVisible();
  } finally {
    worker.terminate();
  }
});
