import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { serializeBaseDefinition, BaseQueryService } from '../../src/server/domain/bases/base-query-service.js';
import { normalizeBaseDefinition } from '../../src/server/domain/bases/base-definition.js';
import { createWorkspaceEntry, createWorkspaceStateSnapshot } from '../../src/server/domain/workspace-state.js';
import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';

async function createBaseWorkspace() {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-base-test-'));
  const writeVaultFile = async (relativePath, content) => {
    await mkdir(join(vaultDir, dirname(relativePath)), { recursive: true });
    await writeFile(join(vaultDir, relativePath), content, 'utf8');
  };

  return {
    cleanup: () => rm(vaultDir, { force: true, recursive: true }),
    service: new BaseQueryService({
      vaultFileStore: new VaultFileStore({ vaultDir }),
    }),
    vaultDir,
    writeVaultFile,
  };
}

function createBaseSnapshot(filePaths, scannedAt = 1) {
  return createWorkspaceStateSnapshot(
    new Map(filePaths.map((path) => [path, createWorkspaceEntry(path, 'file')])),
    new Map(filePaths.map((path) => [path, { path, type: 'file', mtimeMs: 1, size: 10 }])),
    { scannedAt },
  );
}

test('Base row cache storage stays proportional to the number of files', async () => {
  const paths = Array.from({ length: 512 }, (_, index) => `note-${index}.md`);
  const service = new BaseQueryService({
    vaultFileStore: { readMarkdownFile: async () => '# Note\n' },
  });
  await service.snapshotStore.buildIndexSnapshot(createBaseSnapshot(paths));

  const cacheBytes = Buffer.byteLength(JSON.stringify([...service.snapshotStore.rowRecordCache]));
  assert.equal(service.snapshotStore.rowRecordCache.size, paths.length);
  assert.ok(cacheBytes < paths.length * 1500, `Row cache retained ${cacheBytes} bytes for ${paths.length} tiny files`);
});

test('Base row cache refreshes link resolution when target membership changes', async () => {
  const service = new BaseQueryService({
    vaultFileStore: { readMarkdownFile: async (path) => path === 'source.md' ? '[[target]]\n' : '# Target\n' },
  });
  for (const target of [null, 'target.md', 'archive/target.md', null]) {
    const paths = ['source.md', ...(target ? [target] : [])];
    const snapshot = await service.snapshotStore.buildIndexSnapshot(createBaseSnapshot(paths));
    const link = snapshot.rowsByPath.get('source.md').file.links[0];
    assert.equal(link.exists, Boolean(target));
    assert.equal(link.path, target || 'target');
    assert.equal(service.snapshotStore.rowRecordCache.size, paths.length);
  }
});

test('Base row cache cannot reuse an overlapping build from an older file set', async () => {
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let reads = 0;
  const service = new BaseQueryService({
    vaultFileStore: {
      readMarkdownFile: async (path) => {
        if (reads++ === 0) {
          started.resolve();
          await resume.promise;
        }
        return path === 'source.md' ? '[[target]]\n' : '# Target\n';
      },
    },
  });
  const oldBuild = service.snapshotStore.buildIndexSnapshot(createBaseSnapshot(['source.md']));
  await started.promise;
  const nextState = createBaseSnapshot(['source.md', 'target.md'], 2);
  await service.snapshotStore.buildIndexSnapshot(nextState);
  resume.resolve();
  await oldBuild;

  const snapshot = await service.snapshotStore.buildIndexSnapshot(nextState);
  assert.equal(snapshot.rowsByPath.get('source.md').file.links[0].exists, true);
});

test('Base row cache preserves reused rows while overlapping builds change membership', async () => {
  const oldStarted = Promise.withResolvers();
  const oldResume = Promise.withResolvers();
  const nextStarted = Promise.withResolvers();
  const nextResume = Promise.withResolvers();
  let otherReads = 0;
  const service = new BaseQueryService({
    vaultFileStore: {
      readMarkdownFile: async (path) => {
        if (path === 'other.md' && ++otherReads === 2) {
          oldStarted.resolve();
          await oldResume.promise;
        }
        if (path === 'target.md') {
          nextStarted.resolve();
          await nextResume.promise;
        }
        return path === 'source.md' ? '---\nstatus: open\n---\n[[target]]\n' : '# Note\n';
      },
    },
  });
  await service.snapshotStore.buildIndexSnapshot(createBaseSnapshot(['other.md', 'source.md']));
  const oldState = createBaseSnapshot(['other.md', 'source.md'], 2);
  oldState.metadata.set('other.md', { ...oldState.metadata.get('other.md'), mtimeMs: 2 });
  const oldBuild = service.snapshotStore.buildIndexSnapshot(oldState);
  await oldStarted.promise;
  const nextBuild = service.snapshotStore.buildIndexSnapshot(createBaseSnapshot(['other.md', 'source.md', 'target.md'], 3));
  await nextStarted.promise;
  oldResume.resolve();
  const oldSnapshot = await oldBuild;
  nextResume.resolve();
  const nextSnapshot = await nextBuild;

  assert.equal(oldSnapshot.rowsByPath.get('source.md').noteProperties.status, 'open');
  assert.equal(oldSnapshot.rowsByPath.get('source.md').file.links[0].exists, false);
  assert.equal(nextSnapshot.rowsByPath.get('source.md').file.links[0].exists, true);
});

