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
  backlinks = [],
  baseQueryService = null,
  content = '# Notes\n\nHello world\n',
  documentPath = 'notes.md',
  extraFiles = {},
  room = null,
} = {}) {
  const files = new Map([[documentPath, content], ...Object.entries(extraFiles)]);
  const entries = new Map(Array.from(files.keys(), (path) => [
    path,
    { nodeType: 'file', path },
  ]));
  const renderedSources = [];
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
    backlinkIndex: {
      getBacklinks: async () => backlinks,
    },
    baseQueryService,
    plantUmlRenderer: {
      async renderSvg(source) {
        renderedSources.push(source);
        return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
      },
    },
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
  return { entries, events, files, renderedSources, service };
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

test('agent document creation safely recovers an identical retry', async () => {
  const { events, service } = createService();
  const input = { content: '# New\r\n', path: 'docs/new.md' };

  const created = await service.createDocument(actor, input);
  const retried = await service.createDocument(actor, input);

  assert.deepEqual(retried, created);
  assert.equal(events.filter(({ action }) => action === 'create').length, 1);
  await assert.rejects(
    service.createDocument(actor, { ...input, content: '# Different\n' }),
    { code: 'AGENT_CREATE_FAILED' },
  );
});
test('agent tools inspect and validate references, video embeds, and workspace entries', async () => {
  const { entries, service } = createService({
    backlinks: [{ contexts: ['Links here'], file: 'backlink.md' }],
    content: [
      '# Embedded content',
      '[[Other]]',
      '[[Missing]]',
      '![[diagrams/system.mmd]]',
      '![Diagram](assets/diagram.png)',
      '![Demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
      '![Demo](http://cdn.example.com/demo.mp4)',
    ].join('\n'),
    extraFiles: {
      'assets/diagram.png': '',
      'diagrams/system.mmd': 'flowchart LR\\nA-->B\\n',
      'docs/Other.md': '# Other\\n',
    },
  });
  entries.set('assets', { nodeType: 'directory', path: 'assets' });

  const inspected = await service.inspectDocumentReferences(actor, { path: 'notes.md' });
  assert.equal(inspected.backlinks[0].file, 'backlink.md');
  assert.equal(inspected.wikiLinks.find(({ rawTarget }) => rawTarget === 'Other').resolvedPath, 'docs/Other.md');
  assert.equal(inspected.wikiLinks.find(({ rawTarget }) => rawTarget === 'Missing').exists, false);
  assert.equal(inspected.embeds.find(({ rawTarget }) => rawTarget === 'diagrams/system.mmd').kind, 'mermaid');
  assert.equal(inspected.embeds.find(({ rawTarget }) => rawTarget === 'assets/diagram.png').exists, true);
  assert.deepEqual(inspected.videos.map(({ supported }) => supported), [true, false]);

  const validation = await service.validateDocument(actor, { path: 'notes.md' });
  assert.deepEqual(
    validation.issues.map(({ code }) => code),
    ['REFERENCE_TARGET_NOT_FOUND', 'VIDEO_EMBED_UNSUPPORTED'],
  );

  const workspace = service.listWorkspaceEntries(actor);
  assert.equal(workspace.entries.find(({ path }) => path === 'assets').nodeType, 'directory');
  assert.equal(workspace.entries.find(({ path }) => path === 'assets/diagram.png').embeddable, true);
  assert.equal(workspace.entries.find(({ path }) => path === 'assets/diagram.png').readable, false);
  assert.deepEqual(
    service.listWorkspaceEntries(actor, { pathQuery: 'OTHER' }).entries.map(({ path }) => path),
    ['docs/Other.md'],
  );
  assert.match(service.getSyntax(actor, { kind: 'markdown' }).guide, /public video embeds/u);
});

test('agent diagram rendering handles PlantUML and directs Mermaid to WebMCP', async () => {
  const plantUml = createService({
    content: '@startuml\\nAlice -> Bob\\n@enduml\\n',
    documentPath: 'sequence.puml',
  });
  const rendered = await plantUml.service.renderDiagram(actor, {
    format: 'svg',
    path: 'sequence.puml',
  });
  assert.equal(rendered.kind, 'plantuml');
  assert.match(rendered.svg, /^<svg/u);
  assert.equal(plantUml.renderedSources[0], '@startuml\\nAlice -> Bob\\n@enduml\\n');

  const mermaid = createService({
    content: 'flowchart LR\\nA-->B\\n',
    documentPath: 'flow.mmd',
  });
  await assert.rejects(
    mermaid.service.renderDiagram(actor, { path: 'flow.mmd' }),
    { code: 'AGENT_BROWSER_RENDER_REQUIRED' },
  );
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
    verify: { format: 'svg', render: true },
  });
  assert.equal(created.elementCount, 3);
  assert.equal(created.verification.inspection.elementCount, 3);
  assert.deepEqual(created.verification.inspection.elements, []);
  assert.equal(created.verification.inspection.truncated, true);
  assert.equal(created.verification.renderer, 'collabmd-basic-svg');
  assert.match(created.verification.svg, /^<svg /u);

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

test('agent Excalidraw creation safely recovers an identical retry', async () => {
  const { events, service } = createService();
  const input = {
    elements: [{ height: 80, id: 'api', type: 'rectangle', width: 160, x: 20, y: 30 }],
    path: 'diagrams/retry.excalidraw',
  };

  const created = await service.createExcalidraw(actor, input);
  const retried = await service.createExcalidraw(actor, input);

  assert.deepEqual(retried, created);
  assert.equal(events.filter(({ action }) => action === 'create').length, 1);
  await assert.rejects(
    service.createExcalidraw(actor, {
      ...input,
      elements: [{ ...input.elements[0], x: 21 }],
    }),
    { code: 'AGENT_CREATE_FAILED' },
  );
});

test('agent Excalidraw edits translate elements, resize standalone text, and verify the stored revision', async () => {
  const { files, service } = createService();
  const created = await service.createExcalidraw(actor, {
    elements: [
      { groupIds: ['service'], height: 80, id: 'box', type: 'rectangle', width: 160, x: 20, y: 30 },
      { groupIds: ['service'], id: 'label', text: 'API', type: 'text', x: 70, y: 55 },
      { containerId: 'box', height: 80, id: 'bound-label', text: 'Bound', type: 'text', width: 100, x: 70, y: 80 },
      {
        autoResize: false,
        groupIds: ['service'],
        height: 25,
        id: 'fixed-label',
        text: 'Fixed',
        type: 'text',
        width: 80,
        x: 70,
        y: 100,
      },
    ],
    path: 'diagrams/edit.excalidraw',
  });
  const edited = await service.editExcalidraw(actor, {
    path: 'diagrams/edit.excalidraw',
    revision: created.revision,
    translate: { dx: 40, dy: -10, ids: ['box'] },
    update: [
      { id: 'label', set: { lineHeight: 1.5, text: 'A much longer API label' } },
      { id: 'bound-label', set: { height: 25, x: 50, y: 57.5 } },
      { id: 'fixed-label', set: { text: 'Fixed label remains wrapped' } },
    ],
    verify: { format: 'svg', render: true },
  });
  const storedScene = JSON.parse(files.get('diagrams/edit.excalidraw'));
  const box = storedScene.elements.find(({ id }) => id === 'box');
  const boundLabel = storedScene.elements.find(({ id }) => id === 'bound-label');
  const label = storedScene.elements.find(({ id }) => id === 'label');
  const fixedLabel = storedScene.elements.find(({ id }) => id === 'fixed-label');

  assert.equal(edited.translated, 1);
  assert.equal(box.x, 60);
  assert.equal(box.y, 20);
  assert.deepEqual(box.boundElements, [{ id: 'bound-label', type: 'text' }]);
  assert.equal(label.x, 110);
  assert.equal(label.y, 45);
  assert.equal(boundLabel.x, 90);
  assert.equal(boundLabel.y, 47.5);
  assert.equal(boundLabel.height, 25);
  assert.equal(label.originalText, 'A much longer API label');
  assert.ok(label.width > 80);
  assert.equal(label.height, 30);
  assert.equal(fixedLabel.width, 80);
  assert.equal(fixedLabel.x, 110);
  assert.equal(fixedLabel.y, 90);
  assert.equal(fixedLabel.height, 25);
  assert.deepEqual(edited.verification.scene, storedScene);
  assert.match(edited.verification.svg, /^<svg /u);
  assert.equal(edited.verification.inspection.warnings.some(({ code }) => code === 'text-overflow'), true);
  assert.equal((await service.readDocument(actor, {
    path: 'diagrams/edit.excalidraw',
  })).revision, edited.revision);
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


test('agent whole-word search overlays only matching active room text', async () => {
  const room = {
    isHydrated: () => true,
    readEditableContent: () => '# Live\n\nMCP and memcpy\n',
  };
  const { service } = createService({ room });
  const result = await service.searchVault(actor, { query: 'mcp', wholeWord: true });
  assert.equal(result.files[0].file, 'notes.md');
  assert.equal(result.files[0].matchCount, 1);
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


test('agent content service creates, edits, and queries Base files', async () => {
  const queries = [];
  const { files, service } = createService({
    baseQueryService: {
      async query(input) {
        queries.push(input);
        return {
          columns: [{ id: 'file.name', label: 'name' }, { id: 'note.status', label: 'status' }],
          rows: [{
            cells: {
              'file.name': { text: 'task-a.md' },
              'note.status': { text: 'open' },
            },
            path: 'notes/task-a.md',
          }],
          totalRows: 1,
          view: { name: 'Board', type: 'table' },
        };
      },
    },
  });

  const created = await service.createDocument(actor, {
    content: 'filters: note.status == "open"\nviews:\n  - type: table\n    name: Board\n',
    path: 'views/tasks.base',
  });
  assert.equal(created.kind, 'base');
  assert.match(files.get('views/tasks.base'), /note\.status/u);

  await assert.rejects(
    service.createDocument(actor, { content: '- not an object\n', path: 'views/bad.base' }),
    { code: 'AGENT_INVALID_BASE' },
  );

  const queried = await service.queryBase(actor, { path: 'views/tasks.base', view: 'Board' });
  assert.deepEqual(queried.rows.map(({ path }) => path), ['notes/task-a.md']);
  assert.equal(queried.rows[0].cells['note.status'], 'open');
  assert.equal(queried.view.name, 'Board');
  assert.match(queries[0].source, /note\.status/u);

  const read = await service.readDocument(actor, { path: 'views/tasks.base' });
  const edited = await service.applyTextEdits(actor, {
    path: 'views/tasks.base',
    replacements: [{ oldText: 'open', newText: 'done' }],
    revision: read.revision,
  });
  assert.match(files.get('views/tasks.base'), /done/u);
  assert.notEqual(edited.revision, read.revision);

  await assert.rejects(
    service.applyTextEdits(actor, {
      path: 'views/tasks.base',
      replacements: [{ oldText: 'filters:', newText: '- item:' }],
      revision: edited.revision,
    }),
    { code: 'AGENT_INVALID_BASE' },
  );

  await assert.rejects(
    service.queryBase(actor, { path: 'notes.md' }),
    { code: 'AGENT_UNSUPPORTED_DOCUMENT' },
  );
  await assert.rejects(
    createService().service.queryBase(actor, { path: 'views/tasks.base' }),
    { code: 'AGENT_DOCUMENT_NOT_FOUND' },
  );
  await assert.rejects(
    createService({ extraFiles: { 'views/empty.base': 'filters: []\n' } }).service.queryBase(actor, {
      path: 'views/empty.base',
    }),
    { code: 'AGENT_BASE_QUERY_UNAVAILABLE' },
  );
});
