import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, normalize, relative, resolve } from 'path';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);
const IGNORED_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.DS_Store']);

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isIgnored(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

function sanitizePath(vaultDir, requestedPath) {
  const normalized = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const absolute = resolve(vaultDir, normalized);
  const vaultRoot = vaultDir.endsWith('/') ? vaultDir : `${vaultDir}/`;

  if (!absolute.startsWith(vaultRoot) && absolute !== vaultDir) {
    return null;
  }

  return absolute;
}

export class VaultFileStore {
  constructor({ vaultDir }) {
    this.vaultDir = resolve(vaultDir);
  }

  async tree() {
    return this.readDirectory(this.vaultDir);
  }

  async readDirectory(dirPath) {
    const entries = [];

    let dirEntries;
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    const sorted = dirEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of sorted) {
      if (isIgnored(entry.name)) continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(this.vaultDir, fullPath);

      if (entry.isDirectory()) {
        const children = await this.readDirectory(fullPath);
        if (children.length > 0) {
          entries.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            children,
          });
        }
      } else if (isMarkdownFile(entry.name)) {
        entries.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
        });
      }
    }

    return entries;
  }

  async readMarkdownFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMarkdownFile(absolute)) {
      return null;
    }

    try {
      const content = await readFile(absolute, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeMarkdownFile(filePath, content) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMarkdownFile(absolute)) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, content, 'utf-8');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async createFile(filePath, content = '') {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMarkdownFile(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .md' };
    }

    try {
      await stat(absolute);
      return { ok: false, error: 'File already exists' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const dir = dirname(absolute);
    await mkdir(dir, { recursive: true });
    await writeFile(absolute, content, 'utf-8');
    return { ok: true };
  }

  async deleteFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMarkdownFile(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .md' };
    }

    try {
      await rm(absolute, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async renameFile(oldPath, newPath) {
    const absoluteOld = sanitizePath(this.vaultDir, oldPath);
    const absoluteNew = sanitizePath(this.vaultDir, newPath);

    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error: 'Invalid file path' };
    }

    if (!isMarkdownFile(absoluteOld)) {
      return { ok: false, error: 'Old path must end in .md' };
    }

    if (!isMarkdownFile(absoluteNew)) {
      return { ok: false, error: 'New path must end in .md' };
    }

    try {
      const dir = dirname(absoluteNew);
      await mkdir(dir, { recursive: true });
      await rename(absoluteOld, absoluteNew);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async createDirectory(dirPath) {
    const absolute = sanitizePath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error: 'Invalid directory path' };
    }

    try {
      await mkdir(absolute, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async countMarkdownFiles() {
    return this.countFilesInDir(this.vaultDir);
  }

  async countFilesInDir(dirPath) {
    let count = 0;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (isIgnored(entry.name)) continue;
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        count += await this.countFilesInDir(fullPath);
      } else if (isMarkdownFile(entry.name)) {
        count += 1;
      }
    }

    return count;
  }

  resolveWikiLink(linkTarget) {
    const normalized = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
    const absolute = sanitizePath(this.vaultDir, normalized);
    if (!absolute) return null;
    return relative(this.vaultDir, absolute);
  }
}