test('Base sorted result limits preserve ranking and path ties for different input orders', async () => {
  const paths = Array.from({ length: 180 }, (_, index) => `note-${String(index).padStart(3, '0')}.md`);
  for (const order of ['ascending', 'descending', 'mixed']) {
    const ranks = new Map(paths.map((path, index) => [path, Math.floor((order === 'ascending'
      ? index
      : order === 'descending' ? paths.length - index - 1 : (index * 79) % paths.length) / 3)]));
    const service = new BaseQueryService({
      maxResultRows: 7,
      vaultFileStore: {
        scanWorkspaceState: async () => createBaseSnapshot(paths),
        readMarkdownFile: async (path) => `---\nrank: ${ranks.get(path)}\n---\n`,
      },
    });
    for (const direction of ['asc', 'desc']) {
      const result = await service.query({ source: [
        'views:',
        '  - type: table',
        '    order: [file.path, note.rank]',
        '    limit: 5',
        '    sort:',
        '      - property: note.rank',
        `        direction: ${direction}`,
      ].join('\n') });
      const expected = [...paths].sort((left, right) => (
        (ranks.get(left) - ranks.get(right)) * (direction === 'desc' ? -1 : 1)
        || left.localeCompare(right)
      )).slice(0, 5);
      assert.deepEqual(result.rows.map((row) => row.path), expected, `${order}/${direction}`);
    }
  }
});

test('BaseQueryService evaluates base filters, formulas, groups, summaries, and optional csv output', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/task-a.md', [
    '---',
    'status: open',
    'points: 2',
    '---',
    '',
    '# Task A',
    '',
    '#task',
  ].join('\n'));
  await writeVaultFile('notes/task-b.md', [
    '---',
    'status: done',
    'points: 5',
    '---',
    '',
    '# Task B',
    '',
    '#task',
  ].join('\n'));
  await writeVaultFile('notes/reference.md', [
    '---',
    'status: ignored',
    'points: 99',
    '---',
    '',
    '# Reference',
  ].join('\n'));
  await writeVaultFile('views/tasks.base', [
    'filters: file.ext == "md" && file.hasTag("task")',
    'properties:',
    '  note.status: {}',
    '  note.points: {}',
    '  formula.bucket:',
    '    displayName: Bucket',
    '    formula: if(note.status == "done", "Closed", "Open")',
    'views:',
    '  - type: table',
    '    name: Board',
    '    groupBy: formula.bucket',
    '    order: [file.name, note.status, formula.bucket, note.points]',
    '    sort:',
    '      - property: note.points',
    '        direction: desc',
    '    summaries:',
    '      note.points:',
    '        - type: sum',
    '        - type: custom',
    '          name: Double sum',
    '          formula: values.reduce(acc + value, 0) * 2',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/tasks.base',
    includeCsv: true,
    view: 'Board',
  });

  assert.equal(result.totalRows, 2);
  assert.deepEqual(result.columns.map((column) => column.id), [
    'file.name',
    'note.status',
    'formula.bucket',
    'note.points',
  ]);
  assert.deepEqual(result.rows.map((row) => row.path), ['notes/task-b.md', 'notes/task-a.md']);
  assert.equal(result.rows[0].cells['formula.bucket'].value, 'Closed');
  assert.equal(result.rows[1].cells['formula.bucket'].value, 'Open');
  assert.deepEqual(result.groups.map((group) => group.label), ['Closed', 'Open']);
  assert.deepEqual(
    result.summaries.map((summary) => [summary.label, summary.value.value]),
    [['Sum', 7], ['Double sum', 14]],
  );
  assert.match(result.csv, /^name,status,Bucket,points\n/);
  assert.match(result.csv, /task-b\.md,done,Closed,5/);
  assert.equal(result.view.name, 'Board');
  assert.equal(result.view.supported, true);
});

