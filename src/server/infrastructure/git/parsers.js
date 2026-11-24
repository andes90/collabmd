import { decodeQuotedPath, stripDiffPrefix } from './path-utils.js';
import { createEmptyBranchStatus, createStatusInfo } from './responses.js';

function parseBranchLine(line) {
  const result = {
    ...createEmptyBranchStatus(),
    hasCommits: true,
  };

  if (!line.startsWith('## ')) {
    return result;
  }

  const branchText = line.slice(3).trim();
  if (!branchText) {
    return result;
  }

  if (branchText.startsWith('No commits yet on ')) {
    result.name = branchText.slice('No commits yet on '.length);
    result.hasCommits = false;
    return result;
  }

  if (branchText.startsWith('HEAD (no branch)')) {
    result.name = 'HEAD';
    result.detached = true;
    return result;
  }

  const metadataIndex = branchText.indexOf(' [');
  const branchSegment = metadataIndex === -1
    ? branchText
    : branchText.slice(0, metadataIndex);
  const metadataSegment = metadataIndex === -1
    ? ''
    : branchText.slice(metadataIndex + 2, -1);
  const [name, upstream] = branchSegment.split('...');

  result.name = name || null;
  result.upstream = upstream || null;

  if (metadataSegment) {
    for (const token of metadataSegment.split(',')) {
      const value = token.trim();
      if (value.startsWith('ahead ')) {
        result.ahead = Number.parseInt(value.slice(6), 10) || 0;
      } else if (value.startsWith('behind ')) {
        result.behind = Number.parseInt(value.slice(7), 10) || 0;
      }
    }
  }

  return result;
}

function parseHunkHeader(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u);
  if (!match) {
    return null;
  }

  return {
    header: line,
    newLines: Number.parseInt(match[4] ?? '1', 10),
    newStart: Number.parseInt(match[3], 10),
    oldLines: Number.parseInt(match[2] ?? '1', 10),
    oldStart: Number.parseInt(match[1], 10),
    section: match[5]?.trim() || '',
  };
}

function finalizeFile(file) {
  if (!file) {
    return null;
  }

  if (file.oldPath === file.path) {
    file.oldPath = null;
  }

  return file;
}

export function splitContentLines(content) {
  const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function parseStatusOutput(output) {
  const records = String(output ?? '').split('\0');
  const branch = parseBranchLine(records.shift() || '');
  const sections = {
    staged: [],
    'working-tree': [],
    untracked: [],
  };
  const uniquePaths = new Set();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) {
      continue;
    }

    const indexStatus = record[0];
    const workTreeStatus = record[1];
    const path = record.slice(3);

    if (indexStatus === '!' && workTreeStatus === '!') {
      continue;
    }

    if (indexStatus === '?' && workTreeStatus === '?') {
      const file = {
        ...createStatusInfo('?'),
        oldPath: null,
        path,
        scope: 'untracked',
      };
      sections.untracked.push(file);
      uniquePaths.add(file.path);
      continue;
    }

    const hasSourcePath = ['R', 'C'].includes(indexStatus) || ['R', 'C'].includes(workTreeStatus);
    const oldPath = hasSourcePath ? records[index + 1] || null : null;
    if (hasSourcePath) {
      index += 1;
    }

    if (indexStatus !== ' ') {
      const file = {
        ...createStatusInfo(indexStatus),
        oldPath,
        path,
        scope: 'staged',
      };
      sections.staged.push(file);
      uniquePaths.add(file.path);
    }

    if (workTreeStatus !== ' ') {
      const file = {
        ...createStatusInfo(workTreeStatus),
        oldPath,
        path,
        scope: 'working-tree',
      };
      sections['working-tree'].push(file);
      uniquePaths.add(file.path);
    }
  }

  return {
    branch,
    sections,
    summary: {
      changedFiles: uniquePaths.size,
      staged: sections.staged.length,
      untracked: sections.untracked.length,
      workingTree: sections['working-tree'].length,
    },
  };
}

