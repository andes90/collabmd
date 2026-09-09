import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { startTestServer } from '../helpers/test-server.js';

async function connectMcp(t, app, {
  token = '',
  modern = false,
  url = `${app.baseUrl}/mcp`,
} = {}) {
  const client = new Client(
    { name: 'collabmd-test', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
  );
  t.after(async () => {
    await transport.close().catch(() => {});
    await app.close();
  });
  await client.connect(transport);
  return client;
}
async function callWebMcpTool(app, name, input) {
  const response = await fetch(`${app.baseUrl}/api/agent/tools/${name}`, {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
      Origin: new URL(app.baseUrl).origin,
    },
    method: 'POST',
  });
  return { body: await response.json(), response };
}



test('no-auth MCP searches, reads, edits, and creates Vault Content anonymously', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
  });
  const client = await connectMcp(t, app);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map(({ name }) => name).sort(),
    [
      'apply_text_edits',
      'create_document',
      'create_excalidraw',
      'edit_excalidraw',
      'get_collabmd_syntax',
      'inspect_document_references',
      'inspect_excalidraw',
      'list_workspace_entries',
      'query_base',
      'read_document',
      'render_diagram',
      'search_vault',
      'validate_document',
      'verify_excalidraw',
    ],
  );
  for (const tool of tools.tools) {
    assert.ok(tool.outputSchema, `${tool.name} should advertise an output schema`);
  }
  const editTool = tools.tools.find(({ name }) => name === 'apply_text_edits');
  assert.equal(editTool.inputSchema.properties.revision.pattern, '^[a-f0-9]{64}$');
  assert.match(editTool.inputSchema.properties.replacements.description, /exact text/iu);
  const listTool = tools.tools.find(({ name }) => name === 'list_workspace_entries');
  const searchTool = tools.tools.find(({ name }) => name === 'search_vault');
  assert.equal(listTool.inputSchema.properties.pathQuery.type, 'string');
  assert.equal(searchTool.inputSchema.properties.wholeWord.type, 'boolean');


  const search = await client.callTool({
    arguments: { query: 'Hello from test' },
    name: 'search_vault',
  });
  assert.equal(search.structuredContent.files[0].file, 'test.md');

  const read = await client.callTool({
    arguments: { path: 'test.md' },
    name: 'read_document',
  });
  assert.equal(read.structuredContent.startLine, 1);
  const workspace = await client.callTool({
    arguments: {},
    name: 'list_workspace_entries',
  });
  assert.equal(workspace.structuredContent.entries.some(({ path }) => path === 'test.md'), true);
  const markdownWorkspace = await client.callTool({
    arguments: { kinds: ['markdown'] },
    name: 'list_workspace_entries',
  });
  assert.equal(markdownWorkspace.structuredContent.entries.every(({ kind }) => kind === 'markdown'), true);
  const pathWorkspace = await client.callTool({
    arguments: { pathQuery: 'TEST.MD' },
    name: 'list_workspace_entries',
  });
  assert.deepEqual(pathWorkspace.structuredContent.entries.map(({ path }) => path), ['test.md']);
  const invalidCursor = await client.callTool({
    arguments: { cursor: 'deleted.md' },
    name: 'list_workspace_entries',
  });
  assert.equal(invalidCursor.isError, true);
  assert.equal(invalidCursor.structuredContent.code, 'AGENT_CURSOR_INVALID');
  const references = await client.callTool({
    arguments: { path: 'test.md' },
    name: 'inspect_document_references',
  });
  assert.deepEqual(references.structuredContent.embeds, []);
  const validation = await client.callTool({
    arguments: { path: 'test.md' },
    name: 'validate_document',
  });
  assert.equal(validation.structuredContent.valid, true);
  const wholeWordMiss = await client.callTool({
    arguments: { query: 'est', wholeWord: true },
    name: 'search_vault',
  });
  assert.deepEqual(wholeWordMiss.structuredContent.files, []);


  const edit = await client.callTool({
    arguments: {
      path: 'test.md',
      replacements: [{ oldText: 'Hello from test vault.', newText: 'Hello from agent.' }],
      revision: read.structuredContent.revision,
    },
    name: 'apply_text_edits',
  });
  assert.equal(edit.isError, undefined);
  assert.equal(await readFile(join(app.vaultDir, 'test.md'), 'utf8'), '# Test\n\nHello from agent.\n');
  const staleEdit = await client.callTool({
    arguments: {
      path: 'test.md',
      replacements: [{ oldText: 'Hello from agent.', newText: 'Stale overwrite.' }],
      revision: read.structuredContent.revision,
    },
    name: 'apply_text_edits',
  });
  assert.equal(staleEdit.isError, true);
  assert.equal(staleEdit.structuredContent.code, 'AGENT_REVISION_CONFLICT');


  const syntax = await client.callTool({
    arguments: { kind: 'mermaid' },
    name: 'get_collabmd_syntax',
  });
  assert.deepEqual(syntax.structuredContent.extensions, ['.mmd', '.mermaid']);

  await client.callTool({
    arguments: { content: 'flowchart LR\n  A --> B\n', path: 'diagrams/new.mmd' },
    name: 'create_document',
  });
  assert.equal(
    await readFile(join(app.vaultDir, 'diagrams/new.mmd'), 'utf8'),
    'flowchart LR\n  A --> B\n',
  );
  const narrowedSearch = await client.callTool({
    arguments: {
      kinds: ['mermaid'],
      maxSnippetsPerFile: 1,
      prefix: 'diagrams',
      query: 'flowchart',
    },
    name: 'search_vault',
  });
  assert.deepEqual(
    narrowedSearch.structuredContent.files.map(({ file }) => file),
    ['diagrams/new.mmd'],
  );
  assert.equal(narrowedSearch.structuredContent.files[0].snippets.length, 1);

  const createdWithoutVerification = await client.callTool({
    arguments: {
      elements: [{ height: 50, id: 'box', type: 'rectangle', width: 100, x: 0, y: 0 }],
      path: 'diagrams/no-verification.excalidraw',
    },
    name: 'create_excalidraw',
  });
  assert.equal(createdWithoutVerification.isError, undefined);
  assert.equal(createdWithoutVerification.structuredContent.verification, undefined);

  const createdDiagram = await client.callTool({
    arguments: {
      elements: [
        { height: 80, id: 'service', type: 'rectangle', width: 160, x: 20, y: 20 },
        { containerId: 'service', id: 'service-label', text: 'Service', type: 'text', x: 60, y: 45 },
      ],
      path: 'diagrams/service.excalidraw',
      verify: { format: 'svg', render: true },
    },
    name: 'create_excalidraw',
  });
  assert.equal(createdDiagram.structuredContent.elementCount, 2);
  assert.equal(createdDiagram.structuredContent.verification.renderer, 'collabmd-basic-svg');
  assert.equal(
    createdDiagram.content.find(({ type }) => type === 'image').mimeType,
    'image/svg+xml',
  );
  const editedDiagram = await client.callTool({
    arguments: {
      create: [{ height: 80, id: 'database', type: 'ellipse', width: 120, x: 280, y: 20 }],
      path: 'diagrams/service.excalidraw',
      revision: createdDiagram.structuredContent.revision,
      update: [{ id: 'service', set: { backgroundColor: '#a5d8ff' } }],
    },
    name: 'edit_excalidraw',
  });
  assert.equal(editedDiagram.isError, undefined);
  const diagram = JSON.parse(await readFile(join(app.vaultDir, 'diagrams/service.excalidraw'), 'utf8'));
  assert.deepEqual(diagram.elements.map(({ id }) => id), ['service', 'service-label', 'database']);
  assert.equal(diagram.elements[0].backgroundColor, '#a5d8ff');
  const verifiedEdit = await client.callTool({
    arguments: {
      path: 'diagrams/service.excalidraw',
      revision: editedDiagram.structuredContent.revision,
      translate: { dx: 40, dy: 10, ids: ['service'] },
      update: [{ id: 'service-label', set: { height: 25, text: 'Primary', x: 58, y: 47.5 } }],
      verify: { format: 'svg', render: true },
    },
    name: 'edit_excalidraw',
  });
  const verifiedEditImage = verifiedEdit.content.find(({ type }) => type === 'image');
  const updatedDiagram = JSON.parse(await readFile(join(app.vaultDir, 'diagrams/service.excalidraw'), 'utf8'));
  assert.equal(verifiedEdit.structuredContent.translated, 1);
  assert.equal(verifiedEdit.structuredContent.verification.renderer, 'collabmd-basic-svg');
  assert.equal(verifiedEditImage.mimeType, 'image/svg+xml');
  assert.equal(updatedDiagram.elements.find(({ id }) => id === 'service').x, 60);
  assert.equal(updatedDiagram.elements.find(({ id }) => id === 'service-label').originalText, 'Primary');
  assert.equal(updatedDiagram.elements.find(({ id }) => id === 'service-label').x, 98);
  assert.equal(updatedDiagram.elements.find(({ id }) => id === 'service-label').y, 57.5);

  const inspectedDiagram = await client.callTool({
    arguments: { path: 'diagrams/service.excalidraw' },
    name: 'inspect_excalidraw',
  });
  assert.equal(inspectedDiagram.structuredContent.elementCount, 3);
  assert.equal(
    inspectedDiagram.structuredContent.elements.find(({ id }) => id === 'service-label').containerId,
    'service',
  );
  assert.deepEqual(inspectedDiagram.structuredContent.warnings, []);


  const verifiedDiagram = await client.callTool({
    arguments: { format: 'png', inspectOcclusion: true, path: 'diagrams/service.excalidraw' },
    name: 'verify_excalidraw',
  });
  const verifiedImage = verifiedDiagram.content.find(({ type }) => type === 'image');
  assert.equal(verifiedImage.mimeType, 'image/png');
  assert.equal(Buffer.from(verifiedImage.data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(
    verifiedDiagram.structuredContent.inspection.elementCount,
    verifiedDiagram.structuredContent.elementCount,
  );
  assert.equal(verifiedDiagram.structuredContent.revision, verifiedEdit.structuredContent.revision);

  const compactVerification = await client.callTool({
    arguments: { path: 'diagrams/service.excalidraw', render: false },
    name: 'verify_excalidraw',
  });
  assert.equal(compactVerification.content.some(({ type }) => type === 'image'), false);
  assert.equal(Object.hasOwn(compactVerification.structuredContent, 'scene'), false);
  assert.equal(compactVerification.structuredContent.layout.boundText.misaligned, 0);
});

