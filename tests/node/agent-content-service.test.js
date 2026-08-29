import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentContentService } from '../../src/server/application/agent-content-service.js';

const actor = {
  collaborator: { email: 'agent@example.com', name: 'Agent User' },
  connectionId: 'connection-1',
  requestId: 'request-1',
  scopes: ['vault:read', 'vault:edit'],
};

function createService({
  content = '# Notes\n\nHello world\n',
  documentPath = 'notes.md',
  room = null,
} = {}) {
  const entries = new Map([
    [documentPath, { nodeType: 'file', path: documentPath }],
  ]);
  const files = new Map([[documentPath, content]]);
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
      get: (path) => path === documentPath ? room : null,
      getRooms: () => room ? [[documentPath, room]] : [],
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

test('agent content service creates and edits Excalidraw elements', async () => {
  const { files, service } = createService();
  const created = await service.createExcalidraw(actor, {
    elements: [
      { height: 80, id: 'api', type: 'rectangle', width: 160, x: 20, y: 30 },
      { id: 'label', text: 'API', type: 'text', x: 70, y: 55 },
      {
        endElementId: 'api',
        id: 'request',
        points: [[0, 0], [80, 0]],
        type: 'arrow',
        x: -60,
        y: 70,
      },
    ],
    path: 'diagrams/api.excalidraw',
  });
  assert.equal(created.elementCount, 3);

  const edited = await service.editExcalidraw(actor, {
    create: [{ height: 80, id: 'db', type: 'ellipse', width: 120, x: 300, y: 30 }],
    delete: ['label'],
    path: 'diagrams/api.excalidraw',
    revision: created.revision,
    update: [{ id: 'api', set: { backgroundColor: '#a5d8ff', x: 40 } }],
  });
  const scene = JSON.parse(files.get('diagrams/api.excalidraw'));
  assert.equal(edited.created, 1);
  assert.equal(edited.deleted, 1);
  assert.equal(edited.updated, 1);
  assert.deepEqual(scene.elements.map(({ id }) => id), ['api', 'request', 'db']);
  assert.equal(scene.elements.find(({ id }) => id === 'api').x, 40);
  assert.deepEqual(
    scene.elements.find(({ id }) => id === 'api').boundElements,
    [{ id: 'request', type: 'arrow' }],
  );
});

test('agent Excalidraw operations preserve canonical geometry and explicit paint order', async () => {
  const { files, service } = createService();
  const elements = Array.from({ length: 12 }, (_, index) => ({
    height: 10,
    id: `shape-${index}`,
    type: 'rectangle',
    width: 10,
    x: index * 20,
    y: 0,
  }));
  elements.push({
    afterElementId: 'shape-1',
    height: 999,
    id: 'stroke',
    points: [[5, 5], [25, -5]],
    type: 'freedraw',
    width: 999,
    x: 100,
    y: 50,
  });
  const created = await service.createExcalidraw(actor, {
    elements,
    path: 'diagrams/layers.excalidraw',
  });
  const createdScene = JSON.parse(files.get('diagrams/layers.excalidraw'));
  assert.deepEqual(
    createdScene.elements.slice(0, 12).map(({ index }) => index),
    ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aA', 'aB'],
  );
  const stroke = createdScene.elements.find(({ id }) => id === 'stroke');
  assert.deepEqual(
    {
      height: stroke.height,
      points: stroke.points,
      simulatePressure: stroke.simulatePressure,
      width: stroke.width,
      x: stroke.x,
      y: stroke.y,
    },
    {
      height: 10,
      points: [[0, 0], [20, -10]],
      simulatePressure: true,
      width: 20,
      x: 105,
      y: 55,
    },
  );

  const edited = await service.editExcalidraw(actor, {
    create: [{
      afterElementId: 'shape-3',
      height: 10,
      id: 'inserted',
      type: 'rectangle',
      width: 10,
      x: 70,
      y: 20,
    }],
    path: 'diagrams/layers.excalidraw',
    reorder: [{ afterElementId: 'shape-11', id: 'shape-0' }],
    replace: [{
      element: { height: 20, type: 'ellipse', width: 30, x: 20, y: 20 },
      id: 'shape-1',
    }],
    revision: created.revision,
  });
  const editedScene = JSON.parse(files.get('diagrams/layers.excalidraw'));
  assert.deepEqual(
    editedScene.elements.map(({ id }) => id),
    [
      'shape-1',
      'stroke',
      'shape-2',
      'shape-3',
      'inserted',
      'shape-4',
      'shape-5',
      'shape-6',
      'shape-7',
      'shape-8',
      'shape-9',
      'shape-10',
      'shape-11',
      'shape-0',
    ],
  );
  assert.equal(editedScene.elements[0].type, 'ellipse');
  assert.equal(edited.reordered, 1);
  assert.equal(edited.replaced, 1);

  const inspected = await service.inspectExcalidraw(actor, {
    path: 'diagrams/layers.excalidraw',
  });
  assert.equal(inspected.revision, edited.revision);
  assert.deepEqual(
    inspected.elements.slice(0, 2).map(({ behind, id, inFrontOf, paintOrder }) => ({
      behind,
      id,
      inFrontOf,
      paintOrder,
    })),
    [
      { behind: 'stroke', id: 'shape-1', inFrontOf: undefined, paintOrder: 0 },
      { behind: 'shape-2', id: 'stroke', inFrontOf: 'shape-1', paintOrder: 1 },
    ],
  );
});

test('agent Excalidraw edits update an active collaboration room', async () => {
  let liveContent = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape', type: 'rectangle', version: 1, x: 10, y: 20 }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  const room = {
    applyExcalidrawScene(scene) {
      liveContent = JSON.stringify({
        ...scene,
        elements: scene.elements.filter((element) => !element.isDeleted),
      });
    },
    getPersistedContent: () => liveContent,
    isHydrated: () => true,
    readEditableContent: () => null,
  };
  const { events, service } = createService({
    content: 'stale disk content',
    documentPath: 'live.excalidraw',
    room,
  });
  const read = await service.readDocument(actor, { path: 'live.excalidraw' });
  await service.editExcalidraw(actor, {
    path: 'live.excalidraw',
    revision: read.revision,
    update: [{ id: 'shape', set: { x: 80 } }],
  });

  assert.equal(JSON.parse(liveContent).elements[0].x, 80);
  assert.deepEqual(events, []);
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

test('agent reads report the last line actually returned after character truncation', async () => {
  const firstLine = 'x'.repeat(100_001);
  const { service } = createService({ content: `${firstLine}\nsecond line\n` });
  const result = await service.readDocument(actor, {
    lineCount: 2,
    path: 'notes.md',
  });

  assert.equal(result.content.length, 100_000);
  assert.equal(result.endLine, 1);
  assert.equal(result.startLine, 1);
  assert.equal(result.truncated, true);
});
