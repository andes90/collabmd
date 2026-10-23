import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';

import { getVaultFileKind, isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { mapWithConcurrency } from '../../shared/async-utils.js';
import { createEmptyStats } from './responses.js';
import { splitContentLines } from './parsers.js';
import { getImageMimeType } from '../../shared/image-mime.js';
import { sanitizeVaultPath } from '../persistence/path-utils.js';

// Node does not expose Darwin's flag for rejecting symlinks in every path component.
const DARWIN_O_NOFOLLOW_ANY = 0x20000000;

async function countFileLines(file) {
  const lines = createInterface({
    crlfDelay: Infinity,
    input: file.createReadStream({ autoClose: false, encoding: 'utf8' }),
  });
  let lineCount = 0;

  for await (const line of lines) {
    if (typeof line === 'string') {
      lineCount += 1;
    }
  }

  return lineCount;
}

function buildSyntheticAddedFileDiff(pathValue, content) {
  const normalizedContent = String(content ?? '').replace(/\r\n/g, '\n');
  const file = {
    code: 'U',
    fileKind: getVaultFileKind(pathValue),
    hunks: [],
    isBinary: false,
    oldPath: null,
    path: pathValue,
    stats: createEmptyStats(),
    status: 'untracked',
    synthetic: true,
  };
  const lines = splitContentLines(normalizedContent);

  if (lines.length === 0) {
    return file;
  }

  file.stats.additions = lines.length;
  file.hunks.push({
    header: `@@ -0,0 +1,${lines.length} @@`,
    lines: lines.map((line, index) => ({
      content: line,
      newLine: index + 1,
      oldLine: null,
      type: 'addition',
    })),
    newLines: lines.length,
    newStart: 1,
    oldLines: 0,
    oldStart: 0,
    section: '',
  });

  return file;
}

export class GitUntrackedFileService {
  constructor({ vaultDir }) {
    this.vaultDir = vaultDir;
  }

  async countAdditions(files = []) {
    const counts = await mapWithConcurrency(files, 4, async (file) => {
      let handle;
      try {
        if (isImageAttachmentFilePath(file.path)) return 0;
        handle = await this.openFile(file.path);
        return handle ? await countFileLines(handle) : 0;
      } catch {
        return 0;
      } finally {
        await handle?.close();
      }
    });

    return counts.reduce((total, count) => total + count, 0);
  }

  resolvePath(path) {
    return sanitizeVaultPath(this.vaultDir, path, { allowIgnored: true, preservePath: true });
  }

  async openFile(path) {
    const absolutePath = this.resolvePath(path);
    if (!absolutePath) return null;
    const root = await realpath(this.vaultDir);
    const relativePath = relative(this.vaultDir, absolutePath);
    const flags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;
    let handle;
    if (process.platform === 'darwin') {
      handle = await open(join(root, relativePath), constants.O_RDONLY | constants.O_NONBLOCK | DARWIN_O_NOFOLLOW_ANY);
    } else if (process.platform === 'linux') {
      // Pin each directory so replacing a parent cannot redirect the next open.
      let directory = await open(root, flags | constants.O_DIRECTORY);
      try {
        const segments = relativePath.split(sep);
        for (const segment of segments.slice(0, -1)) {
          const child = await open(`/proc/self/fd/${directory.fd}/${segment}`, flags | constants.O_DIRECTORY);
          await directory.close();
          directory = child;
        }
        handle = await open(`/proc/self/fd/${directory.fd}/${segments.at(-1)}`, flags);
      } finally {
        await directory.close();
      }
    } else {
      throw new Error('Secure untracked file reads require Linux or macOS');
    }
    try {
      if ((await handle.stat()).isFile()) return handle;
      await handle.close();
      return null;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async getByteLength(path) {
    let handle;
    try {
      handle = await this.openFile(path);
      return handle ? (await handle.stat()).size : 0;
    } catch {
      return 0;
    } finally {
      await handle?.close();
    }
  }

  async buildSyntheticDiffs(files = []) {
    const results = await mapWithConcurrency(files, 2, async (file) => {
      let handle;
      try {
        handle = await this.openFile(file.path);
        if (!handle) return null;
        if (isImageAttachmentFilePath(file.path)) {
          return {
            ...file,
            binaryMessage: 'Binary image file',
            byteLength: (await handle.stat()).size,
            code: file.code || 'U',
            fileKind: 'image',
            hunks: [],
            isBinary: true,
            mimeType: getImageMimeType(file.path),
            oldPath: file.oldPath ?? null,
            path: file.path,
            stats: createEmptyStats(),
            status: file.status || 'untracked',
            synthetic: true,
          };
        }

        const content = await handle.readFile('utf8');
        return buildSyntheticAddedFileDiff(file.path, content);
      } catch {
        return null;
      } finally {
        await handle?.close();
      }
    });

    return results.filter(Boolean);
  }
}
