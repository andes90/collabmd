import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHistoryService } from '../../src/server/infrastructure/git/history-service.js';

test('GitHistoryService bounds response entries and sweeps expired unique keys', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  let reads = 0;
  const service = new GitHistoryService({
    commandRunner: {
      isGitRepo: async () => true,
      execGit: async () => `snapshot ${++reads}`,
    },
  });
  for (let index = 0; index < 60; index += 1) {
    await service.getFileSnapshot({ hash: 'abcd', path: `note-${index}.md` });
  }
  assert.equal(service.commitCache.size, 50);
  const latest = await service.getFileSnapshot({ hash: 'abcd', path: 'note-59.md' });
  assert.equal(reads, 60);
  assert.strictEqual(await service.getFileSnapshot({ hash: 'abcd', path: 'note-59.md' }), latest);
  await service.getFileSnapshot({ hash: 'abcd', path: 'note-0.md' });
  assert.equal(reads, 61);

  t.mock.timers.tick(60_000);
  await service.getFileSnapshot({ hash: 'abcd', path: 'fresh.md' });
  assert.equal(service.commitCache.size, 1);
  assert.equal(service.pendingRequests.size, 0);
});

test('GitHistoryService skips oversized responses while coalescing in-flight blobs', async () => {
  const started = Promise.withResolvers();
  const pending = Promise.withResolvers();
  const bytes = Buffer.alloc(512 * 1024, 1);
  let reads = 0;
  const service = new GitHistoryService({
    commandRunner: {
      isGitRepo: async () => true,
      execGit: async () => 'x'.repeat(512 * 1024),
      execGitBuffer: async () => {
        reads += 1;
        started.resolve();
        return pending.promise;
      },
    },
  });
  const request = { hash: 'abcd', path: 'image.png' };
  const first = service.getFileAttachment(request);
  const second = service.getFileAttachment(request);
  await started.promise;
  assert.equal(reads, 1);
  pending.resolve(bytes);
  const responses = await Promise.all([first, second]);
  assert.strictEqual(responses[0], responses[1]);
  assert.strictEqual(responses[0].content, bytes);
  assert.equal(service.commitCache.size, 0);
  await service.getFileAttachment(request);
  assert.equal(reads, 2);
  await service.getFileSnapshot({ hash: 'abcd', path: 'large.md' });
  assert.equal(service.commitCache.size, 0);
  assert.equal(service.pendingRequests.size, 0);
});

test('GitHistoryService bounds and expires history pages as well as commit responses', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const service = new GitHistoryService({
    commandRunner: { isGitRepo: async () => true, execGit: async () => '' },
  });
  for (let offset = 0; offset < 60; offset += 1) await service.listHistory({ offset });
  assert.equal(service.historyCache.size, 50);
  t.mock.timers.tick(60_000);
  await service.listHistory({ offset: 60 });
  assert.equal(service.historyCache.size, 1);
  service.invalidate();
  assert.equal(service.historyCache.size, 0);
  assert.equal(service.commitCache.size, 0);
});