test('Base CSV treats formula text and headers literally while preserving numbers', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);
  const values = ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1', '  =1+1', 'plain,"quoted"'];
  for (const [index, value] of values.entries()) {
    await writeVaultFile(`row-${index}.md`, `---\ntext: ${JSON.stringify(value)}\nnumber: -5\n---\n`);
  }
  await writeVaultFile('table.base', [
    'properties:',
    '  note.text:',
    '    displayName: "=HEADER()"',
    'views:',
    '  - type: table',
    '    name: Table',
    '    order: [note.text, note.number]',
  ].join('\n'));
  const result = await service.query({ basePath: 'table.base', includeCsv: true });
  assert.match(result.csv, /^'=HEADER\(\),number\n/);
  for (const value of values.slice(0, -1)) {
    assert.ok(result.csv.includes(`'${value}`));
  }
  assert.match(result.csv, /"plain,""quoted""",-5/);
  assert.equal(result.rows[0].cells['note.number'].value, -5);
});

test('BaseQueryService omits csv output by default', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/task-a.md', '# Task A\n');
  await writeVaultFile('views/tasks.base', [
    'views:',
    '  - type: table',
    '    order: [file.name]',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/tasks.base',
  });

  assert.equal('csv' in result, false);
});

test('normalizeBaseDefinition precomputes formula lookup aliases', () => {
  const definition = normalizeBaseDefinition([
    'formulas:',
    '  bucket: \'if(true, "Closed", "Open")\'',
    'properties:',
    '  formula.rank:',
    '    formula: \'1\'',
  ].join('\n'));

  assert.equal(definition.formulaLookup.get('bucket'), 'formula.bucket');
  assert.equal(definition.formulaLookup.get('formula.bucket'), 'formula.bucket');
  assert.equal(definition.formulaLookup.get('rank'), 'formula.rank');
  assert.equal(definition.formulaLookup.get('formula.rank'), 'formula.rank');
});

test('normalizeBaseDefinition preserves empty YAML document behavior', () => {
  ['', '  \n', '# Comment-only base\n'].forEach((source) => {
    const definition = normalizeBaseDefinition(source);

    assert.deepEqual(definition.raw, {});
    assert.equal(definition.views.length, 1);
    assert.equal(definition.views[0].name, 'Table');
    assert.equal(definition.views[0].type, 'table');
  });
});

test('BaseQueryService resolves this from the embedding source file and preserves unsupported views', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/daily.md', [
    '---',
    'team: red',
    '---',
    '',
    '# Daily',
  ].join('\n'));
  await writeVaultFile('notes/red.md', [
    '---',
    'team: red',
    '---',
    '',
    '# Red',
  ].join('\n'));
  await writeVaultFile('notes/blue.md', [
    '---',
    'team: blue',
    '---',
    '',
    '# Blue',
  ].join('\n'));

  const source = [
    'filters: file.ext == "md" && note.team == this.properties.team',
    'properties:',
    '  note.team: {}',
    'views:',
    '  - type: list',
    '    name: Team',
    '    order: [file.name, note.team]',
    '  - type: map',
    '    name: Places',
    '    lat: note.lat',
    '    lng: note.lng',
    '  - type: kanban-plugin',
    '    name: Plugin Board',
    '    pluginConfig:',
    '      color: ocean',
  ].join('\n');

  const result = await service.query({
    source,
    sourcePath: 'notes/daily.md',
    view: 'Team',
  });

  assert.equal(result.totalRows, 2);
  assert.deepEqual(result.rows.map((row) => row.path), ['notes/daily.md', 'notes/red.md']);
  assert.equal(result.thisFile.path, 'notes/daily.md');
  assert.deepEqual(
    result.views.map((view) => [view.name, view.type, view.supported]),
    [
      ['Team', 'list', true],
      ['Places', 'map', false],
      ['Plugin Board', 'kanban-plugin', false],
    ],
  );

  const serialized = serializeBaseDefinition(result.definition);
  assert.match(serialized, /type: map/);
  assert.match(serialized, /type: kanban-plugin/);
  assert.match(serialized, /color: ocean/);
});

test('BaseQueryService resolves this to the base file when querying a standalone .base file', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('projects/red/task.md', '# Task\n');
  await writeVaultFile('projects/red/notes.md', '# Notes\n');
  await writeVaultFile('projects/blue/task.md', '# Wrong folder\n');
  await writeVaultFile('projects/red/board.base', [
    'filters: file.ext == "md" && file.inFolder(this.folder)',
    'views:',
    '  - type: table',
    '    order: [file.path]',
  ].join('\n'));

  const result = await service.query({
    basePath: 'projects/red/board.base',
  });

  assert.equal(result.thisFile.path, 'projects/red/board.base');
  assert.deepEqual(result.rows.map((row) => row.path), [
    'projects/red/notes.md',
    'projects/red/task.md',
  ]);
});