test('MCP reconciles edits through an active collaboration room', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
  });
  const room = app.server.roomRegistry.getOrCreate('test.md');
  await room.hydrate();
  const client = await connectMcp(t, app);
  const initial = await client.callTool({
    arguments: { path: 'test.md' },
    name: 'read_document',
  });

  const oldText = 'Hello from test vault.';
  const collaboratorText = 'Hello from collaborator.';
  const from = room.readEditableContent().indexOf(oldText);
  room.applyExactTextChanges([{
    from,
    insert: collaboratorText,
    to: from + oldText.length,
  }], { origin: 'test-collaborator' });

  const stale = await client.callTool({
    arguments: {
      path: 'test.md',
      replacements: [{ oldText: collaboratorText, newText: 'Stale overwrite.' }],
      revision: initial.structuredContent.revision,
    },
    name: 'apply_text_edits',
  });
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent.code, 'AGENT_REVISION_CONFLICT');

  const current = await client.callTool({
    arguments: { path: 'test.md' },
    name: 'read_document',
  });
  assert.match(current.structuredContent.content, /Hello from collaborator\./u);
  const edited = await client.callTool({
    arguments: {
      path: 'test.md',
      replacements: [{ oldText: collaboratorText, newText: 'Hello from agent room.' }],
      revision: current.structuredContent.revision,
    },
    name: 'apply_text_edits',
  });
  assert.equal(edited.isError, undefined);
  assert.match(room.readEditableContent(), /Hello from agent room\./u);
  await room.persist();
  assert.equal(await readFile(join(app.vaultDir, 'test.md'), 'utf8'), '# Test\n\nHello from agent room.\n');
});

