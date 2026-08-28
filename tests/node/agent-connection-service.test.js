import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { AgentConnectionService } from '../../src/server/application/agent-connection-service.js';
import { AgentConnectionStore } from '../../src/server/infrastructure/persistence/agent-connection-store.js';

async function createFixture({ authStrategy = 'password', hostedWorkspaceService = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'collabmd-agent-access-'));
  const store = new AgentConnectionStore({ dbPath: join(dir, 'agent.sqlite') });
  let now = 1_000;
  const service = new AgentConnectionService({
    authStrategy,
    connectionTtlMs: 10_000,
    now: () => now,
    hostedWorkspaceService,
    store,
  });
  await service.initialize();
  return {
    advance: (milliseconds) => { now += milliseconds; },
    cleanup: async () => {
      await store.close();
      await rm(dir, { force: true, recursive: true });
    },
    service,
    store,
  };
}


test('password workspace creates scoped hashed Agent Connections', async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const created = await fixture.service.createConnection({
    clientKind: 'codex',
    label: 'Office Codex',
    scopes: ['vault:read', 'vault:edit'],
    user: null,
  });

  assert.match(created.token, /^cmd_agent_/);
  const stored = (await fixture.store.listBySubject('password_workspace', 'self-hosted'))[0];
  assert.notEqual(stored.tokenHash, created.token);
  assert.deepEqual((await fixture.service.authenticateToken(created.token)).scopes, ['vault:edit', 'vault:read']);
  assert.equal((await fixture.service.listConnections(null))[0].tokenHash, undefined);

  await fixture.service.revokeConnection({ connectionId: created.connection.id, user: null });
  await assert.rejects(
    fixture.service.authenticateToken(created.token),
    { code: 'AGENT_TOKEN_INVALID' },
  );
});


test('no-auth disables browser connection management', async (t) => {
  const fixture = await createFixture({ authStrategy: 'none' });
  t.after(fixture.cleanup);
  await assert.rejects(
    fixture.service.createConnection({ clientKind: 'codex', label: 'No auth', scopes: ['vault:read'] }),
    { code: 'AGENT_MANAGEMENT_UNAVAILABLE' },
  );
});


test('expired Agent Connection fails authentication', async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const created = await fixture.service.createConnection({
    clientKind: 'pi',
    label: 'Pi',
    scopes: ['vault:read'],
  });
  fixture.advance(10_001);
  await assert.rejects(
    fixture.service.authenticateToken(created.token),
    { code: 'AGENT_TOKEN_INVALID' },
  );
});


test('hosted Agent Connection stops authorizing after membership loss', async (t) => {
  let active = true;
  const membership = { email: 'member@example.com', id: 'member-1', name: 'Member', role: 'collaborator' };
  const hostedWorkspaceService = {
    enabled: true,
    async authorizeWorkspaceAccess() {
      return active
        ? { membership, ok: true }
        : { body: { code: 'HOSTED_MEMBERSHIP_REQUIRED', error: 'Membership required' }, ok: false, statusCode: 403 };
    },
    async recordAgentConnectionEvent() {},
  };
  const fixture = await createFixture({
    authStrategy: 'oidc',
    hostedWorkspaceService,
  });
  t.after(fixture.cleanup);
  const created = await fixture.service.createConnection({
    clientKind: 'codex',
    label: 'Hosted Codex',
    scopes: ['vault:read'],
    user: { email: membership.email, name: membership.name, sub: 'google-1' },
  });
  assert.equal((await fixture.service.authenticateToken(created.token)).collaborator.id, membership.id);
  active = false;
  await assert.rejects(
    fixture.service.authenticateToken(created.token),
    { code: 'AGENT_MEMBERSHIP_REQUIRED' },
  );
});
