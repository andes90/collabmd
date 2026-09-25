import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { getVaultFileKind, isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { mapWithConcurrency } from '../../shared/async-utils.js';
import { createEmptyStats } from './responses.js';
import { splitContentLines } from './parsers.js';
import { getImageMimeType } from '../../shared/image-mime.js';

async function countFileLines(filePath) {
  if (isImageAttachmentFilePath(filePath)) {
    return 0;
  }

  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: 'utf8' }),
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
      try {
        return await countFileLines(join(this.vaultDir, file.path));
      } catch {
        return 0;
      }
    });

    return counts.reduce((total, count) => total + count, 0);
  }

  async buildSyntheticDiffs(files = []) {
    const results = await mapWithConcurrency(files, 2, async (file) => {
      try {
        const absolutePath = join(this.vaultDir, file.path);
        if (isImageAttachmentFilePath(file.path)) {
          const content = await readFile(absolutePath);
          return {
            ...file,
            binaryMessage: 'Binary image file',
            byteLength: content.byteLength,
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

        const content = await readFile(absolutePath, 'utf8');
        return buildSyntheticAddedFileDiff(file.path, content);
      } catch {
        return null;
      }
    });

    return results.filter(Boolean);
  }
}