test('browser-session WebMCP tools reuse agent content operations when remote MCP is disabled', async (t) => {
  const app = await startTestServer();
  t.after(app.close);

  const shortSearch = await callWebMcpTool(app, 'search_vault', { query: 'x' });
  assert.equal(shortSearch.response.status, 400);
  assert.equal(shortSearch.body.code, 'AGENT_INPUT_INVALID');

  const unknownInput = await callWebMcpTool(app, 'list_workspace_entries', { unexpected: true });
  assert.equal(unknownInput.response.status, 400);
  assert.equal(unknownInput.body.code, 'AGENT_INPUT_INVALID');

  const read = await callWebMcpTool(app, 'read_document', { path: 'test.md' });
  assert.equal(read.response.status, 200);
  assert.equal(read.body.path, 'test.md');

  const edit = await callWebMcpTool(app, 'apply_text_edits', {
    path: 'test.md',
    replacements: [{ oldText: 'Hello from test vault.', newText: 'Hello from WebMCP.' }],
    revision: read.body.revision,
  });
  assert.equal(edit.response.status, 200);
  assert.equal(await readFile(join(app.vaultDir, 'test.md'), 'utf8'), '# Test\n\nHello from WebMCP.\n');

  const stale = await callWebMcpTool(app, 'apply_text_edits', {
    path: 'test.md',
    replacements: [{ oldText: 'Hello from WebMCP.', newText: 'Stale overwrite.' }],
    revision: read.body.revision,
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'AGENT_REVISION_CONFLICT');

  const created = await callWebMcpTool(app, 'create_excalidraw', {
    elements: [{ height: 80, id: 'service', type: 'rectangle', width: 160, x: 20, y: 20 }],
    path: 'diagrams/webmcp.excalidraw',
    verify: { render: true },
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.image, undefined);
  assert.equal(created.body.verification.elementCount, 1);
  assert.equal(created.body.verification.scene.type, 'excalidraw');

  const rendered = await callWebMcpTool(app, 'verify_excalidraw', {
    path: 'diagrams/webmcp.excalidraw',
  });
  assert.equal(rendered.response.status, 200);
  assert.equal(rendered.body.image, undefined);
  assert.equal(rendered.body.elementCount, 1);
  assert.equal(rendered.body.scene.type, 'excalidraw');

  const compactVerification = await callWebMcpTool(app, 'verify_excalidraw', {
    path: 'diagrams/webmcp.excalidraw',
    render: false,
  });
  assert.equal(compactVerification.response.status, 200);
  assert.equal(compactVerification.body.image, undefined);
  assert.equal(compactVerification.body.scene, undefined);
  assert.equal(compactVerification.body.layout.boundText.total, 0);
});



test('password MCP endpoint requires managed bearer token', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
    auth: { password: 'office-secret', strategy: 'password' },
  });
  t.after(app.close);
  const response = await fetch(`${app.baseUrl}/mcp`, {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'initialize', params: {} }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /^Bearer/);
});

