import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentContentService } from '../../src/server/application/agent-content-service.js';

const actor = {
  collaborator: { email: 'agent@example.com', name: 'Agent User' },
  connectionId: 'connection-1',
  requestId: 'request-1',
  scopes: ['vault:read', 'vault:edit'],
};

function createService({ content = '# Notes\n\nHello world\n', room = null } = {}) {
  const entries = new Map([
    ['notes.md', { nodeType: 'file', path: 'notes.md' }],
  ]);
  const files = new Map([['notes.md', content]]);
  const events = [];
  const workspaceMutationCoordinator = {
    workspaceState: { entries, metadata: new Map() },
    async createFile({ content: nextContent, path, ...metadata }) {
      if (files.has(path)) return { ok: false, error: 'File already exists' };
      files.set(path, nextContent);
      entries.set(path, { nodeType: 'file', path });
      events.push({ action: 'create', metadata, path });
      return { ok: true };
    },
    async writeEditableContent({ content: nextContent, path, ...metadata }) {
      files.set(path, nextContent);
      events.push({ action: 'write', metadata, path });
      return { ok: true };
    },
  };
  const service = new AgentContentService({
    roomRegistry: {
      get: (path) => path === 'notes.md' ? room : null,
      getRooms: () => room ? [['notes.md', room]] : [],
    },
    searchService: {
      async search({ query }) {
        return { files: [], matchCount: 0, ok: true, query, truncated: false };
      },
    },
    vaultFileStore: {
      readEditableVaultContent: async (path) => files.get(path) ?? null,
    },
    workspaceMutationCoordinator,
  });
  return { entries, events, files, service };
}


test('agent content service reads, edits, and creates closed documents', async () => {
  const { events, files, service } = createService();
  const read = await service.readDocument(actor, { path: 'notes.md' });
  const edited = await service.applyTextEdits(actor, {
    path: 'notes.md',
    replacements: [{ oldText: 'Hello world', newText: 'Hello agent' }],
    revision: read.revision,
  });

  assert.equal(files.get('notes.md'), '# Notes\n\nHello agent\n');
  assert.notEqual(edited.revision, read.revision);
  assert.equal(events[0].metadata.sourceRef, 'agent-connection:connection-1');

  const created = await service.createDocument(actor, {
    content: '# New\r\n',
    path: 'docs/new.md',
  });
  assert.equal(created.kind, 'markdown');
  assert.equal(files.get('docs/new.md'), '# New\n');
});


test('agent content service uses current room text and rejects stale revisions', async () => {
  let liveContent = '# Live\n\nCurrent room text\n';
  const room = {
    applyExactTextChanges(changes) {
      for (let index = changes.length - 1; index >= 0; index -= 1) {
        const change = changes[index];
        liveContent = liveContent.slice(0, change.from) + change.insert + liveContent.slice(change.to);
      }
    },
    isHydrated: () => true,
    readEditableContent: () => liveContent,
  };
  const { service } = createService({ content: '# stale disk\n', room });
  const read = await service.readDocument(actor, { path: 'notes.md' });
  assert.equal(read.content, liveContent);

  liveContent = `${liveContent}Collaborator edit\n`;
  await assert.rejects(
    service.applyTextEdits(actor, {
      path: 'notes.md',
      replacements: [{ oldText: 'Current room text', newText: 'Agent text' }],
      revision: read.revision,
    }),
    { code: 'AGENT_REVISION_CONFLICT' },
  );
});


test('agent search overlays active room content', async () => {
  const room = {
    isHydrated: () => true,
    readEditableContent: () => '# Live\n\nUnique live phrase\n',
  };
  const { service } = createService({ room });
  const result = await service.searchVault(actor, { query: 'live phrase' });
  assert.equal(result.files[0].file, 'notes.md');
  assert.equal(result.files[0].snippets[0].line, 3);
});