export function parseGitLogHeader(headerLine) {
  const [
    hash = '',
    shortHash = '',
    subject = '',
    authorName = '',
    authorEmail = '',
    authoredAt = '',
    rawParents = '',
  ] = String(headerLine ?? '').split('\x1f');
  const parentHashes = rawParents.split(' ').map((value) => value.trim()).filter(Boolean);

  return {
    authorEmail,
    authorName,
    authoredAt,
    hash,
    isMergeCommit: parentHashes.length > 1,
    parentCount: parentHashes.length,
    parentHashes,
    shortHash,
    subject,
  };
}

function parseNumstatLine(line) {
  const [rawAdditions = '0', rawDeletions = '0', ...rest] = String(line ?? '').split('\t');
  return {
    additions: rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions, 10) || 0,
    deletions: rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions, 10) || 0,
    rawPath: rest.join('\t'),
  };
}

export function parseNumstatOutput(output) {
  return parseNumstatEntries(output).reduce((summary, entry) => ({
    additions: summary.additions + entry.additions,
    deletions: summary.deletions + entry.deletions,
  }), {
    additions: 0,
    deletions: 0,
  });
}

export function parseNumstatEntries(output) {
  return String(output ?? '')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => parseNumstatLine(line));
}

export function parseNulNumstatEntries(output) {
  const fields = String(output ?? '').split('\0');
  const entries = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const entry = parseNumstatLine(fields[index]);
    if (entry.rawPath) {
      entries.push({ ...entry, path: entry.rawPath, oldPath: null });
    } else {
      const oldPath = fields[++index];
      const path = fields[++index];
      if (path && oldPath) entries.push({ ...entry, path, oldPath });
    }
  }
  return entries;
}

export function parseNameStatusOutput(output) {
  const summary = { changedPaths: [], deletedPaths: [], renamedPaths: [] };
  for (const entry of parseNameStatusEntries(output)) {
    if ((entry.code === 'R' || entry.code === 'C') && entry.oldPath && entry.oldPath !== entry.path) {
      summary.renamedPaths.push({ newPath: entry.path, oldPath: entry.oldPath });
    } else if (entry.code === 'D') {
      summary.deletedPaths.push(entry.path);
    } else {
      summary.changedPaths.push(entry.path);
    }
  }
  return summary;
}

export function parseNameStatusEntries(output) {
  return String(output ?? '')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [rawStatus = '', ...parts] = line.split('\t');
      const statusToken = rawStatus.trim().toUpperCase();
      if (!statusToken) {
        return null;
      }

      if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
        const [oldPath = '', path = ''] = parts.map((value) => decodeQuotedPath(value));
        return {
          ...createStatusInfo(statusToken[0]),
          oldPath: oldPath || null,
          path: path || null,
        };
      }

      const [path = ''] = parts.map((value) => decodeQuotedPath(value));
      return {
        ...createStatusInfo(statusToken[0]),
        oldPath: null,
        path: path || null,
      };
    })
    .filter((entry) => entry?.path);
}

export function countPatchLines(file = null) {
  return (file?.hunks ?? []).reduce((total, hunk) => total + (hunk.lines?.length ?? 0), 0);
}

function parseDiffHeaderPaths(paths) {
  const quotedPaths = paths.match(/^("(?:[^"\\]|\\.)*") (.+)$|^(.+) ("(?:[^"\\]|\\.)*")$/u);
  if (quotedPaths) {
    return [stripDiffPrefix(quotedPaths[1] ?? quotedPaths[3]), stripDiffPrefix(quotedPaths[2] ?? quotedPaths[4])];
  }

  // An unchanged path can itself contain " b/". Prefer the split with equal paths.
  const midpoint = (paths.length - 1) / 2;
  const separator = paths.startsWith(' b/', midpoint) && paths.slice(2, midpoint) === paths.slice(midpoint + 3)
    ? midpoint
    : paths.indexOf(' b/');
  if (separator < 0) {
    return [null, null];
  }
  return [stripDiffPrefix(paths.slice(0, separator)), stripDiffPrefix(paths.slice(separator + 1))];
}

