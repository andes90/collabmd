import { afterEach, expect, it } from 'vitest';
import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

afterEach(() => document.body.replaceChildren());

it('renders a nested TOC identically in the main preview and worker', async () => {
  const markdownText = '[TOC]\n\n# First\n\n## Updates\n\n# Second\n\n## Updates';
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
    const links = [...document.querySelectorAll('nav a')];
    const headings = [...document.querySelectorAll('h1, h2')];
    expect(links.map((link) => decodeURIComponent(link.hash.slice(1)))).toEqual(headings.map((heading) => heading.id));
    expect(document.querySelectorAll('nav > ol > li').length).toBe(2);
    expect(document.querySelectorAll('nav > ol > li > ol').length).toBe(2);
  } finally {
    worker.terminate();
  }
});
