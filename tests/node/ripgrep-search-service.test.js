import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RipgrepSearchService,
  parseRipgrepJson,
} from '../../src/server/domain/ripgrep-search-service.js';

function rgMatch({ file, line = 1, text, start, end }) {
  return JSON.stringify({
    data: {
      line_number: line,
      lines: { text },
      path: { text: file },
      submatches: [
        {
          end,
          match: { text: text.slice(start, end) },
          start,
        },
      ],
    },
    type: 'match',
  });
}

test('parseRipgrepJson groups matches by file and preserves line snippets', () => {
  const payload = [
    rgMatch({
      end: 11,
      file: './docs/guide.md',
      line: 3,
      start: 5,
      text: 'Find needle here\n',
    }),
    rgMatch({
      end: 13,
      file: './docs/guide.md',
      line: 8,
      start: 7,
      text: 'Second needle here\n',
    }),
    rgMatch({
      end: 6,
      file: './notes/today.mmd',
      line: 1,
      start: 0,
      text: 'needle diagram\n',
    }),
  ].join('\n');

  const result = parseRipgrepJson(payload, {
    maxFiles: 10,
    maxSnippetsPerFile: 5,
    query: 'needle',
  });

  assert.equal(result.ok, true);
  assert.equal(result.matchCount, 3);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].file, 'docs/guide.md');
  assert.equal(result.files[0].kind, 'markdown');
  assert.equal(result.files[0].matchCount, 2);
  assert.deepEqual(result.files[0].snippets[0], {
    column: 6,
    line: 3,
    matchEnd: 11,
    matchStart: 5,
    text: 'Find needle here',
  });
  assert.equal(result.files[1].kind, 'mermaid');
});
test('parseRipgrepJson applies path, kind, and snippet filters before file limits', () => {
  const payload = [
    ['./docs/guide.md', 1, 'needle\n'],
    ['./docs/guide.md', 2, 'needle again\n'],
    ['./docs/diagram.mmd', 1, 'needle\n'],
    ['./other/note.md', 1, 'needle\n'],
  ].map(([file, line, text]) => rgMatch({
    end: 6,
    file,
    line,
    start: 0,
    text,
  })).join('\n');

  const result = parseRipgrepJson(payload, {
    kinds: ['markdown'],
    maxFiles: 1,
    maxSnippetsPerFile: 1,
    prefix: 'docs',
    query: 'needle',
  });

  assert.deepEqual(result.files.map(({ file }) => file), ['docs/guide.md']);
  assert.equal(result.files[0].matchCount, 2);
  assert.equal(result.files[0].snippets.length, 1);
  assert.equal(result.truncated, true);
});


test('parseRipgrepJson converts ripgrep byte offsets to UTF-16 columns', () => {
  const text = 'Prefix 😄 needle here\n';
  const matchStart = Buffer.byteLength('Prefix 😄 ', 'utf8');
  const matchEnd = matchStart + Buffer.byteLength('needle', 'utf8');

  const result = parseRipgrepJson(rgMatch({
    end: matchEnd,
    file: './unicode.md',
    line: 4,
    start: matchStart,
    text,
  }), {
    maxFiles: 10,
    maxSnippetsPerFile: 5,
    query: 'needle',
  });

  assert.deepEqual(result.files[0].snippets[0], {
    column: 11,
    line: 4,
    matchEnd: 16,
    matchStart: 10,
    text: 'Prefix 😄 needle here',
  });
});

test('parseRipgrepJson marks files truncated after the snippet limit', () => {
  const payload = Array.from({ length: 6 }, (_, index) => rgMatch({
    end: 6,
    file: './many.md',
    line: index + 1,
    start: 0,
    text: 'needle\n',
  })).join('\n');

  const result = parseRipgrepJson(payload, {
    maxFiles: 10,
    maxSnippetsPerFile: 5,
    query: 'needle',
  });

  assert.equal(result.truncated, true);
  assert.equal(result.files[0].truncated, true);
  assert.equal(result.files[0].matchCount, 6);
  assert.equal(result.files[0].snippets.length, 5);
});