function consumeHunkLine(hunk, file, line, cursor) {
  if (line.startsWith('\\ ')) {
    hunk.lines.push({ content: line, newLine: null, oldLine: null, type: 'note' });
    return true;
  }

  const prefix = line[0];
  const isContext = prefix === ' ';
  const isAddition = prefix === '+';
  const isDeletion = prefix === '-';
  const consumesOldLine = isContext || isDeletion;
  const consumesNewLine = isContext || isAddition;
  if ((!consumesOldLine && !consumesNewLine)
    || (consumesOldLine && cursor.remainingOld === 0)
    || (consumesNewLine && cursor.remainingNew === 0)) {
    return false;
  }

  hunk.lines.push({
    content: line.slice(1),
    newLine: consumesNewLine ? cursor.newLine++ : null,
    oldLine: consumesOldLine ? cursor.oldLine++ : null,
    type: isContext ? 'context' : isAddition ? 'addition' : 'deletion',
  });
  cursor.remainingOld -= Number(consumesOldLine);
  cursor.remainingNew -= Number(consumesNewLine);
  file.stats.additions += Number(isAddition);
  file.stats.deletions += Number(isDeletion);
  return true;
}

export function parseUnifiedDiff(diffText) {
  if (!diffText) {
    return [];
  }

  const files = [];
  const lines = String(diffText).split(/\r?\n/u);
  let currentFile = null;
  let currentHunk = null;
  let cursor = null;

  for (const line of lines) {
    if (currentHunk && consumeHunkLine(currentHunk, currentFile, line, cursor)) {
      continue;
    }
    currentHunk = null;

    if (line.startsWith('diff --git ')) {
      const [oldPath, newPath] = parseDiffHeaderPaths(line.slice('diff --git '.length));
      currentFile = {
        code: 'M',
        hunks: [],
        isBinary: false,
        oldPath,
        path: newPath ?? oldPath,
        stats: {
          additions: 0,
          deletions: 0,
        },
        status: 'modified',
      };
      files.push(currentFile);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith('new file mode ')) {
      currentFile.code = 'A';
      currentFile.status = 'added';
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      currentFile.code = 'D';
      currentFile.status = 'deleted';
      continue;
    }

    if (line.startsWith('rename from ')) {
      currentFile.code = 'R';
      currentFile.status = 'renamed';
      currentFile.oldPath = decodeQuotedPath(line.slice('rename from '.length));
      continue;
    }

    if (line.startsWith('rename to ')) {
      currentFile.path = decodeQuotedPath(line.slice('rename to '.length));
      continue;
    }

    if (line.startsWith('copy from ')) {
      currentFile.code = 'C';
      currentFile.status = 'copied';
      currentFile.oldPath = decodeQuotedPath(line.slice('copy from '.length));
      continue;
    }

    if (line.startsWith('copy to ')) {
      currentFile.path = decodeQuotedPath(line.slice('copy to '.length));
      continue;
    }

    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      currentFile.isBinary = true;
      currentFile.binaryMessage = line;
      continue;
    }

    if (line.startsWith('--- ')) {
      currentFile.oldPath = stripDiffPrefix(line.slice(4).split('\t', 1)[0]);
      continue;
    }

    if (line.startsWith('+++ ')) {
      currentFile.path = stripDiffPrefix(line.slice(4).split('\t', 1)[0]) ?? currentFile.path;
      continue;
    }

    const hunk = parseHunkHeader(line);
    if (hunk) {
      currentHunk = {
        ...hunk,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      cursor = {
        newLine: hunk.newStart,
        oldLine: hunk.oldStart,
        remainingNew: hunk.newLines,
        remainingOld: hunk.oldLines,
      };
    }
  }

  return files
    .map((file) => finalizeFile(file))
    .filter(Boolean);
}
