import { createMarkdownStarter, normalizeVaultPathInput } from '../domain/vault-paths.js';
import { resolveWikiTargetPath } from '../../domain/wiki-link-resolver.js';

export class WikiLinkFileController {
  constructor(options = {}) {
    Object.assign(this, options);
    this.wikiLinkAutoCreate = options.wikiLinkAutoCreate ?? true;
  }

  handleWikiLinkClick(target) {
    const match = resolveWikiTargetPath(target, this.getFileList());
    if (match) {
      this.navigation.navigateToFile(match);
      return;
    }

    if (!this.wikiLinkAutoCreate) {
      this.toastController.show('Wiki-link target does not exist');
      return;
    }

    const normalizedPath = this.normalizeNewWikiFilePath(target);
    if (!normalizedPath) {
      this.toastController.show('Cannot create an empty wiki-link target');
      return;
    }

    void this.createAndOpenFile(normalizedPath, target);
  }

  normalizeNewWikiFilePath(target) {
    const normalized = normalizeVaultPathInput(target);
    return !normalized ? null : (normalized.endsWith('.md') ? normalized : `${normalized}.md`);
  }

  async createAndOpenFile(filePath, displayName) {
    try {
      await this.vaultApiClient.createFile({
        content: createMarkdownStarter(displayName || filePath),
        path: filePath,
      });
      await this.refreshExplorer();
      this.navigation.navigateToFile(filePath);
    } catch (error) {
      this.toastController.show(`Failed to create file: ${error.message}`);
    }
  }
}
