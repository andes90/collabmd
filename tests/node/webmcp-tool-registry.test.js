import assert from 'node:assert/strict';
import test from 'node:test';

import { WebMcpToolRegistry } from '../../src/client/infrastructure/webmcp-tool-registry.js';

function createModelContext({ failOn = '' } = {}) {
  const tools = new Map();
  return {
    tools,
    async registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      if (tool.name === failOn) throw new Error('registration failed');
    },
  };
}

function createRegistry(modelContext, session, options = {}) {
  return new WebMcpToolRegistry({
    getActiveFilePath: () => 'notes.md',
    getIsTabActive: () => true,
    getSession: () => session,
    modelContext,
    ...options,
  });
}

test('WebMCP tools edit only an active synchronized supported document', async () => {
  const modelContext = createModelContext();
  let active = true;
  let content = '# Notes\n\nHello world\n';
  let path = 'README.md';
  let synchronized = false;
  const session = {
    applyTextReplacements(replacements) {
      for (const replacement of replacements) {
        content = content.replace(replacement.oldText, replacement.newText);
      }
      return replacements.length;
    },
    getText: () => content,
    isInitialSyncComplete: () => synchronized,
  };
  const registry = createRegistry(modelContext, session, {
    getActiveFilePath: () => path,
    getIsTabActive: () => active,
  });

  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);

  synchronized = true;
  assert.equal(await registry.refresh(), true);
  const readTool = modelContext.tools.get('collabmd_read_active_document');
  const editTool = modelContext.tools.get('collabmd_apply_text_edits');
  const snapshot = await readTool.execute({});

  assert.deepEqual(
    { content: snapshot.content, kind: snapshot.kind, path: snapshot.path },
    { content, kind: 'markdown', path },
  );
  const result = await editTool.execute({
    path,
    replacements: [{ newText: 'Hello agent', oldText: 'Hello world' }],
    revision: snapshot.revision,
  });
  assert.equal(content, '# Notes\n\nHello agent\n');
  assert.equal(result.replacementCount, 1);
  await assert.rejects(
    editTool.execute({
      path,
      replacements: [{ newText: 'Stale edit', oldText: 'Hello agent' }],
      revision: snapshot.revision,
    }),
    /changed; read it again/,
  );

  active = false;
  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);
  active = true;
  assert.equal(await registry.refresh(), true);


  path = 'drawing.excalidraw';
  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);

});

test('WebMCP cleans up partial registration failures', async () => {
  const modelContext = createModelContext({
    failOn: 'collabmd_get_supported_syntax',
  });
  const registry = createRegistry(modelContext, {
    getText: () => '# Notes\n',
    isInitialSyncComplete: () => true,
  });

  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);
});

test('WebMCP read observes cancellation and concurrent document changes', async () => {
  const modelContext = createModelContext();
  let reads = 0;
  const registry = createRegistry(modelContext, {
    getText() {
      reads += 1;
      return reads === 1 ? '# Initial\n' : '# Changed\n';
    },
    isInitialSyncComplete: () => true,
  });
  await registry.refresh();
  const readTool = modelContext.tools.get('collabmd_read_active_document');
  const controller = new AbortController();
  controller.abort(new Error('cancelled by client'));

  await assert.rejects(
    readTool.execute({}, { signal: controller.signal }),
    /cancelled by client/u,
  );
  await assert.rejects(readTool.execute({}), /changed while it was being read/u);
});

