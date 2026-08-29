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
    onDidMutate: (mutation) => mutations.push(mutation),
  });

  assert.equal(await registry.refresh(), false);
  active = true;
  assert.equal(await registry.refresh(), true);
  assert.deepEqual(
    [...modelContext.tools.keys()].sort(),
    listWebMcpToolDefinitions().map(({ name }) => toWebMcpToolName(name)).sort(),
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