test('no-auth MCP rejects untrusted browser origins without blocking direct clients', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
  });
  t.after(app.close);

  async function initializeFromBrowser(hostname) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'browser-test', version: '1.0.0' },
          protocolVersion: '2025-11-25',
        },
      });
      const req = request({
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          'Content-Type': 'application/json',
          Host: `${hostname}:${app.port}`,
          Origin: `http://${hostname}:${app.port}`,
        },
        hostname: '127.0.0.1',
        method: 'POST',
        path: '/mcp',
        port: app.port,
      }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  assert.equal(await initializeFromBrowser('attacker.example'), 403);
  assert.equal(await initializeFromBrowser('127.0.0.1'), 200);
});

test('MCP rate limits tool calls per anonymous client', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true, requestsPerMinute: 2 },
  });
  const client = await connectMcp(t, app);

  for (let index = 0; index < 2; index += 1) {
    const result = await client.callTool({ arguments: {}, name: 'list_workspace_entries' });
    assert.equal(result.isError, undefined);
  }
  const limited = await client.callTool({ arguments: {}, name: 'list_workspace_entries' });
  assert.equal(limited.isError, true);
  assert.equal(limited.structuredContent.code, 'AGENT_RATE_LIMITED');
  assert.ok(limited.structuredContent.retryAfterMs > 0);
});

test('MCP hides unexpected service errors from agents', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
  });
  const client = await connectMcp(t, app);
  app.server.agentContentService.searchVault = async () => {
    throw new Error('private path: /secret/vault');
  };

  const result = await client.callTool({
    arguments: { query: 'secret' },
    name: 'search_vault',
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    code: 'AGENT_TOOL_FAILED',
    error: 'Agent tool failed',
  });
  assert.doesNotMatch(result.content[0].text, /secret\/vault/u);
});