test('RipgrepSearchService reports unavailable when rg is missing', async () => {
  const missing = new Error('spawn rg ENOENT');
  missing.code = 'ENOENT';
  const service = new RipgrepSearchService({
    execFileImpl: async () => {
      throw missing;
    },
    vaultDir: '/tmp/vault',
  });

  const config = await service.initialize();
  assert.equal(config.available, false);
  assert.equal(config.backend, 'ripgrep');
  assert.match(config.unavailableReason, /not installed/i);

  await assert.rejects(
    service.search({ query: 'needle' }),
    /requires ripgrep/i,
  );
});

test('RipgrepSearchService searches with safe rg args and handles no matches', async () => {
  const calls = [];
  const noMatches = new Error('no matches');
  noMatches.code = 1;
  const service = new RipgrepSearchService({
    execFileImpl: async (command, args, options) => {
      calls.push({ args, command, options });
      if (args[0] === '--version') {
        return { stdout: 'ripgrep 14.1.0\n' };
      }
      throw noMatches;
    },
    vaultDir: '/tmp/vault',
  });

  await service.initialize();
  const result = await service.search({ query: 'needle' });

  assert.equal(result.ok, true);
  assert.equal(result.files.length, 0);
  assert.equal(calls[1].command, 'rg');
  assert.equal(calls[1].options.cwd, '/tmp/vault');
  assert.equal(calls[1].args.includes('--json'), true);
  assert.equal(calls[1].args.includes('--fixed-strings'), true);
  const maxCountIndex = calls[1].args.indexOf('--max-count');
  assert.equal(calls[1].args[maxCountIndex + 1], '6');
  assert.equal(calls[1].args.includes('*.drawio'), true);
  assert.equal(calls[1].args.includes('*.excalidraw'), false);
  assert.equal(calls[1].args.includes('!node_modules/**'), true);
  assert.equal(calls[1].args.includes('!.obsidian/**'), true);
  assert.equal(calls[1].args.includes('!.trash/**'), true);
});

test('RipgrepSearchService marks results truncated when Excalidraw search is skipped', async () => {
  const service = new RipgrepSearchService({
    execFileImpl: async (_command, args) => args[0] === '--version'
      ? { stdout: 'ripgrep 14.1.0\n' }
      : {
          stdout: rgMatch({
            end: 6,
            file: './note.md',
            start: 0,
            text: 'needle\n',
          }),
        },
    vaultDir: '/tmp/vault',
  });
  await service.initialize();

  assert.equal((await service.search({ limit: 1, query: 'needle' })).truncated, true);
  assert.equal((await service.search({
    kinds: ['markdown'],
    limit: 1,
    query: 'needle',
  })).truncated, false);
});

test('RipgrepSearchService passes search limits and cancellation to rg', async () => {
  const calls = [];
  const service = new RipgrepSearchService({
    execFileImpl: async (command, args, options) => {
      calls.push({ args, command, options });
      if (args[0] === '--version') {
        return { stdout: 'ripgrep 14.1.0\n' };
      }
      return { stdout: '' };
    },
    maxBufferBytes: 8 * 1024 * 1024,
    maxFileSize: '5M',
    vaultDir: '/tmp/vault',
  });
  const controller = new AbortController();

  await service.initialize();
  await service.search({
    maxSnippetsPerFile: 2,
    query: 'needle',
    signal: controller.signal,
  });

  assert.equal(calls[1].options.maxBuffer, 8 * 1024 * 1024);
  assert.equal(calls[1].options.signal, controller.signal);
  const maxFileSizeIndex = calls[1].args.indexOf('--max-filesize');
  assert.equal(calls[1].args[maxFileSizeIndex + 1], '5M');
  const maxCountIndex = calls[1].args.indexOf('--max-count');
  assert.equal(calls[1].args[maxCountIndex + 1], '3');
});
