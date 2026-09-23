import { resolveVaultRelativePath } from '../../domain/vault-paths.js';
import { resolveWikiTargetPath } from '../../domain/wiki-link-resolver.js';
import { PreviewRenderer } from '../application/preview-renderer.js';
import { canvasFilePath } from '../domain/canvas-view.js';
import { BasesPreviewController } from '../presentation/bases-preview-controller.js';
import { DrawioEmbedController } from '../presentation/drawio-embed-controller.js';
import { ExcalidrawEmbedController } from '../presentation/excalidraw-embed-controller.js';
import { VideoEmbedController } from '../presentation/video-embed-controller.js';

export function createCanvasMarkdownPreview({
  container, markdownText, sourceFilePath, subpath = '',
  getFileList, getLocalUser, getTheme, onOpenFile, vaultApiClient,
}) {
  const previewElement = document.createElement('div');
  previewElement.className = 'preview-content canvas-markdown-preview';
  container.append(previewElement);
  const options = {
    getActiveFilePath: () => sourceFilePath,
    getLocalUser, getTheme, onOpenFile,
    previewContainer: container.closest('.canvas-card-content'), previewElement, vaultApiClient,
  };
  const embeds = [
    new VideoEmbedController(options), new BasesPreviewController(options),
    new DrawioEmbedController(options), new ExcalidrawEmbedController(options),
  ];
  const syncLayout = () => embeds.forEach((embed) => embed.syncLayout?.());
  const renderer = new PreviewRenderer({
    ...options,
    getContent: () => markdownText,
    getFileList,
    getSourceFilePath: () => sourceFilePath,
    getSubpath: () => subpath,
    getWikiLinkAutoCreate: () => false,
    loadFileSource: async (path) => String((await vaultApiClient.readFile(path)).content ?? ''),
    plantUmlRenderClient: vaultApiClient,
    onBeforeRenderCommit: () => embeds.forEach((embed) => embed.detachForCommit?.()),
    onAfterRenderCommit: (_element, stats) => {
      embeds.forEach((embed) => embed.reconcileEmbeds(previewElement, stats));
      previewElement.querySelectorAll('[data-task-checkbox]').forEach((input) => { input.disabled = true; });
    },
    onPreviewLayoutChange: syncLayout,
  });
  const resizeObserver = new ResizeObserver(syncLayout);
  resizeObserver.observe(previewElement);

  const onClick = (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const wikiTarget = link.dataset.wikiTarget;
    if (wikiTarget) {
      event.preventDefault();
      const [target, anchor] = wikiTarget.split('#');
      const path = resolveWikiTargetPath(target, getFileList());
      if (path) onOpenFile(path, anchor ? `#${anchor}` : '');
    } else if (href.startsWith('#')) {
      event.preventDefault();
      let anchor;
      try { anchor = decodeURIComponent(href.slice(1)); } catch { return; }
      const heading = [...previewElement.querySelectorAll('[id]')].find((entry) => entry.id === anchor);
      if (heading) heading.scrollIntoView({ block: 'nearest' });
      else if (!anchor || anchor === 'top') options.previewContainer.scrollTo({ top: 0 });
      else onOpenFile(sourceFilePath, href);
    } else if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
      event.preventDefault();
      const [target, anchor] = href.split('#');
      let path;
      try { path = canvasFilePath(resolveVaultRelativePath(sourceFilePath, decodeURIComponent(target))); } catch { return; }
      if (path) onOpenFile(path, anchor ? `#${anchor}` : '');
    }
  };
  previewElement.addEventListener('click', onClick);
  renderer.queueRender();
  return {
    applyTheme(theme) {
      renderer.applyTheme(theme);
      embeds.forEach((embed) => embed.updateTheme?.(theme));
    },
    destroy() {
      resizeObserver.disconnect();
      previewElement.removeEventListener('click', onClick);
      renderer.destroy();
      embeds.forEach((embed) => embed.destroy());
      previewElement.remove();
    },
  };
}
