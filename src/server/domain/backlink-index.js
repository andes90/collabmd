/**
 * BacklinkIndex — an in-memory inverted index that tracks which files link
 * to which other files via [[wiki links]].
 *
 * Maintains two maps:
 *   forward: sourcePath → Set<targetPath>    (outgoing links from a file)
 *   reverse: targetPath → Set<sourcePath>    (incoming links to a file — backlinks)
 *
 * The index is built from the vault at startup, then kept in sync
 * incrementally whenever a file is persisted, created, deleted, or renamed.
 */

import { createWikiTargetIndex, resolveWikiTargetWithIndex } from '../../domain/wiki-link-resolver.js';

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export class BacklinkIndex {
  constructor({ vaultFileStore }) {
    this.vaultFileStore = vaultFileStore;
    /** @type {Map<string, Set<string>>} sourcePath → set of resolved target paths */
    this.forward = new Map();
    /** @type {Map<string, Set<string>>} targetPath → set of source paths */
    this.reverse = new Map();
    /** @type {Map<string, Map<string, string[]>>} sourcePath → targetPath → contexts[] */
    this.contextsBySource = new Map();
    /** @type {string[]} cached flat file list for link resolution */
    this._fileList = [];
    /** @type {Set<string>} file path membership set */
    this._fileSet = new Set();
    this._wikiTargetIndex = createWikiTargetIndex(this._fileList);
    this._built = false;
  }

  /**
   * Build the full index by scanning every markdown file in the vault.
   * Called once at server startup.
   */
  async build() {
    this.forward.clear();
    this.reverse.clear();
    this.contextsBySource.clear();

    const tree = await this.vaultFileStore.tree();
    this._fileList = flattenTree(tree);
    this._fileSet = new Set(this._fileList);
    this._refreshWikiTargetIndex();

    for (const filePath of this._fileList) {
      const content = await this.vaultFileStore.readMarkdownFile(filePath);
      if (content !== null) {
        this._indexFile(filePath, content);
      }
    }

    this._built = true;
    console.log(`[backlinks] Index built: ${this._fileList.length} files, ${this.reverse.size} targets with backlinks`);
  }

  /**
   * Incrementally update the index when a file's content changes.
   * Call this after every persist / write.
   */
  updateFile(filePath, content) {
    // Remove old forward links for this file
    this._removeForwardLinks(filePath);

    if (!this._fileSet.has(filePath)) {
      this._fileSet.add(filePath);
      this._fileList.push(filePath);
      this._refreshWikiTargetIndex();
    }

    // Re-index with new content
    this._indexFile(filePath, content);
  }

  /**
   * Handle file creation — add to file list and index its content.
   */
  onFileCreated(filePath, content = '') {
    if (!this._fileSet.has(filePath)) {
      this._fileSet.add(filePath);
      this._fileList.push(filePath);
      this._refreshWikiTargetIndex();
    }

    if (content) {
      this._indexFile(filePath, content);
    }
  }

  /**
   * Handle file deletion — remove from file list and all index entries.
   */
  onFileDeleted(filePath) {
    this._removeForwardLinks(filePath);
    if (this._fileSet.delete(filePath)) {
      this._fileList = this._fileList.filter((f) => f !== filePath);
      this._refreshWikiTargetIndex();
    }

    // Also remove this file as a reverse entry (no one can link to a deleted file)
    this.reverse.delete(filePath);
  }

  /**
   * Handle file rename — re-map all index entries from oldPath to newPath.
   */
  onFileRenamed(oldPath, newPath) {
    // Move cached contexts for the renamed source file.
    if (this.contextsBySource.has(oldPath)) {
      const sourceContexts = this.contextsBySource.get(oldPath);
      this.contextsBySource.delete(oldPath);
      this.contextsBySource.set(newPath, sourceContexts);
    }

    // Move forward links
    const oldForward = this.forward.get(oldPath);
    if (oldForward) {
      this.forward.delete(oldPath);
      this.forward.set(newPath, oldForward);

      // Update reverse entries: replace oldPath with newPath in all targets
      for (const targetPath of oldForward) {
        const sources = this.reverse.get(targetPath);
        if (sources) {
          sources.delete(oldPath);
          sources.add(newPath);
        }
      }
    }

    // Move reverse links (files that linked to oldPath now link to newPath)
    const oldReverse = this.reverse.get(oldPath);
    if (oldReverse) {
      this.reverse.delete(oldPath);
      const mergedReverse = this.reverse.has(newPath)
        ? new Set([...this.reverse.get(newPath), ...oldReverse])
        : oldReverse;
      this.reverse.set(newPath, mergedReverse);

      // Update forward entries: replace oldPath with newPath in all sources
      for (const sourcePath of oldReverse) {
        const targets = this.forward.get(sourcePath);
        if (targets) {
          targets.delete(oldPath);
          targets.add(newPath);
        }

        const sourceContexts = this.contextsBySource.get(sourcePath);
        if (sourceContexts?.has(oldPath)) {
          const previous = sourceContexts.get(newPath) ?? [];
          sourceContexts.set(newPath, [...previous, ...sourceContexts.get(oldPath)]);
          sourceContexts.delete(oldPath);
        }
      }
    }

    // Update file list
    if (this._fileSet.delete(oldPath)) {
      this._fileSet.add(newPath);
      this._fileList = this._fileList.map((f) => (f === oldPath ? newPath : f));
      this._refreshWikiTargetIndex();
    }
  }

  /**
   * Get all backlinks for a file, with context snippets.
   * Returns: [{ file: string, contexts: string[] }]
   */
  async getBacklinks(filePath) {
    const sources = this.reverse.get(filePath);
    if (!sources || sources.size === 0) {
      return [];
    }

    const results = [];

    for (const sourcePath of sources) {
      const sourceContexts = this.contextsBySource.get(sourcePath);
      const relevantContexts = sourceContexts?.get(filePath) ?? [];

      if (relevantContexts.length > 0) {
        results.push({
          file: sourcePath,
          contexts: [...relevantContexts],
        });
      }
    }

    // Sort by filename for stable ordering
    results.sort((a, b) => a.file.localeCompare(b.file));
    return results;
  }

  /**
   * Get the count of backlinks for a file (cheap — no I/O).
   */
  getBacklinkCount(filePath) {
    return this.reverse.get(filePath)?.size ?? 0;
  }

  // --- Private methods ---

  _indexFile(filePath, content) {
    const resolvedTargets = new Set();
    const contextsByTarget = new Map();
    const lines = content.split('\n');

    for (const line of lines) {
      WIKI_LINK_RE.lastIndex = 0;
      let match;
      while ((match = WIKI_LINK_RE.exec(line)) !== null) {
        const target = match[1].trim();
        if (!target) {
          continue;
        }

        const resolved = this._resolveTarget(target);
        if (!resolved || resolved === filePath) {
          continue;
        }

        resolvedTargets.add(resolved);

        if (!contextsByTarget.has(resolved)) {
          contextsByTarget.set(resolved, []);
        }
        contextsByTarget.get(resolved).push(line.trim());
      }
    }

    this.contextsBySource.delete(filePath);

    if (resolvedTargets.size > 0) {
      this.contextsBySource.set(filePath, contextsByTarget);
      this.forward.set(filePath, resolvedTargets);

      for (const targetPath of resolvedTargets) {
        if (!this.reverse.has(targetPath)) {
          this.reverse.set(targetPath, new Set());
        }
        this.reverse.get(targetPath).add(filePath);
      }
    }
  }

  _removeForwardLinks(filePath) {
    this.contextsBySource.delete(filePath);

    const oldTargets = this.forward.get(filePath);
    if (!oldTargets) return;

    for (const targetPath of oldTargets) {
      const sources = this.reverse.get(targetPath);
      if (sources) {
        sources.delete(filePath);
        if (sources.size === 0) {
          this.reverse.delete(targetPath);
        }
      }
    }

    this.forward.delete(filePath);
  }

  /**
   * Resolve a wiki-link target string to a vault file path.
   * Same logic as the client's resolveWikiTarget.
   */
  _resolveTarget(target) {
    return resolveWikiTargetWithIndex(target, this._wikiTargetIndex);
  }

  _refreshWikiTargetIndex() {
    this._wikiTargetIndex = createWikiTargetIndex(this._fileList);
  }
}

/** Flatten a vault tree into an array of file paths. */
function flattenTree(nodes) {
  const files = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push(node.path);
    } else if (node.children) {
      files.push(...flattenTree(node.children));
    }
  }
  return files;
}
