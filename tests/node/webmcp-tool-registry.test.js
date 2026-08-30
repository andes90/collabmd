import assert from 'node:assert/strict';
import test from 'node:test';

import { WebMcpToolRegistry } from '../../src/client/infrastructure/webmcp-tool-registry.js';
import {
  listWebMcpToolDefinitions,
  toWebMcpToolName,
} from '../../src/domain/agent-tool-definitions.js';

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

test('WebMCP exposes every shared browser tool while the workspace tab is active', async () => {
  const calls = [];
  const mutations = [];
  const modelContext = createModelContext();
  let active = false;
  const registry = new WebMcpToolRegistry({
    callTool: async (name, input, options) => {
      calls.push({ input, name, signal: options.signal });
      return { name, ok: true };
    },
    getIsTabActive: () => active,
    modelContext,
    getActiveContext: () => ({
      activeDiagramPath: 'diagrams/current.excalidraw',
      activePath: 'diagrams/current.excalidraw',
    }),
    onDidMutate: (mutation) => mutations.push(mutation),
  });

  assert.equal(await registry.refresh(), false);
  active = true;
  assert.equal(await registry.refresh(), true);
  assert.deepEqual(
    [...modelContext.tools.keys()].sort(),
    [
      'collabmd_get_active_context',
      ...listWebMcpToolDefinitions().map(({ name }) => toWebMcpToolName(name)),
    ].sort(),
  );
  assert.deepEqual(
    await modelContext.tools.get('collabmd_get_active_context').execute(),
    {
      activeDiagramPath: 'diagrams/current.excalidraw',
      activePath: 'diagrams/current.excalidraw',
      preferredDiagramPath: 'diagrams/current.excalidraw',
      workflow: 'Current diagram is diagrams/current.excalidraw. Inspect it, edit with the returned exact revision, request inline verification, then use the returned canvas paint acknowledgement.',
    },
  );

  const readTool = modelContext.tools.get('collabmd_read_document');
  const readResult = await readTool.execute({ path: 'notes.md' });
  assert.deepEqual(readResult, { name: 'read_document', ok: true });
  assert.equal(readTool.annotations.readOnlyHint, true);
  assert.equal(readTool.annotations.untrustedContentHint, true);
  assert.equal(mutations.length, 0);
  const editTool = modelContext.tools.get('collabmd_apply_text_edits');
  const editResult = await editTool.execute({
    path: 'notes.md',
    replacements: [{ newText: 'Next', oldText: 'Current' }],
    revision: 'a'.repeat(64),
  });
  assert.deepEqual(editResult, { name: 'apply_text_edits', ok: true });
  assert.equal(calls.at(-1).name, 'apply_text_edits');
  assert.equal(mutations.at(-1).name, 'apply_text_edits');

  active = false;
  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);
});

test('WebMCP returns structured agent failures', async () => {
  const modelContext = createModelContext();
  const registry = new WebMcpToolRegistry({
    callTool: async () => {
      const error = new Error('Failed to execute search_vault');
      error.body = {
        code: 'AGENT_RATE_LIMITED',
        error: 'Agent tool rate limit exceeded',
        retryAfterMs: 250,
      };
      throw error;
    },
    getIsTabActive: () => true,
    modelContext,
  });
  await registry.refresh();

  const result = await modelContext.tools.get('collabmd_search_vault').execute({
    query: 'diagram',
  });

  assert.deepEqual(result, {
    code: 'AGENT_RATE_LIMITED',
    error: 'Agent tool rate limit exceeded',
    isError: true,
    retryAfterMs: 250,
  });
});

test('WebMCP rethrows unexpected agent request failures', async () => {
  const modelContext = createModelContext();
  const serverError = new Error('Agent request failed');
  serverError.body = {
    code: 'AGENT_REQUEST_FAILED',
    error: 'Agent request failed',
  };
  const registry = new WebMcpToolRegistry({
    callTool: async () => {
      throw serverError;
    },
    getIsTabActive: () => true,
    modelContext,
  });
  await registry.refresh();

  await assert.rejects(
    modelContext.tools.get('collabmd_search_vault').execute({ query: 'diagram' }),
    (error) => error === serverError,
  );
});

