import { afterEach, expect, it } from 'vitest';
import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

afterEach(() => document.body.replaceChildren());

it('renders emoji consistently in the preview and its worker', async () => {
  const markdownText = '# Meeting :computer:\n\n- [x] :clock8:\n\n`:computer:`';
  const main = compilePreviewDocument({ markdownText });
  const worker = new Worker(new URL('../../src/client/application/preview-render-worker.js', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = reject;
      worker.postMessage({ markdownText, renderVersion: 1 });
    });
    expect(result.error).toBeUndefined();
    expect(result.html).toBe(main.html);
    document.body.innerHTML = result.html;
    expect(document.querySelector('h1').textContent).toBe('Meeting 💻');
    expect(document.querySelector('input').checked).toBe(true);
    expect(document.querySelector('code').textContent).toBe(':computer:');
  } finally {
    worker.terminate();
  }
});
