import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { startTestServer } from '../helpers/test-server.js';


test('no-auth MCP searches, reads, edits, and creates Vault Content anonymously', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
  });
  const client = new Client({ name: 'collabmd-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/mcp`));
  t.after(async () => {
    await transport.close().catch(() => {});
    await app.close();
  });
  await client.connect(transport);

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

test('password session manages workspace-level Agent Connections', async (t) => {
  const app = await startTestServer({
    agentAccess: { enabled: true },
    auth: { password: 'office-secret', strategy: 'password' },
  });
  t.after(app.close);
  const login = await fetch(`${app.baseUrl}/api/auth/session`, {
    body: JSON.stringify({ password: 'office-secret' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const createdResponse = await fetch(`${app.baseUrl}/api/agent/connections`, {
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

  const listResponse = await fetch(`${app.baseUrl}/api/agent/connections`, {
    headers: { Cookie: cookie },
  });
  const listed = await listResponse.json();
  assert.equal(listed.connections[0].label, 'Password Codex');
  assert.equal(listed.connections[0].token, undefined);

  const revokeResponse = await fetch(
    `${app.baseUrl}/api/agent/connections/${created.connection.id}`,
    { headers: { Cookie: cookie }, method: 'DELETE' },
  );
  assert.equal(revokeResponse.status, 200);
  await assert.rejects(
    app.server.agentConnectionService.authenticateToken(created.token),
    { code: 'AGENT_TOKEN_INVALID' },
  );
});
