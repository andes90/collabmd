import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  HOSTED_ROLE_ADMIN,
  HOSTED_ROLE_COLLABORATOR,
  HostedWorkspaceService,
} from '../../src/server/domain/hosted-workspace.js';
import { HostedMetadataStore } from '../../src/server/infrastructure/persistence/hosted-metadata-store.js';

function googleUser(email, name = null) {
  return {
    email,
    emailVerified: true,
    name: name || email.split('@')[0],
    picture: '',
    sub: `sub-${email}`,
  };
}

const membershipChanges = {
  leave: (service, user, _membership) => service.leaveTeam(user),
  demote: (service, user, membership) => service.updateMembershipRole({
    membershipId: membership.id,
    role: HOSTED_ROLE_COLLABORATOR,
    user,
  }),
  remove: (service, user, membership) => service.removeMembership({ membershipId: membership.id, user }),
};

for (const [action, change] of Object.entries(membershipChanges)) {
  test(`concurrent admin ${action} preserves one admin`, async (t) => {
    const service = await createHostedService(t);
    const admin = googleUser('admin@example.com');
    const second = googleUser('second@example.com');
    const { membership } = await service.claimWorkspace({ token: 'claim-secret', user: admin });
    await service.completeWorkspaceSetup();
    await service.createInvitation({ email: second.email, role: HOSTED_ROLE_ADMIN, user: admin });
    const secondMembership = await service.acceptInvitation(second);

    const results = await Promise.allSettled([
      change(service, admin, membership),
      change(service, second, secondMembership),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'HOSTED_LAST_ADMIN');
    assert.equal((await service.store.listMemberships()).filter((member) => member.role === HOSTED_ROLE_ADMIN).length, 1);
  });

  test(`admin ${action} rolls back when its audit insertion fails`, async (t) => {
    const service = await createHostedService(t);
    const admin = googleUser('admin@example.com');
    const second = googleUser('second@example.com');
    const { membership } = await service.claimWorkspace({ token: 'claim-secret', user: admin });
    await service.completeWorkspaceSetup();
    await service.createInvitation({ email: second.email, role: HOSTED_ROLE_ADMIN, user: admin });
    await service.acceptInvitation(second);
    const events = [];
    service.onAccessChanged((event) => events.push(event));
    const auditBefore = await service.store.listAuditEvents();
    service.store.db.exec(`CREATE TRIGGER fail_membership_audit BEFORE INSERT ON audit_events
      WHEN NEW.type LIKE 'membership_%' BEGIN SELECT RAISE(ABORT, 'Injected audit failure'); END`);

    await assert.rejects(change(service, admin, membership), /Injected audit failure/u);
    assert.deepEqual(await service.store.getMembershipById(membership.id), membership);
    assert.deepEqual(await service.store.listAuditEvents(), auditBefore);
    assert.deepEqual(events, []);

    service.store.db.exec('DROP TRIGGER fail_membership_audit');
    await change(service, admin, membership);
    assert.deepEqual(events, [{ email: admin.email }]);
    assert.equal((await service.store.listAuditEvents()).length, auditBefore.length + 1);
  });
}

for (const action of ['demote', 'remove']) {
  test(`membership changes recheck an actor concurrently ${action === 'demote' ? 'demoted' : 'removed'}`, async (t) => {
    const service = await createHostedService(t);
    const admin = googleUser('admin@example.com');
    const second = googleUser('second@example.com');
    const writer = googleUser('writer@example.com');
    await service.claimWorkspace({ token: 'claim-secret', user: admin });
    await service.completeWorkspaceSetup();
    await service.createInvitation({ email: second.email, role: HOSTED_ROLE_ADMIN, user: admin });
    const secondMembership = await service.acceptInvitation(second);
    await service.createInvitation({ email: writer.email, role: HOSTED_ROLE_COLLABORATOR, user: admin });
    const writerMembership = await service.acceptInvitation(writer);

    const results = await Promise.allSettled([
      membershipChanges[action](service, admin, secondMembership),
      service.removeMembership({ membershipId: writerMembership.id, user: second }),
    ]);

    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, action === 'demote' ? 'HOSTED_ADMIN_REQUIRED' : 'HOSTED_MEMBERSHIP_REQUIRED');
    assert.deepEqual(await service.store.getMembershipById(writerMembership.id), writerMembership);
  });
}

async function createHostedService(t, {
  claimEmail = 'admin@example.com',
  claimToken = 'claim-secret',
} = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-hosted-test-'));
  t.after(() => rm(tempRoot, { force: true, recursive: true }));

  const service = new HostedWorkspaceService({
    claim: {
      email: claimEmail,
      token: claimToken,
    },
    enabled: true,
    store: new HostedMetadataStore({
      dbPath: join(tempRoot, 'hosted.sqlite'),
    }),
  });
  await service.initialize();
  t.after(() => service.close());
  return service;
}