test('BaseQueryService supports grouping and summaries for properties omitted from visible columns', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    'points: 1',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'status: done',
    'points: 3',
    '---',
  ].join('\n'));
  await writeVaultFile('views/hidden.base', [
    'filters: file.ext == "md"',
    'properties:',
    '  note.status: {}',
    '  note.points: {}',
    'views:',
    '  - type: table',
    '    name: Hidden refs',
    '    order: [file.name]',
    '    groupBy: note.status',
    '    summaries:',
    '      note.points:',
    '        - type: sum',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/hidden.base',
    view: 'Hidden refs',
  });

  assert.deepEqual(result.columns.map((column) => column.id), ['file.name']);
  assert.deepEqual(
    result.groups.map((group) => [group.label, group.rows.map((row) => row.path)]),
    [
      ['open', ['notes/a.md']],
      ['done', ['notes/b.md']],
    ],
  );
  assert.deepEqual(
    result.groups.map((group) => group.summaries[0]?.value?.value),
    [1, 3],
  );
});

test('BaseQueryService returns distinct values for hidden properties', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'category: alpha',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'category: beta',
    '---',
  ].join('\n'));
  await writeVaultFile('views/suggestions.base', [
    'filters: file.ext == "md"',
    'properties:',
    '  note.category: {}',
    'views:',
    '  - type: table',
    '    name: Hidden values',
    '    order: [file.name]',
  ].join('\n'));

  const result = await service.propertyValues({
    basePath: 'views/suggestions.base',
    propertyId: 'note.category',
    view: 'Hidden values',
  });

  assert.deepEqual(
    result.values.map((entry) => [entry.text, entry.count]),
    [
      ['alpha', 1],
      ['beta', 1],
    ],
  );
});

test('BaseQueryService treats missing properties as empty for builder-style method filters', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'category: foo',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', '# No category\n');
  await writeVaultFile('views/filters.base', [
    'filters: file.ext == "md"',
    'properties:',
    '  note.category: {}',
    'views:',
    '  - type: table',
    '    name: Contains',
    '    filters: note.category.contains("foo")',
    '    order: [file.name]',
    '  - type: table',
    '    name: Empty',
    '    filters: note.category.isEmpty()',
    '    order: [file.name]',
  ].join('\n'));

  const containsResult = await service.query({
    basePath: 'views/filters.base',
    view: 'Contains',
  });
  const emptyResult = await service.query({
    basePath: 'views/filters.base',
    view: 'Empty',
  });

  assert.deepEqual(containsResult.rows.map((row) => row.path), ['notes/a.md']);
  assert.deepEqual(emptyResult.rows.map((row) => row.path), ['notes/b.md']);
});

test('BaseQueryService resolves relative image paths against the source note', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/gallery.md', [
    '---',
    'cover: images/cover.png',
    '---',
    '',
    '# Gallery',
  ].join('\n'));
  await writeVaultFile('notes/images/cover.png', 'png-bytes');
  await writeVaultFile('views/gallery.base', [
    'filters: file.ext == "md"',
    'properties:',
    '  note.cover: {}',
    'views:',
    '  - type: table',
    '    order: [note.cover]',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/gallery.base',
  });

  assert.equal(result.rows[0].cells['note.cover'].type, 'image');
  assert.equal(result.rows[0].cells['note.cover'].path, 'notes/images/cover.png');
});

test('BaseQueryService compares file dates against quoted date strings in filters', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', '# A\n');
  await writeVaultFile('notes/b.md', '# B\n');
  await writeVaultFile('views/recent.base', [
    'views:',
    '  - type: table',
    '    name: Recent',
    '    filters:',
    '      and:',
    '        - file.ctime > "2000-01-01"',
    '    order: [file.name]',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/recent.base',
    view: 'Recent',
  });

  assert.deepEqual(result.rows.map((row) => row.path), [
    'notes/a.md',
    'notes/b.md',
    'views/recent.base',
  ]);
});

test('BaseQueryService evaluates not filters expressed as arrays', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/open.md', [
    '---',
    'status: open',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/done.md', [
    '---',
    'status: done',
    '---',
  ].join('\n'));
  await writeVaultFile('views/not-array.base', [
    'properties:',
    '  note.status: {}',
    'views:',
    '  - type: table',
    '    name: Active',
    '    filters:',
    '      not:',
    '        - note.status == "done"',
    '    order: [file.name, note.status]',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/not-array.base',
    view: 'Active',
  });

  assert.deepEqual(result.rows.map((row) => row.path), [
    'notes/open.md',
    'views/not-array.base',
  ]);
});