test('managed read-only MCP token limits tools and revocation takes effect immediately', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
    auth: { password: 'office-secret', strategy: 'password' },
  });
  const created = await app.server.agentConnectionService.createConnection({
    clientKind: 'generic',
    label: 'Read-only integration',
    scopes: ['vault:read'],
    user: null,
  });
  const client = await connectMcp(t, app, { modern: true, token: created.token });
  assert.equal(client.getProtocolEra(), 'modern');

  const tools = await client.listTools();
  assert.equal(tools.tools.some(({ name }) => name === 'apply_text_edits'), false);
  assert.equal(tools.tools.some(({ name }) => name === 'create_document'), false);
  assert.equal(tools.tools.some(({ name }) => name === 'inspect_excalidraw'), true);
  assert.equal(tools.tools.some(({ name }) => name === 'query_base'), true);
  await app.server.agentConnectionService.revokeConnection({
    connectionId: created.connection.id,
    user: null,
  });
  await assert.rejects(client.listTools(), /401|authorization|token/iu);
});

test('MCP works under configured base path', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
    basePath: '/notes',
  });
  const client = await connectMcp(t, app, { url: `${app.appBaseUrl}/mcp` });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 14);
  assert.equal(tools.tools.some(({ name }) => name === 'query_base'), true);
});

test('password session manages workspace-level Agent Connections', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
    basePath: '/app-partnership/collabmd',
    auth: { password: 'office-secret', strategy: 'password' },
  });
  t.after(app.close);
  const login = await fetch(`${app.appBaseUrl}/api/auth/session`, {
    body: JSON.stringify({ password: 'office-secret' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const createdResponse = await fetch(`${app.appBaseUrl}/api/agent/connections`, {
    body: JSON.stringify({
      clientKind: 'codex',
      label: 'Password Codex',
      scopes: ['vault:read'],
    }),
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    method: 'POST',
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.token, /^cmd_agent_/);

  const listResponse = await fetch(`${app.appBaseUrl}/api/agent/connections`, {
    headers: { Cookie: cookie },
  });
  const listed = await listResponse.json();
  assert.equal(listed.connections[0].label, 'Password Codex');
  assert.equal(listed.connections[0].token, undefined);

  const revokeResponse = await fetch(
    `${app.appBaseUrl}/api/agent/connections/${created.connection.id}`,
    { headers: { Cookie: cookie }, method: 'DELETE' },
  );
  assert.equal(revokeResponse.status, 200);
  const revokedListResponse = await fetch(`${app.appBaseUrl}/api/agent/connections`, {
    headers: { Cookie: cookie },
  });
  assert.equal(revokedListResponse.status, 200);
  assert.deepEqual((await revokedListResponse.json()).connections, []);
  await assert.rejects(
    app.server.agentConnectionService.authenticateToken(created.token),
    { code: 'AGENT_TOKEN_INVALID' },
  );
});


test('MCP creates, updates, and queries Base files', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
  });
  const client = await connectMcp(t, app);

  await client.callTool({
    arguments: {
      content: ['---', 'status: open', '---', '', '# Task A', '', '#task', ''].join('\n'),
      path: 'notes/task-a.md',
    },
    name: 'create_document',
  });
  await client.callTool({
    arguments: {
      content: ['---', 'status: done', '---', '', '# Task B', '', '#task', ''].join('\n'),
      path: 'notes/task-b.md',
    },
    name: 'create_document',
  });

  const created = await client.callTool({
    arguments: {
      content: [
        'filters: file.ext == "md" && file.hasTag("task") && note.status == "open"',
        'properties:',
        '  note.status: {}',
        'views:',
        '  - type: table',
        '    name: Board',
        '    order: [file.name, note.status]',
      ].join('\n'),
      path: 'views/tasks.base',
    },
    name: 'create_document',
  });
  assert.equal(created.structuredContent.kind, 'base');

  const queried = await client.callTool({
    arguments: { path: 'views/tasks.base', view: 'Board' },
    name: 'query_base',
  });
  assert.equal(queried.isError, undefined);
  assert.deepEqual(queried.structuredContent.rows.map(({ path }) => path), ['notes/task-a.md']);
  assert.equal(queried.structuredContent.rows[0].cells['note.status'], 'open');

  const read = await client.callTool({
    arguments: { path: 'views/tasks.base' },
    name: 'read_document',
  });
  const edited = await client.callTool({
    arguments: {
      path: 'views/tasks.base',
      replacements: [{ oldText: 'note.status == "open"', newText: 'note.status == "done"' }],
      revision: read.structuredContent.revision,
    },
    name: 'apply_text_edits',
  });
  assert.equal(edited.isError, undefined);

  const requery = await client.callTool({
    arguments: { path: 'views/tasks.base', view: 'Board' },
    name: 'query_base',
  });
  assert.deepEqual(requery.structuredContent.rows.map(({ path }) => path), ['notes/task-b.md']);

  const invalid = await client.callTool({
    arguments: { content: '- not an object\n', path: 'views/broken.base' },
    name: 'create_document',
  });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.code, 'AGENT_INVALID_BASE');
});

