import { createHeadingSlug } from '../domain/markdown-headings.js';
import { createMarkdownStarter, normalizeVaultPathInput } from '../domain/vault-paths.js';
import { resolveWikiTargetPath } from '../../domain/wiki-link-resolver.js';

export class WikiLinkFileController {
  constructor(options = {}) {
    Object.assign(this, options);
    this.wikiLinkAutoCreate = options.wikiLinkAutoCreate ?? true;
  }

  handleWikiLinkClick(target) {
    const [path, heading] = String(target ?? '').split('#', 2);
    const trimmedPath = path.trim();
    const route = heading?.trim() ? { anchor: createHeadingSlug(heading) } : undefined;
    const match = trimmedPath
      ? resolveWikiTargetPath(trimmedPath, this.getFileList())
      : this.getCurrentFilePath?.();
    if (match) {
      if (route) this.navigation.navigateToFile(match, route);
      else this.navigation.navigateToFile(match);
      return;
    }

    if (!this.wikiLinkAutoCreate) {
      this.toastController.show('Wiki-link target does not exist');
      return;
    }

    const normalizedPath = this.normalizeNewWikiFilePath(trimmedPath);
    if (!normalizedPath) {
      this.toastController.show('Cannot create an empty wiki-link target');
      return;
    }

    void this.createAndOpenFile(normalizedPath, trimmedPath, route);
  }

  normalizeNewWikiFilePath(target) {
    const normalized = normalizeVaultPathInput(target);
    return !normalized ? null : (normalized.endsWith('.md') ? normalized : `${normalized}.md`);
  }

  async createAndOpenFile(filePath, displayName, route) {
    try {
      await this.vaultApiClient.createFile({
        content: createMarkdownStarter(displayName || filePath),
        path: filePath,
      });
      await this.refreshExplorer();
      if (route) this.navigation.navigateToFile(filePath, route);
      else this.navigation.navigateToFile(filePath);
    } catch (error) {
      this.toastController.show(`Failed to create file: ${error.message}`);
    }
  }
}