test('BaseQueryService exposes file embeds and backlinks', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/source.md', [
    '# Source',
    '',
    '[[notes/target.md|Target]]',
    '',
    '![[assets/cover.png]]',
    '',
    '![Hero](../assets/hero.webp)',
    '',
    '![[diagrams/flow.mmd]]',
  ].join('\n'));
  await writeVaultFile('notes/target.md', '# Target\n');
  await writeVaultFile('assets/cover.png', 'png-bytes');
  await writeVaultFile('assets/hero.webp', 'webp-bytes');
  await writeVaultFile('diagrams/flow.mmd', 'flowchart TD\n  A --> B\n');
  await writeVaultFile('views/references.base', [
    'views:',
    '  - type: table',
    '    name: References',
    '    filters:',
    '      and:',
    '        - file.name == "source.md" || file.name == "target.md" || file.name == "flow.mmd" || file.name == "hero.webp"',
    '    order:',
    '      - file.name',
      '      - file.embeds',
      '      - file.backlinks',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/references.base',
    view: 'References',
  });

  const sourceRow = result.rows.find((row) => row.path === 'notes/source.md');
  const diagramRow = result.rows.find((row) => row.path === 'diagrams/flow.mmd');
  const heroRow = result.rows.find((row) => row.path === 'assets/hero.webp');
  const targetRow = result.rows.find((row) => row.path === 'notes/target.md');

  assert.deepEqual(
    sourceRow.cells['file.embeds'].items.map((item) => item.path),
    ['assets/cover.png', 'assets/hero.webp', 'diagrams/flow.mmd'],
  );
  assert.deepEqual(
    heroRow.cells['file.backlinks'].items.map((item) => item.path),
    ['notes/source.md'],
  );
  assert.deepEqual(
    diagramRow.cells['file.backlinks'].items.map((item) => item.path),
    ['notes/source.md'],
  );
  assert.deepEqual(
    targetRow.cells['file.backlinks'].items.map((item) => item.path),
    ['notes/source.md'],
  );
});

test('BaseQueryService creates one row evaluation context per candidate row', async (t) => {
  const { cleanup, vaultDir, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'status: done',
    '---',
  ].join('\n'));
  await writeVaultFile('views/tasks.base', [
    'filters: file.ext == "md"',
    'formulas:',
    '  bucket: \'if(note.status == "done", "Closed", "Open")\'',
    'views:',
    '  - type: table',
    '    name: Board',
    '    filters: formula.bucket == "Open" || formula.bucket == "Closed"',
    '    order: [file.name, formula.bucket]',
  ].join('\n'));

  class CountingQueryService extends BaseQueryService {
    constructor(options) {
      super(options);
      this.rowContextCalls = 0;
    }

    createRowQueryContext(args) {
      this.rowContextCalls += 1;
      return super.createRowQueryContext(args);
    }
  }

  const vaultFileStore = new VaultFileStore({ vaultDir });
  let workspaceState = await vaultFileStore.scanWorkspaceState();
  const service = new CountingQueryService({
    vaultFileStore,
    workspaceStateProvider: () => workspaceState,
  });
  await service.snapshotStore.initializeFromWorkspaceState(workspaceState);

  const result = await service.query({
    basePath: 'views/tasks.base',
    view: 'Board',
  });

  assert.equal(result.totalRows, 2);
  assert.equal(service.rowContextCalls, service.snapshotStore.indexSnapshot.filePaths.length);
});

test('BaseQueryService reuses the in-memory snapshot for repeated queries', async (t) => {
  const { cleanup, vaultDir, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/task.md', '# Task\n');
  await writeVaultFile('views/tasks.base', [
    'views:',
    '  - type: table',
    '    order: [file.name]',
  ].join('\n'));

  const vaultFileStore = new VaultFileStore({ vaultDir });
  let workspaceState = await vaultFileStore.scanWorkspaceState();
  const service = new BaseQueryService({
    vaultFileStore,
    workspaceStateProvider: () => workspaceState,
  });
  await service.snapshotStore.initializeFromWorkspaceState(workspaceState);

  let scanCalls = 0;
  const originalScanWorkspaceState = vaultFileStore.scanWorkspaceState.bind(vaultFileStore);
  vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    return originalScanWorkspaceState(...args);
  };

  let readCalls = 0;
  const originalReadMarkdownFile = vaultFileStore.readMarkdownFile.bind(vaultFileStore);
  vaultFileStore.readMarkdownFile = async (...args) => {
    readCalls += 1;
    return originalReadMarkdownFile(...args);
  };

  await service.query({ basePath: 'views/tasks.base' });
  const readsAfterFirstQuery = readCalls;
  await service.query({ basePath: 'views/tasks.base' });

  assert.equal(scanCalls, 0);
  assert.equal(readCalls, readsAfterFirstQuery);
});