test('hosted workspace claim is email-bound and creates first Team Admin', async (t) => {
  const service = await createHostedService(t);

  await assert.rejects(
    () => service.claimWorkspace({
      token: 'claim-secret',
      user: googleUser('other@example.com', 'Other User'),
    }),
    /different Google account/u,
  );

  const claimed = await service.claimWorkspace({
    teamName: 'Docs Team',
    token: 'claim-secret',
    user: googleUser('admin@example.com', 'Admin User'),
  });

  assert.equal(claimed.ok, true);
  assert.equal(claimed.team.name, 'Docs Team');
  assert.equal(claimed.membership.email, 'admin@example.com');
  assert.equal(claimed.membership.role, HOSTED_ROLE_ADMIN);

  const status = await service.getStatus(googleUser('admin@example.com', 'Admin User'));
  assert.equal(status.claimed, true);
  assert.equal(status.setupComplete, false);
  assert.equal(status.membership.role, HOSTED_ROLE_ADMIN);

  const auditEvents = await service.listAuditEvents(googleUser('admin@example.com', 'Admin User'));
  assert.equal(auditEvents[0].type, 'workspace_claimed');
});

test('hosted invitations require completed setup and accept with current role', async (t) => {
  const service = await createHostedService(t);
  const admin = googleUser('admin@example.com', 'Admin User');
  const collaborator = googleUser('writer@example.com', 'Writer User');

  await service.claimWorkspace({
    token: 'claim-secret',
    user: admin,
  });

  await assert.rejects(
    () => service.createInvitation({
      email: collaborator.email,
      role: HOSTED_ROLE_COLLABORATOR,
      user: admin,
    }),
    /setup must complete/u,
  );

  let access = await service.authorizeWorkspaceAccess({ user: admin });
  assert.equal(access.ok, false);
  assert.equal(access.statusCode, 423);

  const configuredSource = await service.configureGithubVaultSource({
    github: {
      installation: {
        accountLogin: 'example-org',
        id: '98765',
      },
      repository: {
        defaultBranch: 'main',
        fullName: 'example-org/docs',
        id: '12345',
        name: 'docs',
        owner: 'example-org',
        visibility: 'private',
      },
    },
    user: admin,
  });
  assert.equal(configuredSource.setupComplete, true);
  assert.equal(configuredSource.vaultSource.repositoryFullName, 'example-org/docs');
  assert.equal(configuredSource.vaultSource.defaultBranch, 'main');

  await assert.rejects(
    () => service.configureGithubVaultSource({
      github: {
        installation: { accountLogin: 'example-org', id: '98765' },
        repository: {
          defaultBranch: 'main',
          fullName: 'example-org/other',
          id: '999',
          name: 'other',
          owner: 'example-org',
        },
      },
      user: admin,
    }),
    /already configured/u,
  );
  access = await service.authorizeWorkspaceAccess({ user: admin });
  assert.equal(access.ok, true);

  const invitation = await service.createInvitation({
    email: collaborator.email,
    role: HOSTED_ROLE_COLLABORATOR,
    user: admin,
  });
  assert.equal(invitation.email, collaborator.email);
  assert.equal(invitation.role, HOSTED_ROLE_COLLABORATOR);

  const updatedInvitation = await service.updateInvitationRole({
    invitationId: invitation.id,
    role: HOSTED_ROLE_ADMIN,
    user: admin,
  });
  assert.equal(updatedInvitation.role, HOSTED_ROLE_ADMIN);

  const membership = await service.acceptInvitation(collaborator);
  assert.equal(membership.email, collaborator.email);
  assert.equal(membership.role, HOSTED_ROLE_ADMIN);

  const memberships = await service.listMemberships(admin);
  assert.equal(memberships.length, 2);
});

test('hosted membership enforces last-admin rule, removal, leave, and audit events', async (t) => {
  const service = await createHostedService(t);
  const admin = googleUser('admin@example.com', 'Admin User');
  const secondAdmin = googleUser('second@example.com', 'Second Admin');
  const writer = googleUser('writer@example.com', 'Writer User');

  await service.claimWorkspace({ token: 'claim-secret', user: admin });
  await service.completeWorkspaceSetup();
  const adminMembership = (await service.listMemberships(admin))[0];

  await assert.rejects(
    () => service.updateMembershipRole({
      membershipId: adminMembership.id,
      role: HOSTED_ROLE_COLLABORATOR,
      user: admin,
    }),
    /at least one Team Admin/u,
  );

  await service.createInvitation({ email: secondAdmin.email, role: HOSTED_ROLE_ADMIN, user: admin });
  const secondAdminMembership = await service.acceptInvitation(secondAdmin);
  await service.createInvitation({ email: writer.email, role: HOSTED_ROLE_COLLABORATOR, user: admin });
  const writerMembership = await service.acceptInvitation(writer);

  const demoted = await service.updateMembershipRole({
    membershipId: adminMembership.id,
    role: HOSTED_ROLE_COLLABORATOR,
    user: secondAdmin,
  });
  assert.equal(demoted.role, HOSTED_ROLE_COLLABORATOR);

  await service.removeMembership({
    membershipId: writerMembership.id,
    user: secondAdmin,
  });
  const writerAccess = await service.authorizeWorkspaceAccess({ user: writer });
  assert.equal(writerAccess.ok, false);
  assert.equal(writerAccess.statusCode, 403);

  await service.leaveTeam(admin);
  const remainingMemberships = await service.listMemberships(secondAdmin);
  assert.deepEqual(
    remainingMemberships.map((membership) => membership.email).sort(),
    [secondAdmin.email],
  );
  assert.equal(remainingMemberships[0].id, secondAdminMembership.id);

  const auditTypes = (await service.listAuditEvents(secondAdmin)).map((event) => event.type);
  assert.ok(auditTypes.includes('membership_role_changed'));
  assert.ok(auditTypes.includes('membership_removed'));
  assert.ok(auditTypes.includes('membership_left'));
});
