import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { startTestServer } from '../helpers/test-server.js';

async function connectMcp(t, app, {
  token = '',
  url = `${app.baseUrl}/mcp`,
} = {}) {
  const client = new Client({ name: 'collabmd-test', version: '1.0.0' });
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
      'get_collabmd_syntax',
      'list_documents',
      'read_document',
      'search_vault',
    ],
  );
  for (const tool of tools.tools) {
    assert.ok(tool.outputSchema, `${tool.name} should advertise an output schema`);
  }
  const editTool = tools.tools.find(({ name }) => name === 'apply_text_edits');
  assert.equal(editTool.inputSchema.properties.revision.pattern, '^[a-f0-9]{64}$');
  assert.match(editTool.inputSchema.properties.replacements.description, /exact text/iu);


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
    const result = await client.callTool({ arguments: {}, name: 'list_documents' });
    assert.equal(result.isError, undefined);
  }
  const limited = await client.callTool({ arguments: {}, name: 'list_documents' });
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
  const client = await connectMcp(t, app, { token: created.token });

  const tools = await client.listTools();
  assert.equal(tools.tools.some(({ name }) => name === 'apply_text_edits'), false);
  assert.equal(tools.tools.some(({ name }) => name === 'create_document'), false);

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
  assert.equal(tools.tools.length, 6);
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