test('BaseQueryService yields between large query row chunks', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await Promise.all(Array.from({ length: 120 }, (_, index) => (
    writeVaultFile(`notes/${index}.md`, [
      '---',
      `rank: ${index}`,
      '---',
    ].join('\n'))
  )));
  const baseSource = [
    'filters: file.ext == "md"',
    'views:',
    '  - type: table',
    '    order: [file.path]',
  ].join('\n');
  await writeVaultFile('views/tasks.base', baseSource);

  await service.query({ basePath: 'views/tasks.base' });

  let queryCompleted = false;
  const marker = new Promise((resolve) => {
    setImmediate(resolve);
  });
  const queryPromise = service.query({
    source: baseSource,
    sourcePath: 'views/tasks.base',
  }).then((result) => {
    queryCompleted = true;
    return result;
  });

  await marker;
  assert.equal(queryCompleted, false);
  const result = await queryPromise;
  assert.equal(result.rows.length, 120);
});

test('BaseQueryService full snapshot rebuild reuses cached unchanged markdown rows', async (t) => {
  const { cleanup, vaultDir, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'status: done',
    '---',
  ].join('\n'));
  await writeVaultFile('views/tasks.base', [
    'views:',
    '  - type: table',
    '    order: [note.status]',
  ].join('\n'));

  const vaultFileStore = new VaultFileStore({ vaultDir });
  const service = new BaseQueryService({ vaultFileStore });
  let workspaceState = await vaultFileStore.scanWorkspaceState();
  await service.snapshotStore.buildIndexSnapshot(workspaceState);

  let readPaths = [];
  const originalReadMarkdownFile = vaultFileStore.readMarkdownFile.bind(vaultFileStore);
  vaultFileStore.readMarkdownFile = async (filePath, ...args) => {
    readPaths.push(filePath);
    return originalReadMarkdownFile(filePath, ...args);
  };

  await writeVaultFile('notes/a.md', [
    '---',
    'status: reopened',
    'priority: high',
    '---',
  ].join('\n'));
  workspaceState = await vaultFileStore.scanWorkspaceState();
  await service.snapshotStore.buildIndexSnapshot(workspaceState);

  assert.deepEqual(readPaths, ['notes/a.md']);
  assert.equal(service.snapshotStore.indexSnapshot.rowsByPath.get('notes/a.md').noteProperties.status, 'reopened');
  assert.equal(service.snapshotStore.indexSnapshot.rowsByPath.get('notes/b.md').noteProperties.status, 'done');
});

test('BaseQueryService refreshes only changed rows for content updates', async (t) => {
  const { cleanup, vaultDir, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'status: done',
    '---',
  ].join('\n'));
  await writeVaultFile('views/tasks.base', [
    'properties:',
    '  note.status: {}',
    'views:',
    '  - type: table',
    '    order: [file.name, note.status]',
  ].join('\n'));

  const vaultFileStore = new VaultFileStore({ vaultDir });
  let workspaceState = await vaultFileStore.scanWorkspaceState();
  const service = new BaseQueryService({
    vaultFileStore,
    workspaceStateProvider: () => workspaceState,
  });
  await service.snapshotStore.initializeFromWorkspaceState(workspaceState);
  await service.query({ basePath: 'views/tasks.base' });

  let readPaths = [];
  const originalReadMarkdownFile = vaultFileStore.readMarkdownFile.bind(vaultFileStore);
  vaultFileStore.readMarkdownFile = async (filePath, ...args) => {
    readPaths.push(filePath);
    return originalReadMarkdownFile(filePath, ...args);
  };

  await writeVaultFile('notes/a.md', [
    '---',
    'status: closed',
    '---',
  ].join('\n'));
  const previousState = workspaceState;
  workspaceState = await vaultFileStore.scanWorkspaceState();
  await service.applyWorkspaceChange({
    changedPaths: ['notes/a.md'],
    deletedPaths: [],
    renamedPaths: [],
  }, {
    previousState,
    nextState: workspaceState,
  });

  const result = await service.query({ basePath: 'views/tasks.base' });
  const rowA = result.rows.find((row) => row.path === 'notes/a.md');

  assert.deepEqual(readPaths, ['notes/a.md']);
  assert.equal(rowA.cells['note.status'].value, 'closed');
});