test('WebMCP replaces server previews with official browser snapshot rendering', async () => {
  const modelContext = createModelContext();
  const mutations = [];
  const scene = {
    appState: {},
    elements: [{ height: 80, id: 'box', type: 'rectangle', width: 120, x: 0, y: 0 }],
    files: {},
    type: 'excalidraw',
  };
  const registry = new WebMcpToolRegistry({
    callTool: async (name) => {
      if (name === 'create_excalidraw' || name === 'edit_excalidraw') {
        return {
          verification: { elementCount: scene.elements.length, scene },
        };
      }
      return { elementCount: scene.elements.length, format: 'png', scene };
    },
    getIsTabActive: () => true,
    modelContext,
    onDidMutate: (mutation) => mutations.push(mutation),
    renderExcalidrawScene: async (_scene, options) => ({
      format: options.format,
      image: { data: 'exact', encoding: 'base64', mimeType: 'image/png' },
      renderer: 'excalidraw-official-browser',
      scale: options.scale,
    }),
  });
  await registry.refresh();

  const rendered = await modelContext.tools.get('collabmd_verify_excalidraw').execute({
    path: 'diagram.excalidraw',
  });
  assert.equal(rendered.renderer, 'excalidraw-official-browser');
  assert.equal(rendered.image.data, 'exact');
  assert.equal(rendered.elementCount, 1);
  assert.equal(Object.hasOwn(rendered, 'scene'), false);

  const created = await modelContext.tools.get('collabmd_create_excalidraw').execute({
    elements: scene.elements,
    path: 'created.excalidraw',
    verify: { render: true },
  });
  assert.equal(created.verification.renderer, 'excalidraw-official-browser');
  assert.equal(created.verification.elementCount, 1);
  assert.equal(created.image.data, 'exact');
  assert.equal(Object.hasOwn(created.verification, 'scene'), false);

  const edited = await modelContext.tools.get('collabmd_edit_excalidraw').execute({
    path: 'diagram.excalidraw',
    revision: 'a'.repeat(64),
    translate: { dx: 10, dy: 0, ids: ['box'] },
    verify: { render: true },
  });
  assert.equal(edited.verification.renderer, 'excalidraw-official-browser');
  assert.equal(edited.image.data, 'exact');
  assert.equal(Object.hasOwn(edited.verification, 'scene'), false);
  assert.equal(mutations.at(-1).result, edited);
});

test('WebMCP flushes an active editor and returns paint acknowledgement', async () => {
  const events = [];
  const modelContext = createModelContext();
  const revision = 'b'.repeat(64);
  const registry = new WebMcpToolRegistry({
    acknowledgeToolCall: async ({ name, preparation, result }) => {
      events.push(`ack:${name}:${result.revision}:${preparation.revision}`);
      return { revision: result.revision, status: 'painted' };
    },
    callTool: async (name) => {
      events.push(`call:${name}`);
      return { revision };
    },
    getIsTabActive: () => true,
    modelContext,
    prepareToolCall: async ({ name }) => {
      events.push(`prepare:${name}`);
      return { revision: 'c'.repeat(64), status: 'flushed' };
    },
  });
  await registry.refresh();

  const result = await modelContext.tools.get('collabmd_edit_excalidraw').execute({
    path: 'diagram.excalidraw',
    revision: 'a'.repeat(64),
  });

  assert.deepEqual(events, [
    'prepare:edit_excalidraw',
    'call:edit_excalidraw',
    `ack:edit_excalidraw:${revision}:${'c'.repeat(64)}`,
  ]);
  assert.deepEqual(result.webMcp, {
    acknowledgement: { revision, status: 'painted' },
    preparation: { revision: 'c'.repeat(64), status: 'flushed' },
  });
});

test('WebMCP reports exact browser rendering failures to the agent', async () => {
  const modelContext = createModelContext();
  const registry = new WebMcpToolRegistry({
    callTool: async () => ({
      elementCount: 1,
      format: 'png',
      scene: {
        appState: {},
        elements: [{ height: 80, id: 'box', type: 'rectangle', width: 120, x: 0, y: 0 }],
        files: {},
        type: 'excalidraw',
      },
    }),
    getIsTabActive: () => true,
    modelContext,
    renderExcalidrawScene: async () => {
      throw new Error('renderer unavailable');
    },
  });
  await registry.refresh();

  const result = await modelContext.tools.get('collabmd_verify_excalidraw').execute({
    path: 'diagram.excalidraw',
  });

  assert.deepEqual(result.warnings, ['exact-render-unavailable']);
  assert.equal(Object.hasOwn(result, 'scene'), false);
});

test('WebMCP cleans up partial registration failures', async () => {
  const modelContext = createModelContext({
    failOn: 'collabmd_get_collabmd_syntax',
  });
  const registry = new WebMcpToolRegistry({
    callTool: async () => ({}),
    getIsTabActive: () => true,
    modelContext,
  });

  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);
});

test('WebMCP forwards tool cancellation to the browser-session request', async () => {
  const modelContext = createModelContext();
  let receivedSignal;
  const registry = new WebMcpToolRegistry({
    callTool: async (_name, _input, { signal }) => {
      receivedSignal = signal;
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    getIsTabActive: () => true,
    modelContext,
  });
  await registry.refresh();
  const readTool = modelContext.tools.get('collabmd_read_document');
  const controller = new AbortController();
  const execution = readTool.execute({ path: 'notes.md' }, { signal: controller.signal });
  controller.abort(new Error('cancelled by client'));

  await assert.rejects(execution, /cancelled by client/u);
  assert.equal(receivedSignal, controller.signal);
});
