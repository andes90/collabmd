import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportDirectory, initializeExportBridge, exportDocument } from '../../src/client/export/export-host.js';
import { groupHeadingWithFollowingBlock } from '../../src/client/export/export-print-layout.js';
import {
  buildDocxHtmlDocument,
  buildHtmlDocument,
  prepareDirectoryExportSnapshot,
  prepareExportSnapshot,
  resolveExportAssets,
  waitForRenderedExportContent,
} from '../../src/client/export/export-pipeline.js';

const TINY_WEBP_BASE64 = 'UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoCAAIAAUAmJYwCdAFAAAD+++F7O1bH2fCMM6wA';
const TINY_WEBP_DATA_URL = `data:image/webp;base64,${TINY_WEBP_BASE64}`;
const TINY_GIF_BASE64 = 'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
const TINY_GIF_DATA_URL = `data:image/gif;base64,${TINY_GIF_BASE64}`;

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

describe('export pipeline browser helpers', () => {
  const originalFetch = globalThis.fetch;
  const originalOpen = window.open;

  afterEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.theme;
    globalThis.fetch = originalFetch;
    window.open = originalOpen;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('inlines remote images into the canonical snapshot', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      new Blob(['png-bytes'], { type: 'image/png' }),
      {
        headers: {
          'Content-Length': '9',
        },
        status: 200,
      },
    ));

    const container = document.createElement('div');
    container.innerHTML = '<p><img src="https://cdn.example.com/diagram.png" alt="Architecture"></p>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(image?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/png;base64,/);
    expect(Object.keys(snapshot.assets)).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('hydrates base embeds into static query results', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      result: {
        columns: [{ id: 'note.value', label: 'Value' }],
        groups: [{
          key: 'all',
          label: 'All',
          rows: [{
            cells: { 'note.value': { text: 'Rendered row', type: 'string', value: 'Rendered row' } },
            path: 'notes/rendered-row.md',
          }],
          summaries: [],
        }],
        meta: { activeViewConfig: {}, availableProperties: [], editable: false },
        summaries: [],
        totalRows: 1,
        view: { id: 'view-0', name: 'Table', supported: true, type: 'table' },
        views: [{ id: 'view-0', name: 'Table', supported: true, type: 'table' }],
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }));
    const container = document.createElement('div');
    container.innerHTML = '<div class="bases-embed-placeholder" data-base-key="base-1" data-base-path="views/tasks.base"></div>';
    const snapshot = { assets: {}, filePath: 'README.md', warnings: [] };

    await resolveExportAssets(snapshot, { container });

    expect(container.querySelector('.bases-shell-static')).not.toBeNull();
    expect(container.textContent).toContain('Rendered row');
    expect(container.querySelector('.bases-toolbar-actions')).toBeNull();
    expect(container.querySelector('.bases-embed-placeholder')).toBeNull();
    expect(snapshot.warnings).toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/base/query'), expect.objectContaining({ method: 'POST' }));
  });

  it('creates PNG DOCX variants for fetched WebP images', async () => {
    const webpBytes = bytesFromBase64(TINY_WEBP_BASE64);
    globalThis.fetch = vi.fn(async () => new Response(
      new Blob([webpBytes], { type: 'image/webp' }),
      {
        headers: {
          'Content-Length': String(webpBytes.byteLength),
        },
        status: 200,
      },
    ));

    const container = document.createElement('div');
    container.innerHTML = '<p><img src="https://cdn.example.com/photo.webp" alt="Architecture"></p>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/);
    expect(image?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/png;base64,/);
    expect(Object.values(snapshot.assets)[0]?.mimeType).toBe('image/webp');
    expect(snapshot.warnings).toHaveLength(0);

    const docxHtml = buildDocxHtmlDocument({
      html: container.innerHTML,
      title: 'README',
    });
    expect(docxHtml).toContain('src="data:image/png;base64,');
    expect(docxHtml).not.toContain('src="data:image/webp;base64,');
  });

  it('creates PNG DOCX variants for inline WebP data URL images', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<p><img src="${TINY_WEBP_DATA_URL}" alt="Inline WebP"></p>`;
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe(TINY_WEBP_DATA_URL);
    expect(image?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/png;base64,/);
    expect(Object.keys(snapshot.assets)).toHaveLength(0);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('creates PNG DOCX variants for fetched GIF images', async () => {
    const gifBytes = bytesFromBase64(TINY_GIF_BASE64);
    globalThis.fetch = vi.fn(async () => new Response(
      new Blob([gifBytes], { type: 'image/gif' }),
      {
        headers: {
          'Content-Length': String(gifBytes.byteLength),
        },
        status: 200,
      },
    ));

    const container = document.createElement('div');
    container.innerHTML = '<p><img src="https://cdn.example.com/animation.gif" alt="Animation"></p>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
    expect(image?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/png;base64,/);
    expect(Object.values(snapshot.assets)[0]?.mimeType).toBe('image/gif');
    expect(snapshot.warnings).toHaveLength(0);

    const docxHtml = buildDocxHtmlDocument({
      html: container.innerHTML,
      title: 'README',
    });
    expect(docxHtml).toContain('src="data:image/png;base64,');
    expect(docxHtml).not.toContain('src="data:image/gif;base64,');
  });

  it('creates PNG DOCX variants for inline GIF data URL images', async () => {
    const container = document.createElement('div');
    container.innerHTML = `<p><img src="${TINY_GIF_DATA_URL}" alt="Inline GIF"></p>`;
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe(TINY_GIF_DATA_URL);
    expect(image?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/png;base64,/);
    expect(Object.keys(snapshot.assets)).toHaveLength(0);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('replaces image nodes with a stable warning when remote inlining fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const container = document.createElement('div');
    container.innerHTML = '<p><img src="https://cdn.example.com/diagram.png" alt="Architecture"></p>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Image export failed: Failed to fetch');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://cdn.example.com/diagram.png');
    expect(snapshot.warnings).toContain('Failed to fetch');
  });

  it('sanitizes PlantUML SVG before mounting it into the export snapshot', async () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss = true"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><rect width="120" height="80" /></svg>',
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    }));

    const container = document.createElement('div');
    container.innerHTML = '<div class="plantuml-shell" data-plantuml-key="plantuml-1"><pre class="plantuml-source">@startuml\nAlice -&gt; Bob: Hello\n@enduml</pre></div>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('onload')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(snapshot.warnings).toHaveLength(0);
    expect(createObjectUrlSpy).toHaveBeenCalledWith(expect.any(Blob));
    expect(createObjectUrlSpy.mock.calls.at(-1)?.[0]?.type).toBe('image/svg+xml;charset=utf-8');
  });

  it('keeps SVG as the DOCX diagram source when browser rasterization fails', async () => {
    const OriginalImage = window.Image;
    class FailingImage {
      constructor() {
        this.decoding = 'async';
        this.listeners = {};
      }

      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }

      set src(value) {
        this.currentSrc = value;
        queueMicrotask(() => this.listeners.error?.(new Event('error')));
      }
    }
    window.Image = FailingImage;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" /></svg>',
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    }));

    const container = document.createElement('div');
    container.innerHTML = '<div class="plantuml-shell" data-plantuml-key="plantuml-fallback"><pre class="plantuml-source">@startuml\nAlice -&gt; Bob: Hello\n@enduml</pre></div>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    try {
      await resolveExportAssets(snapshot, { container });
    } finally {
      window.Image = OriginalImage;
    }

    const figure = container.querySelector('figure.export-diagram');
    expect(figure?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(snapshot.warnings).toHaveLength(0);

    const docxHtml = buildDocxHtmlDocument({
      html: container.innerHTML,
      title: 'README',
    });
    expect(docxHtml).toContain('src="data:image/svg+xml;charset=utf-8,');
  });

  it('renders Mermaid export labels as SVG text instead of foreignObject html labels', async () => {
    const container = document.createElement('div');
    container.innerHTML = [
      '<div class="mermaid-shell" data-mermaid-key="mermaid-1" data-mermaid-label="Mermaid diagram">',
      '  <pre class="mermaid-source">flowchart LR\nA[Source markdown] --&gt; B[Export snapshot]</pre>',
      '</div>',
    ].join('\n');
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('foreignObject')).toBeNull();
    const textContent = svg?.textContent || '';
    // dagre-wrapper word-wraps SVG labels across tspans (e.g. Source/markdown on
    // separate rows), so assert words instead of space-joined label strings.
    for (const word of ['Source', 'markdown', 'Export', 'snapshot']) {
      expect(textContent).toContain(word);
    }
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('renders YouTube video posters with a fetched thumbnail and original link', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('i.ytimg.com')) {
        return new Response(
          new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
          {
            headers: {
              'Content-Length': '10',
            },
            status: 200,
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const container = document.createElement('div');
    container.innerHTML = '<span class="video-embed-placeholder" data-video-embed-key="video-1" data-video-embed-kind="youtube" data-video-embed-label="Demo video" data-video-embed-original-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" data-video-embed-source="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" data-video-embed-url="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></span>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('.export-video-poster-image');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/);
    expect(container.querySelector('.export-video-link')?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(Object.keys(snapshot.assets)).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('renders direct video posters from a captured frame when canvas capture succeeds', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    const fakeVideo = originalCreateElement('video');
    let currentTime = 0;

    Object.defineProperty(fakeVideo, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(fakeVideo, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(fakeVideo, 'videoWidth', { configurable: true, value: 1280 });
    Object.defineProperty(fakeVideo, 'videoHeight', { configurable: true, value: 720 });
    Object.defineProperty(fakeVideo, 'currentTime', {
      configurable: true,
      get() {
        return currentTime;
      },
      set(value) {
        currentTime = value;
        window.setTimeout(() => fakeVideo.dispatchEvent(new Event('seeked')), 0);
      },
    });

    fakeVideo.load = vi.fn(() => {
      window.setTimeout(() => fakeVideo.dispatchEvent(new Event('loadeddata')), 0);
    });
    fakeVideo.pause = vi.fn();

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    }));
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,video-frame');
    document.createElement = vi.fn((tagName, options) => {
      if (String(tagName).toLowerCase() === 'video') {
        return fakeVideo;
      }
      return originalCreateElement(tagName, options);
    });

    const container = document.createElement('div');
    container.innerHTML = '<span class="video-embed-placeholder" data-video-embed-key="video-2" data-video-embed-kind="direct-video" data-video-embed-label="Public video" data-video-embed-original-url="https://cdn.example.com/demo.mp4" data-video-embed-source="https://cdn.example.com/demo.mp4" data-video-embed-url="https://cdn.example.com/demo.mp4" data-video-embed-mime-type="video/mp4"></span>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    try {
      await resolveExportAssets(snapshot, { container });
    } finally {
      document.createElement = originalCreateElement;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      HTMLCanvasElement.prototype.toDataURL = originalToDataUrl;
    }

    const image = container.querySelector('.export-video-poster-image');
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,video-frame');
    expect(container.querySelector('.export-video-link')?.getAttribute('href')).toBe('https://cdn.example.com/demo.mp4');
    expect(Object.keys(snapshot.assets)).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('flattens video posters into DOCX-friendly markup with image and link preserved', () => {
    const html = buildDocxHtmlDocument({
      html: [
        '<figure class="export-video-poster">',
        '  <div class="export-video-poster-card">',
        '    <div class="export-video-poster-media">',
        '      <img class="export-video-poster-image" src="data:image/webp;base64,preview" data-export-docx-src="data:image/png;base64,docxposter" alt="Demo video poster">',
        '    </div>',
        '    <div class="export-video-poster-copy">',
        '      <strong>Demo video</strong>',
        '      <span class="export-video-poster-meta">YouTube video</span>',
        '    </div>',
        '  </div>',
        '  <a class="export-video-link" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a>',
        '</figure>',
      ].join('\n'),
      title: 'README',
    });

    expect(html).toContain('class="export-video-poster-docx"');
    expect(html).toContain('src="data:image/png;base64,docxposter"');
    expect(html).toContain('<strong>Demo video</strong>');
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).not.toContain('<figure class="export-video-poster"');
  });

  it('builds a self-contained HTML document without DOCX-only image variants', () => {
    const html = buildHtmlDocument({
      html: [
        '<h1>Offline guide</h1>',
        '<figure class="export-diagram" data-export-docx-src="data:image/png;base64,duplicate">',
        '  <svg xmlns="http://www.w3.org/2000/svg" aria-label="Diagram"><text>Flow</text></svg>',
        '</figure>',
        '<img src="data:image/webp;base64,original" data-export-docx-src="data:image/png;base64,duplicate">',
      ].join('\n'),
      theme: 'dark',
      title: 'Guide <draft>',
    });
    const exportedDocument = new DOMParser().parseFromString(html, 'text/html');

    expect(exportedDocument.title).toBe('Guide <draft>');
    expect(exportedDocument.documentElement.dataset.theme).toBe('dark');
    expect(exportedDocument.body.dataset.theme).toBe('dark');
    expect(exportedDocument.querySelector('style')?.textContent).toContain('max-width: var(--preview-content-max-width, var(--preview-content-width))');
    expect(exportedDocument.querySelector('script')).toBeNull();
    expect(exportedDocument.querySelector('svg')?.textContent).toContain('Flow');
    expect(exportedDocument.querySelector('img')?.getAttribute('src')).toBe('data:image/webp;base64,original');
    expect(exportedDocument.querySelector('[data-export-docx-src]')).toBeNull();
  });

  it('appends caller-supplied math styles to the standalone HTML document', () => {
    const html = buildHtmlDocument(
      {
        html: '<p><span class="katex"><span class="katex-mathml">math</span></span></p>',
        theme: 'light',
        title: 'Math notes',
      },
      '.katex{font:1em KaTeX_Main;}',
    );

    expect(html).toContain('.katex{font:1em KaTeX_Main;}');
  });

  it('reshapes DOCX tables, blockquotes, and figures into border-friendly markup', () => {
    const html = buildDocxHtmlDocument({
      html: [
        '<div class="table-wrapper">',
        '  <table>',
        '    <thead><tr><th>Surface</th><th>What to show</th></tr></thead>',
        '    <tbody><tr><td>Editor</td><td>Preview</td></tr></tbody>',
        '  </table>',
        '</div>',
        '<blockquote><p>One local markdown vault becomes a collaborative browser workspace.</p></blockquote>',
        '<pre><code>{\n  "heroNote": "workspace-tour.md",\n  "linkedNotes": [\n    "README"\n  ]\n}</code></pre>',
        '<figure><img src="data:image/png;base64,diagram" alt="Diagram"></figure>',
      ].join('\n'),
      title: 'README',
    });

    expect(html).toContain('<table border="1"');
    expect(html).not.toContain('class="table-wrapper"');
    expect(html).toContain('border-collapse: collapse');
    expect(html).not.toContain('border-left: 4px solid');
    expect((html.match(/background: rgb\(99, 102, 241\)/g) || [])).toHaveLength(1);
    expect(html).toContain('One local markdown vault becomes a collaborative browser workspace.');
    expect(html).not.toContain('<blockquote>');
    expect(html).toContain('JetBrains Mono');
    expect(html).toContain('&nbsp;&nbsp;"heroNote":');
    expect(html).toContain('&nbsp;&nbsp;"linkedNotes":&nbsp;[');
    expect(html).toContain('&nbsp;&nbsp;&nbsp;&nbsp;"README"');
    expect(html).not.toContain('<pre><code>');
    expect(html).not.toContain('<figure><img');
  });

  it('replaces rendered math with OMML markers in DOCX markup', () => {
    const html = buildDocxHtmlDocument({
      html: [
        '<p>Inline <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">E = mc2</span></span> here.</p>',
        '<ul><li><p class="katex-block"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">ba</span></span></span></p></li></ul>',
      ].join('\n'),
      title: 'Math notes',
    });

    expect(html).toContain('COLLABMD-MATH-0');
    expect(html).toContain('COLLABMD-MATH-1');
    expect(html).toContain('data-mml="%3Cmath');
    expect(html).not.toContain('katex-html');
    expect(html).not.toContain('katex-mathml');
    expect(html).not.toContain('katex-display');
    expect(html).not.toContain('katex-block');
  });

  it('flattens task list labels to ballot-box text in DOCX markup', () => {
    const html = buildDocxHtmlDocument({
      html: [
        '<ul><li class="task-list-item"><label class="task-list-label"><input type="checkbox" checked data-task-checkbox="true"> Done task</label></li>',
        '<li class="task-list-item"><label class="task-list-label"><input type="checkbox" data-task-checkbox="true"> Open task</label></li></ul>',
      ].join('\n'),
      title: 'Tasks',
    });

    expect(html).toContain('\u2611 Done task');
    expect(html).toContain('\u2610 Open task');
    expect(html).not.toContain('<label');
    expect(html).not.toContain('<input');
  });

  it('drops insignificant whitespace but preserves pre blocks in DOCX markup', () => {
    const html = buildDocxHtmlDocument({
      html: [
        '<h2>Title</h2>',
        '<ul>',
        '<li>First <em>item</em> here</li>',
        '<li>Second</li>',
        '</ul>',
        '<pre><code>line one\n\nline three\n</code></pre>',
      ].join('\n'),
      title: 'Spacing',
    });

    expect(html).not.toMatch(/<\/h2>\s+<ul>/);
    expect(html).not.toMatch(/<\/li>\s+<li>/);
    expect(html).toContain('First <em>item</em> here');
    expect(html).toContain('line&nbsp;one');
    expect(html).toContain('line&nbsp;three');
  });

  it('emits a compact DOCX wrapper without phantom whitespace', () => {
    const html = buildDocxHtmlDocument({ html: '<p>Hi</p>', title: 'A & B' });

    expect(html).not.toContain('<!DOCTYPE');
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).not.toMatch(/<\/head>\s+<body>/);
    expect(html).not.toMatch(/<body>\s+<main>/);
    expect(html).not.toMatch(/<\/main>\s+<\/body>/);
  });

  it('builds one offline document for every markdown note in a folder', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const filePath = new URL(String(url), window.location.origin).searchParams.get('path');
      const content = filePath === 'docs/one.md'
        ? '# One\n\nContinue with [[two]].'
        : '# Two\n\nDone.';
      return new Response(JSON.stringify({ content }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    });

    const snapshot = await prepareDirectoryExportSnapshot({
      directoryPath: 'docs',
      fileList: ['docs/one.md', 'docs/two.md', 'docs/image.png', 'other.md'],
    });

    expect(snapshot.filePath).toBe('docs');
    expect(snapshot.title).toBe('docs');
    expect(snapshot.html).toContain('docs/one.md');
    expect(snapshot.html).toContain('docs/two.md');
    expect(snapshot.html).not.toContain('other.md');
    expect(snapshot.html).toContain('href="#export-doc-docs-2Ftwo-md"');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('opens folder exports with the selected directory in the bootstrap payload', async () => {
    const exportWindow = {
      closed: false,
      focus: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    };
    window.open = vi.fn(() => exportWindow);
    document.documentElement.dataset.theme = 'dark';
    initializeExportBridge();

    const jobId = await exportDirectory({
      directoryPath: 'docs',
      fileList: ['docs/one.md'],
      format: 'pdf',
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { jobId, source: 'collabmd-export-page', type: 'ready' },
      origin: window.location.origin,
    }));

    expect(window.open.mock.calls[0]).toEqual(['', jobId]);
    expect(new URL(exportWindow.location.replace.mock.calls[0][0]).pathname).toMatch(/\/export-document\.html$/u);
    expect(exportWindow.postMessage.mock.calls[0][0]).toMatchObject({
      action: 'pdf',
      directoryPath: 'docs',
      fileList: ['docs/one.md'],
      theme: 'light',
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: { jobId, source: 'collabmd-export-page', type: 'complete' },
      origin: window.location.origin,
    }));
  });

  it('cleans up export jobs when the popup closes before completion', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const exportWindow = {
      closed: false,
      focus: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    };

    window.open = vi.fn(() => exportWindow);
    initializeExportBridge({ onError });

    const jobId = await exportDocument({
      filePath: 'README.md',
      format: 'html',
      markdownText: '# Export',
      title: 'README',
    });

    expect(window.open.mock.calls[0]).toEqual(['', jobId]);
    expect(new URL(exportWindow.location.replace.mock.calls[0][0]).pathname).toMatch(/\/export-document\.html$/u);

    exportWindow.closed = true;
    vi.advanceTimersByTime(600);

    expect(onError).toHaveBeenCalledWith('Export window was closed before the export completed');

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        jobId,
        source: 'collabmd-export-page',
        type: 'ready',
      },
      origin: window.location.origin,
    }));

    expect(exportWindow.postMessage).not.toHaveBeenCalled();
  });

  it('groups headings with the following block for print pagination', () => {
    const container = document.createElement('div');
    container.innerHTML = [
      '<h2>Mermaid</h2>',
      '<figure class="export-diagram"><img src="data:image/png;base64,diagram" alt="Mermaid diagram"></figure>',
      '<h2>Code Sample</h2>',
      '<p>Lead-in copy.</p>',
      '<pre><code>const demo = true;</code></pre>',
    ].join('\n');

    groupHeadingWithFollowingBlock(container);

    const wrappers = container.querySelectorAll('.export-keep-with-next');
    expect(wrappers).toHaveLength(2);
    expect(Array.from(wrappers[0].children).map((node) => node.tagName)).toEqual(['H2', 'FIGURE']);
    expect(Array.from(wrappers[1].children).map((node) => node.tagName)).toEqual(['H2', 'P', 'PRE']);
  });

  it('waits for export images to finish decoding before serializing rendered html', async () => {
    const container = document.createElement('div');
    const image = document.createElement('img');

    Object.defineProperty(image, 'complete', {
      configurable: true,
      get() {
        return true;
      },
    });
    image.decode = vi.fn(() => new Promise((resolve) => {
      window.setTimeout(() => {
        image.setAttribute('data-decoded', 'true');
        resolve();
      }, 10);
    }));
    image.src = 'https://cdn.example.com/export.png';
    container.appendChild(image);

    const html = await waitForRenderedExportContent(container, {
      settleFrames: 0,
      timeoutMs: 200,
    });

    expect(html).toContain('data-decoded="true"');
    expect(image.decode).toHaveBeenCalledTimes(1);
  });

  it('renders excalidraw embeds through the lazily loaded runtimes', async () => {
    const scene = {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [{
        angle: 0,
        backgroundColor: 'transparent',
        boundElements: [],
        fillStyle: 'solid',
        groupIds: [],
        height: 80,
        id: 'rect-1',
        isDeleted: false,
        link: null,
        locked: false,
        opacity: 100,
        roughness: 1,
        roundness: { type: 3 },
        strokeColor: '#1e1e1e',
        strokeStyle: 'solid',
        strokeWidth: 2,
        type: 'rectangle',
        width: 120,
        x: 10,
        y: 10,
      }],
      files: {},
      source: 'collabmd-test',
      type: 'excalidraw',
      version: 2,
    };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ content: JSON.stringify(scene) }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }));

    const snapshot = await prepareExportSnapshot({
      fileList: ['notes/doc.md', 'art.excalidraw'],
      filePath: 'notes/doc.md',
      markdownText: '# Doc\n\n![[art.excalidraw]]\n',
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.html).toContain('<svg');
  }, 30000);
});