test('BaseQueryService refreshes rename membership changes incrementally', async (t) => {
  const { cleanup, vaultDir, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', '[[b]]\n');
  await writeVaultFile('notes/b.md', '# B\n');
  await writeVaultFile('views/tasks.base', [
    'views:',
    '  - type: table',
    '    order: [file.path]',
  ].join('\n'));

  const vaultFileStore = new VaultFileStore({ vaultDir });
  let workspaceState = await vaultFileStore.scanWorkspaceState();
  const service = new BaseQueryService({
    vaultFileStore,
    workspaceStateProvider: () => workspaceState,
  });
  await service.snapshotStore.initializeFromWorkspaceState(workspaceState);
  await service.query({ basePath: 'views/tasks.base' });

  let readPaths = [];
  const originalReadMarkdownFile = vaultFileStore.readMarkdownFile.bind(vaultFileStore);
  vaultFileStore.readMarkdownFile = async (filePath, ...args) => {
    readPaths.push(filePath);
    return originalReadMarkdownFile(filePath, ...args);
  };
  service.snapshotStore.rebuildBacklinks = () => {
    throw new Error('full backlink rebuild should not run for incremental rename updates');
  };
  let rowsByPathForEachCalls = 0;
  const originalRowsByPathForEach = service.snapshotStore.indexSnapshot.rowsByPath.forEach.bind(service.snapshotStore.indexSnapshot.rowsByPath);
  service.snapshotStore.indexSnapshot.rowsByPath.forEach = (...args) => {
    rowsByPathForEachCalls += 1;
    return originalRowsByPathForEach(...args);
  };

  await mkdir(join(vaultDir, 'archive'), { recursive: true });
  await rename(join(vaultDir, 'notes', 'b.md'), join(vaultDir, 'archive', 'b.md'));
  const previousState = workspaceState;
  workspaceState = await vaultFileStore.scanWorkspaceState();
  await service.applyWorkspaceChange({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'notes/b.md', newPath: 'archive/b.md' }],
  }, {
    previousState,
    nextState: workspaceState,
  });

  assert.equal(service.snapshotStore.indexSnapshot.rowsByPath.has('notes/b.md'), false);
  assert.equal(service.snapshotStore.indexSnapshot.rowsByPath.has('archive/b.md'), true);
  assert.equal(service.snapshotStore.indexSnapshot.rowsByPath.get('notes/a.md').file.links[0].path, 'archive/b.md');
  assert.deepEqual(
    service.snapshotStore.indexSnapshot.rowsByPath.get('archive/b.md').file.backlinks.map((item) => item.path),
    ['notes/a.md'],
  );
  assert.deepEqual(new Set(readPaths), new Set(['archive/b.md', 'notes/a.md']));
  assert.equal(rowsByPathForEachCalls, 0);
});

test('BaseQueryService exposes property metadata and respects search before limit', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    'score: 1',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'status: done',
    'score: 2',
    '---',
  ].join('\n'));
  await writeVaultFile('views/meta.base', [
    'filters: file.ext == "md"',
    'formulas:',
    '  bucket: \'if(note.status == "done", "Closed", "Open")\'',
    'properties:',
    '  note.status:',
    '    displayName: Status',
    '  formula.bucket:',
    '    displayName: Bucket',
    'views:',
    '  - type: table',
    '    name: Table',
    '    limit: 1',
    '    order: [note.status, formula.bucket]',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/meta.base',
    search: 'Closed',
    view: 'Table',
  });

  assert.equal(result.totalRows, 1);
  assert.equal(result.rows[0].cells['formula.bucket'].value, 'Closed');
  assert.equal(result.meta.editable, true);
  assert.deepEqual(result.meta.activeViewConfig.order, ['note.status', 'formula.bucket']);
  assert.ok(result.meta.availableProperties.some((property) => property.id === 'file.name'));
  assert.ok(result.meta.availableProperties.some((property) => property.id === 'note.status' && property.visible));
  assert.ok(result.meta.availableProperties.some((property) => property.id === 'formula.bucket' && property.kind === 'formula'));
});

test('BaseQueryService property values cap high-cardinality results', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await Promise.all(Array.from({ length: 120 }, (_, index) => (
    writeVaultFile(`notes/${index}.md`, [
      '---',
      `status: status-${index}`,
      '---',
    ].join('\n'))
  )));
  await writeVaultFile('views/status.base', [
    'filters: file.ext == "md"',
    'properties:',
    '  note.status: {}',
    'views:',
    '  - type: table',
    '    order: [note.status]',
  ].join('\n'));

  const result = await service.propertyValues({
    basePath: 'views/status.base',
    propertyId: 'note.status',
  });

  assert.equal(result.values.length, 100);
  assert.match(result.values[0].text, /status-/);
});

