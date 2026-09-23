import { afterEach, expect, it } from 'vitest';

import { WorkspacePreviewController } from '../../src/client/application/workspace-preview-controller.js';
import { CanvasEmbedController } from '../../src/client/presentation/canvas-embed-controller.js';
import '../../src/client/styles/base.css';
import '../../src/client/styles/style.css';

afterEach(() => {
  document.body.className = '';
});

it('gates untrusted HTML scripts behind per-render consent', async () => {
  const previewContent = document.createElement('div');
  const renderHost = document.createElement('div');
  const embed = { detachForCommit() {} };
  const controller = new WorkspacePreviewController({
    backlinksPanel: { clear() {} },
    drawioEmbed: embed,
    elements: { previewContent },
    excalidrawEmbed: embed,
    getDisplayName: (filePath) => filePath,
    getSession: () => null,
    layoutController: {},
    outlineController: { close() {} },
    previewRenderer: {
      ensureRenderHost: () => renderHost,
      normalizePreviewChildren() {},
    },
    scrollSyncController: {
      invalidatePreviewBlocks() {},
      setLargeDocumentMode() {},
    },
  });

  let scriptMessage = null;
  let resolveScriptMessage;
  const scriptMessagePromise = new Promise((resolve) => {
    resolveScriptMessage = resolve;
  });
  const handleMessage = (event) => {
    if (event.data?.source === 'html-preview-test') {
      scriptMessage = { ...event.data, origin: event.origin };
      resolveScriptMessage(scriptMessage);
    }
  };
  window.addEventListener('message', handleMessage);

  controller.renderHtmlFilePreview({
    content: `<a href="#target">Jump</a><div id="target">Target</div><script>
document.querySelector('a').click();
setTimeout(() => parent.postMessage({ source: 'html-preview-test', hash: location.hash, target: Boolean(document.getElementById('target')) }, '*'));
</script>`,
  });

  let shell = renderHost.firstElementChild;
  const iframe = shell.querySelector('iframe');
  const initialLoad = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  document.body.append(renderHost);
  await initialLoad;

  expect(shell.className).toBe('html-file-preview-shell');
  expect(iframe.getAttribute('sandbox')).toBe('');
  expect(iframe.referrerPolicy).toBe('no-referrer');
  expect(iframe.getAttribute('allow')).toContain("camera 'none'");
  expect(iframe.srcdoc).toContain("default-src 'none'");
  expect(iframe.srcdoc).toContain("connect-src 'none'");
  expect(iframe.srcdoc).toContain("script-src 'none'");
  expect(iframe.srcdoc).toContain('<base href="about:srcdoc">');
  expect(scriptMessage).toBeNull();
  expect(previewContent.dataset.renderPhase).toBe('ready');

  const runScriptsButton = shell.querySelector('.html-file-preview-script-gate button');
  expect(runScriptsButton.textContent).toBe('Run scripts');
  runScriptsButton.click();

  expect(await scriptMessagePromise).toEqual({
    hash: '#target',
    origin: 'null',
    source: 'html-preview-test',
    target: true,
  });
  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  expect(iframe.srcdoc).toContain("script-src 'unsafe-inline'");
  expect(shell.querySelector('.html-file-preview-script-gate')).toBeNull();

  controller.renderHtmlFilePreview({ content: '<button onclick="alert(1)">Changed</button>' });
  shell = renderHost.firstElementChild;
  expect(shell.querySelector('iframe').getAttribute('sandbox')).toBe('');
  expect(shell.querySelector('iframe').srcdoc).toContain("script-src 'none'");
  expect(shell.querySelector('.html-file-preview-script-gate')).not.toBeNull();

  controller.renderHtmlFilePreview({ content: '<p>No scripts</p>' });
  shell = renderHost.firstElementChild;
  expect(shell.querySelector('.html-file-preview-script-gate')).toBeNull();

  controller.setHtmlPreviewMaximized(true);
  expect(shell.classList.contains('is-maximized')).toBe(true);
  expect(document.body.classList.contains('html-preview-maximized-open')).toBe(true);
  controller.renderHtmlFilePreview({ content: '<p>Updated while maximized</p>' });
  shell = renderHost.firstElementChild;
  expect(shell.classList.contains('is-maximized')).toBe(true);
  expect(document.body.classList.contains('html-preview-maximized-open')).toBe(true);
  expect(shell.querySelector('iframe').srcdoc).toContain('Updated while maximized');
  controller.setHtmlPreviewMaximized(false);
  expect(document.body.classList.contains('html-preview-maximized-open')).toBe(false);

  controller.resetPreviewLayoutSync();
  window.removeEventListener('message', handleMessage);
  renderHost.remove();
});

it('mounts the canvas frame across the available preview and removes it when leaving', () => {
  const fixture = document.createElement('div');
  fixture.style.width = '900px';
  fixture.style.height = '600px';
  fixture.innerHTML = '<div class="preview-content"><div data-preview-render-host="true"></div></div>';
  document.body.append(fixture);
  const previewContent = fixture.firstElementChild;
  const renderHost = previewContent.firstElementChild;
  const canvasEmbed = new CanvasEmbedController({ getTheme: () => 'light' });
  const embed = { detachForCommit() {}, reconcileEmbeds() {} };
  const controller = new WorkspacePreviewController({
    backlinksPanel: { clear() {} },
    canvasEmbed,
    drawioEmbed: embed,
    elements: { previewContent },
    excalidrawEmbed: embed,
    getSession: () => null,
    outlineController: { close() {} },
    previewRenderer: { ensureRenderHost: () => renderHost, normalizePreviewChildren() {} },
    scrollSyncController: { invalidatePreviewBlocks() {}, setLargeDocumentMode() {} },
  });
  try {
    controller.renderCanvasFilePreview('ideas.canvas');
    const frame = renderHost.querySelector('iframe');
    expect(frame.title).toBe('Canvas: ideas.canvas');
    expect(new URL(frame.src).searchParams.get('file')).toBe('ideas.canvas');
    frame.src = 'about:blank';
    expect(frame.getBoundingClientRect().height).toBeGreaterThan(550);
    expect(frame.getBoundingClientRect().width).toBeGreaterThan(850);
    controller.resetPreviewMode();
    expect(renderHost.querySelector('iframe')).toBeNull();
    expect(previewContent.classList.contains('is-canvas-file-preview')).toBe(false);
  } finally {
    canvasEmbed.unmount();
    fixture.remove();
  }
});
