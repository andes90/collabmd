import { compilePreviewDocument } from './preview-render-compiler.js';

self.onmessage = (event) => {
  const {
    attachmentApiPath,
    fileList,
    frontmatterCollapsed,
    frontmatterInteractive,
    markdownText,
    renderVersion,
    sourceFilePath,
    subpath,
    wikiLinkAutoCreate,
  } = event.data ?? {};

  try {
    const result = compilePreviewDocument({
      attachmentApiPath,
      fileList,
      frontmatterCollapsed,
      frontmatterInteractive,
      markdownText,
      sourceFilePath,
      subpath,
      wikiLinkAutoCreate,
    });
    self.postMessage({
      html: result.html,
      renderVersion,
      stats: result.stats,
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      renderVersion,
    });
  }
};
