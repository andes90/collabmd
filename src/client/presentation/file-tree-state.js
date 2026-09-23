import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { normalizeVaultPathInput } from '../domain/vault-paths.js';

export function flattenTree(nodes, files = [], searchEntries = [], fileEntries = []) {
  for (const node of nodes) {
    if (!node?.path || !node?.type) {
      continue;
    }

    searchEntries.push({
      lowerPath: String(node.path).toLowerCase(),
      name: node.name,
      path: node.path,
      type: node.type,
    });

    if (node.type !== 'directory') {
      files.push(node.path);
      fileEntries.push({
        mtimeMs: node.mtimeMs,
        path: node.path,
      });
      continue;
    }

    if (node.type === 'directory' && Array.isArray(node.children)) {
      flattenTree(node.children, files, searchEntries, fileEntries);
    }
  }

  return { fileEntries, files, searchEntries };
}

function findNodeByPath(nodes, pathValue) {
  for (const node of nodes ?? []) {
    if (node?.path === pathValue) {
      return node;
    }

    if (node?.type === 'directory' && Array.isArray(node.children)) {
      const nested = findNodeByPath(node.children, pathValue);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function countDirectoryDescendants(node) {
  let directoryCount = 0;
  let fileCount = 0;

  for (const child of node?.children ?? []) {
    if (child?.type === 'directory') {
      directoryCount += 1;
      const nestedCounts = countDirectoryDescendants(child);
      directoryCount += nestedCounts.directoryCount;
      fileCount += nestedCounts.fileCount;
      continue;
    }

    fileCount += 1;
  }

  return { directoryCount, fileCount };
}

function replacePathPrefix(pathValue, oldPrefix, newPrefix) {
  if (pathValue === oldPrefix) {
    return newPrefix;
  }

  return `${newPrefix}${pathValue.slice(oldPrefix.length)}`;
}

export class FileTreeState {
  constructor() {
    this.tree = [];
    this.flatFiles = [];
    this.flatDocumentFiles = [];
    this.flatFileEntries = [];
    this.flatSearchEntries = [];
    this.activeFilePath = null;
    this.expandedDirs = new Set();
    this.searchQuery = '';
  }

  setTree(tree) {
    this.tree = Array.isArray(tree) ? tree : [];
    const flattened = flattenTree(this.tree, [], [], []);
    this.flatFiles = flattened.files;
    this.flatDocumentFiles = flattened.files.filter((path) => !isImageAttachmentFilePath(path));
    this.flatFileEntries = flattened.fileEntries;
    this.flatSearchEntries = flattened.searchEntries;
  }

  setSearchQuery(value) {
    this.searchQuery = String(value ?? '');
  }

  getSearchMatches() {
    const normalizedQuery = this.searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    return this.flatSearchEntries
      .filter((entry) => entry.type !== 'directory' && entry.lowerPath.includes(normalizedQuery))
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
      }));
  }

  getNode(pathValue) {
    return findNodeByPath(this.tree, pathValue);
  }

  getDirectoryDescendantSummary(pathValue) {
    const node = this.getNode(pathValue);
    if (!node || node.type !== 'directory') {
      return { directoryCount: 0, fileCount: 0 };
    }

    return countDirectoryDescendants(node);
  }

  setActiveFile(filePath) {
    this.activeFilePath = filePath || null;

    if (filePath) {
      this.expandDirectoryPath(filePath, { includeLeaf: false });
    }
  }

  toggleDirectory(pathValue) {
    if (this.expandedDirs.has(pathValue)) {
      this.expandedDirs.delete(pathValue);
      return false;
    }

    this.expandedDirs.add(pathValue);
    return true;
  }

  expandDirectoryPath(pathValue, { includeLeaf = true } = {}) {
    const normalized = normalizeVaultPathInput(pathValue);
    if (!normalized) {
      return;
    }

    const segments = normalized.split('/');
    const segmentCount = includeLeaf ? segments.length : Math.max(segments.length - 1, 0);
    let currentPath = '';

    for (let index = 0; index < segmentCount; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      this.expandedDirs.add(currentPath);
    }
  }

  replaceExpandedDirectoryPrefix(oldPath, newPath) {
    const nextExpandedDirs = new Set();
    this.expandedDirs.forEach((pathValue) => {
      if (pathValue === oldPath || pathValue.startsWith(`${oldPath}/`)) {
        nextExpandedDirs.add(replacePathPrefix(pathValue, oldPath, newPath));
        return;
      }

      nextExpandedDirs.add(pathValue);
    });
    this.expandedDirs = nextExpandedDirs;
  }

  removeExpandedDirectoryPrefix(pathValue) {
    const nextExpandedDirs = new Set();
    this.expandedDirs.forEach((expandedPath) => {
      if (expandedPath === pathValue || expandedPath.startsWith(`${pathValue}/`)) {
        return;
      }

      nextExpandedDirs.add(expandedPath);
    });
    this.expandedDirs = nextExpandedDirs;
  }
}