test('BaseQueryService enforces a configurable returned-row ceiling', async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-base-limit-test-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  const writeVaultFile = async (relativePath, content) => {
    await mkdir(join(vaultDir, dirname(relativePath)), { recursive: true });
    await writeFile(join(vaultDir, relativePath), content, 'utf8');
  };
  const service = new BaseQueryService({
    maxResultRows: 3,
    vaultFileStore: new VaultFileStore({ vaultDir }),
  });

  await Promise.all(Array.from({ length: 8 }, (_, index) => (
    writeVaultFile(`notes/${index}.md`, [
      '---',
      `rank: ${index}`,
      '---',
    ].join('\n'))
  )));
  await writeVaultFile('views/rank.base', [
    'filters: file.ext == "md"',
    'properties:',
    '  note.rank: {}',
    'views:',
    '  - type: table',
    '    order: [file.name, note.rank]',
    '    sort:',
    '      - property: note.rank',
    '        direction: desc',
  ].join('\n'));

  const result = await service.query({
    basePath: 'views/rank.base',
  });

  assert.deepEqual(result.rows.map((row) => row.path), [
    'notes/7.md',
    'notes/6.md',
    'notes/5.md',
  ]);
  assert.equal(result.totalRows, 3);
});

test('BaseQueryService property values ignore self-filters for the requested property', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'tags:',
    '  - alpha',
    '  - beta',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'tags:',
    '  - beta',
    '  - gamma',
    '---',
  ].join('\n'));
  await writeVaultFile('views/tags.base', [
    'properties:',
    '  note.tags: {}',
    'views:',
    '  - type: table',
    '    name: Tags',
    '    filters:',
    '      and:',
    '        - note.tags.contains("beta")',
    '    order: [file.name, note.tags]',
  ].join('\n'));

  const result = await service.propertyValues({
    basePath: 'views/tags.base',
    propertyId: 'note.tags',
    view: 'Tags',
  });

  assert.deepEqual(
    result.values.map((entry) => [entry.text, entry.count]),
    [
      ['beta', 2],
      ['alpha', 1],
      ['gamma', 1],
    ],
  );
});

test('BaseQueryService property values preserve unrelated filters', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    'tags:',
    '  - alpha',
    '  - beta',
    '---',
  ].join('\n'));
  await writeVaultFile('notes/b.md', [
    '---',
    'status: done',
    'tags:',
    '  - beta',
    '  - gamma',
    '---',
  ].join('\n'));
  await writeVaultFile('views/tags-status.base', [
    'properties:',
    '  note.status: {}',
    '  note.tags: {}',
    'views:',
    '  - type: table',
    '    name: Tags',
    '    filters:',
    '      and:',
    '        - note.status == "open"',
    '        - note.tags.contains("beta")',
    '    order: [file.name, note.status, note.tags]',
  ].join('\n'));

  const result = await service.propertyValues({
    basePath: 'views/tags-status.base',
    propertyId: 'note.tags',
    view: 'Tags',
  });

  assert.deepEqual(
    result.values.map((entry) => [entry.text, entry.count]),
    [
      ['alpha', 1],
      ['beta', 1],
    ],
  );
});

test('BaseQueryService transform rewrites legacy formulas into top-level formulas', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('notes/a.md', [
    '---',
    'status: open',
    '---',
  ].join('\n'));
  await writeVaultFile('views/legacy.base', [
    'properties:',
    '  formula.bucket:',
    '    displayName: Bucket',
    '    formula: \'if(note.status == "done", "Closed", "Open")\'',
    'views:',
    '  - type: table',
    '    name: Table',
    '    order: [formula.bucket]',
  ].join('\n'));

  const transformed = await service.transform({
    basePath: 'views/legacy.base',
    mutation: {
      config: {
        filters: 'note.status == "open"',
        groupBy: null,
        order: ['formula.bucket'],
        sort: [],
      },
      type: 'set-view-config',
      view: 'Table',
    },
    view: 'Table',
  });

  assert.match(transformed.source, /formulas:\n {2}bucket:/);
  assert.doesNotMatch(transformed.source, /formula:\s+'if\(note\.status/);
  assert.match(transformed.source, /filters: note\.status == "open"/);
});

test('BaseQueryService transform serializes not filters as arrays', async (t) => {
  const { cleanup, service, writeVaultFile } = await createBaseWorkspace();
  t.after(cleanup);

  await writeVaultFile('views/not-transform.base', [
    'views:',
    '  - type: table',
    '    name: Table',
  ].join('\n'));

  const transformed = await service.transform({
    basePath: 'views/not-transform.base',
    mutation: {
      config: {
        filters: {
          not: [
            'note.status == "done"',
          ],
        },
        groupBy: null,
        order: [],
        sort: [],
      },
      type: 'set-view-config',
      view: 'Table',
    },
    view: 'Table',
  });

  assert.match(transformed.source, /filters:\n\s+not:\n\s+- note\.status == "done"/);
  assert.doesNotMatch(transformed.source, /not:\n\s+or:/);
});