test('MCP and WebMCP support compact retrieval, outlines, and validated authoring', async (t) => {
  const app = await startTestServer({ agentAccess: { enabled: true } });
  const client = await connectMcp(t, app);
  for (let index = 0; index < 12; index += 1) {
    const content = [
      '# Retrieval fixture',
      ...Array.from({ length: 99 }, (_, line) => `Evidence needle ${line}: retained source context.`),
    ].join('\n');
    const created = await client.callTool({
      name: 'create_document', arguments: { path: `evaluation/note-${String(index).padStart(2, '0')}.md`, content },
    });
    assert.equal(created.isError, undefined);
  }
  const call = async (name, input) => {
    const result = await client.callTool({ name, arguments: input });
    assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
    return result.structuredContent;
  };
  const baselineSearch = await call('search_vault', { query: 'Evidence needle', prefix: 'evaluation', limit: 50, maxSnippetsPerFile: 5 });
  const compactSearch = await call('search_vault', { query: 'Evidence needle', prefix: 'evaluation' });
  assert.equal(compactSearch.files.length, 10);
  assert.ok(compactSearch.files.every(({ snippets }) => snippets.length === 2));
  const evidencePath = compactSearch.files[0].file;
  const baselineRead = await call('read_document', { path: evidencePath, lineCount: 500 });
  const compactRead = await call('read_document', { path: evidencePath });
  assert.equal(compactRead.endLine, 80);
  assert.equal(compactRead.nextStartLine, 81);
  assert.ok(compactRead.content.includes(compactSearch.files[0].snippets[0].text));
  assert.equal(compactRead.revision, baselineRead.revision);
  const baselineBytes = Buffer.byteLength(JSON.stringify([baselineSearch, baselineRead]));
  const compactBytes = Buffer.byteLength(JSON.stringify([compactSearch, compactRead]));
  assert.ok(compactBytes < baselineBytes);
  t.diagnostic(`Fixed retrieval fixture: ${baselineBytes} -> ${compactBytes} JSON bytes, two calls each; same first-document evidence and revision. This does not measure model tokens or semantic answer quality.`);

  const outline = await call('read_document', { path: evidencePath, mode: 'outline' });
  assert.equal(outline.content, '');
  assert.equal(outline.headings[0].text, 'Retrieval fixture');
  assert.equal(outline.revision, compactRead.revision);
  const browserOutline = await callWebMcpTool(app, 'read_document', { path: evidencePath, mode: 'outline' });
  assert.equal(browserOutline.response.status, 200);
  assert.deepEqual(browserOutline.body, outline);
  const created = await call('create_document', { path: 'evaluation/summary.md', content: '# Summary\n[[missing-target]]', validate: true });
  assert.equal(created.validation.valid, false);
  const edited = await callWebMcpTool(app, 'apply_text_edits', {
    path: created.path, revision: created.revision, validate: true,
    replacements: [{ oldText: '[[missing-target]]', newText: '[[evaluation/note-00]]' }],
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.body.validation.valid, true);
  const current = await call('read_document', { path: created.path });
  assert.equal(current.revision, edited.body.revision);
  assert.equal(current.content, '# Summary\n[[evaluation/note-00]]');
  const stale = await client.callTool({ name: 'apply_text_edits', arguments: {
    path: created.path, revision: created.revision,
    replacements: [{ oldText: '# Summary', newText: '# Stale' }], validate: true,
  } });
  assert.equal(stale.structuredContent.code, 'AGENT_REVISION_CONFLICT');
});

test('MCP live search suppresses removed disk evidence and still fills a limited result', async (t) => {
  const app = await startTestServer({ agentAccess: { enabled: true } });
  const client = await connectMcp(t, app);
  for (const path of ['live.md', 'closed.md']) {
    await client.callTool({ name: 'create_document', arguments: { path, content: 'uniqueneedle' } });
  }
  const room = app.server.roomRegistry.getOrCreate('live.md');
  await room.hydrate();
  room.applyExactTextChanges([{ from: 0, to: 12, insert: 'removed' }], { origin: 'test-collaborator' });
  const result = await client.callTool({ name: 'search_vault', arguments: { query: 'uniqueneedle', limit: 1, kinds: ['markdown'] } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent.files.map(({ file }) => file), ['closed.md']);
  assert.equal(result.structuredContent.truncated, false);
});

test('MCP searches current visible text in an active Excalidraw room', async (t) => {
  const app = await startTestServer({ agentAccess: { enabled: true } });
  const client = await connectMcp(t, app);
  const created = await client.callTool({ name: 'create_excalidraw', arguments: {
    path: 'live.excalidraw', elements: [{ id: 'label', type: 'text', x: 0, y: 0, text: 'oldneedle' }],
  } });
  const room = app.server.roomRegistry.getOrCreate('live.excalidraw');
  await room.hydrate();
  const inspection = await client.callTool({ name: 'inspect_excalidraw', arguments: { path: created.structuredContent.path } });
  const edited = await client.callTool({ name: 'edit_excalidraw', arguments: {
    path: 'live.excalidraw', revision: inspection.structuredContent.revision,
    update: [{ id: 'label', set: { text: 'newneedle' } }],
  } });
  assert.equal(edited.isError, undefined);
  const result = await client.callTool({ name: 'search_vault', arguments: { query: 'newneedle', kinds: ['excalidraw'] } });
  assert.equal(result.structuredContent.files[0].snippets[0].text, 'newneedle');
  assert.equal(result.structuredContent.truncated, false);
  const stale = await client.callTool({ name: 'search_vault', arguments: { query: 'oldneedle', kinds: ['excalidraw'] } });
  assert.deepEqual(stale.structuredContent.files, []);
});

test('Excalidraw design guidance is on demand and its examples create verified scenes over MCP', async (t) => {
  const app = await startTestServer({ agentAccess: { enabled: true } });
  const client = await connectMcp(t, app);
  const capabilities = await client.callTool({ name: 'get_collabmd_syntax', arguments: {} });
  const summary = capabilities.structuredContent.capabilities.find(({ kind }) => kind === 'excalidraw');
  const syntax = await client.callTool({ name: 'get_collabmd_syntax', arguments: { kind: 'excalidraw' } });
  assert.equal(syntax.isError, undefined);
  const guide = syntax.structuredContent;
  assert.ok(guide.guide.length > summary.guide.length);
  assert.ok(summary.examples.every((example) => !example.startsWith('{')));
  const browserSyntax = await callWebMcpTool(app, 'get_collabmd_syntax', { kind: 'excalidraw' });
  assert.equal(browserSyntax.response.status, 200);
  assert.deepEqual(browserSyntax.body, guide);

  const examples = guide.examples.filter((example) => example.startsWith('{')).map((example) => JSON.parse(example));
  assert.equal(examples.length, 2);
  for (const example of examples) {
    const created = await client.callTool(example);
    assert.equal(created.isError, undefined, JSON.stringify(created.structuredContent));
    const { inspection } = created.structuredContent.verification;
    assert.equal(inspection.valid, true);
    assert.deepEqual(inspection.warnings, []);
    assert.equal(inspection.layout.boundText.misaligned, 0);
    const image = created.content.find(({ type }) => type === 'image');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const inspected = await client.callTool({ name: 'inspect_excalidraw', arguments: { path: example.arguments.path } });
    assert.equal(inspected.structuredContent.revision, created.structuredContent.revision);
    assert.equal(inspected.structuredContent.elements.filter(({ containerId }) => containerId).length, 3);
    assert.equal(inspected.structuredContent.elements.filter(({ startElementId, endElementId }) => startElementId && endElementId).length, 2);
  }
});
