import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostedWorkspaceGateController } from '../../src/client/presentation/hosted-workspace-gate-controller.js';

function mountGate() {
  document.body.innerHTML = `
    <div id="app"><button id="behind">Behind</button></div>
    <div id="gate" class="hidden"><div data-hosted-gate-content role="dialog" aria-modal="true" aria-labelledby="hostedGateTitle"></div></div>
  `;
  const gate = document.getElementById('gate');
  return { app: document.getElementById('app'), content: gate.querySelector('[data-hosted-gate-content]'), gate };
}

function createController({ apiClient, app = null, gate, hostedEnabled = true, teamSettingsController = null } = {}) {
  return new HostedWorkspaceGateController({
    apiClient,
    appRoot: app,
    gate,
    runtimeConfig: { hosted: { enabled: hostedEnabled } },
    teamSettingsController: teamSettingsController ?? { setTriggerVisible: vi.fn() },
  });
}

describe('HostedWorkspaceGateController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stays hidden when hosted mode is disabled', async () => {
    const { gate } = mountGate();
    const controller = createController({ apiClient: {}, gate, hostedEnabled: false });
    await controller.initialize();
    expect(gate.classList.contains('hidden')).toBe(true);
  });

  it('shows the claim form when the workspace is unclaimed', async () => {
    const { content, gate } = mountGate();
    const apiClient = {
      claimWorkspace: vi.fn(async () => ({ ok: true })),
      getStatus: vi.fn(async () => ({ claimed: false, enabled: true, membership: null, setupComplete: false, team: null })),
    };
    const controller = createController({ apiClient, gate });
    void controller.initialize();
    await vi.waitFor(() => {
      expect(content.querySelector('[data-claim-form]')).not.toBeNull();
    });
    expect(gate.classList.contains('hidden')).toBe(false);
    expect(content.querySelector('[data-claim-form]')).not.toBeNull();

    content.querySelector('[name="teamName"]').value = 'Docs Team';
    content.querySelector('[name="token"]').value = 'secret';
    apiClient.getStatus = async () => ({ claimed: true, enabled: true, membership: { email: 'a@example.com', role: 'admin' }, setupComplete: false, team: { name: 'Docs Team' } });
    content.querySelector('[data-claim-form]').requestSubmit();
    await vi.waitFor(() => {
      expect(apiClient.claimWorkspace).toHaveBeenCalledWith({ teamName: 'Docs Team', token: 'secret' });
    });
  });

  it('inerts the app and focuses the gate while visible', async () => {
    const { app, content, gate } = mountGate();
    const apiClient = {
      getStatus: async () => ({ claimed: false, enabled: true, membership: null, setupComplete: false, team: null }),
    };
    const controller = createController({ apiClient, app, gate });
    void controller.initialize();
    await vi.waitFor(() => {
      expect(app.inert).toBe(true);
    });
    expect(app.inert).toBe(true);
    expect(content.contains(document.activeElement)).toBe(true);
    controller.hide();
    expect(app.inert).toBe(false);
    expect(gate.classList.contains('hidden')).toBe(true);
  });

  it('offers setup completion to admins and blocks non-admins during setup', async () => {
    const { content, gate } = mountGate();
    const apiClient = {
      completeSetup: vi.fn(async () => ({ ok: true, setupComplete: true })),
      getStatus: async () => ({ claimed: true, enabled: true, membership: { email: 'a@example.com', role: 'admin' }, setupComplete: false, team: { name: 'Docs Team' } }),
    };
    const teamSettingsController = { setTriggerVisible: vi.fn() };
    const controller = createController({ apiClient, gate, teamSettingsController });
    const initialized = vi.fn();
    const initialization = controller.initialize().then(initialized);
    await vi.waitFor(() => {
      expect(content.querySelector('[data-complete-setup]')).not.toBeNull();
    });
    expect(initialized).not.toHaveBeenCalled();
    expect(content.querySelector('[data-complete-setup]')).not.toBeNull();
    expect(teamSettingsController.setTriggerVisible).toHaveBeenCalledWith(false);

    apiClient.getStatus = async () => ({ claimed: true, enabled: true, membership: { email: 'a@example.com', role: 'admin' }, setupComplete: true, team: { name: 'Docs Team' } });
    content.querySelector('[data-complete-setup]').click();
    await vi.waitFor(() => {
      expect(apiClient.completeSetup).toHaveBeenCalled();
      expect(gate.classList.contains('hidden')).toBe(true);
    });
    await initialization;
    expect(initialized).toHaveBeenCalledOnce();
    expect(teamSettingsController.setTriggerVisible).toHaveBeenLastCalledWith(true);
  });

  it('offers invitation acceptance to signed-in non-members', async () => {
    const { content, gate } = mountGate();
    const apiClient = {
      acceptInvitation: vi.fn(async () => ({ membership: { email: 'b@example.com', role: 'collaborator' } })),
      getStatus: async () => ({ claimed: true, enabled: true, membership: null, setupComplete: true, team: { name: 'Docs Team' } }),
    };
    const controller = createController({ apiClient, gate });
    const initialization = controller.initialize();
    await vi.waitFor(() => {
      expect(content.querySelector('[data-accept-invitation]')).not.toBeNull();
    });
    expect(content.querySelector('[data-accept-invitation]')).not.toBeNull();

    apiClient.getStatus = async () => ({ claimed: true, enabled: true, membership: { email: 'b@example.com', role: 'collaborator' }, setupComplete: true, team: { name: 'Docs Team' } });
    content.querySelector('[data-accept-invitation]').click();
    await vi.waitFor(() => {
      expect(apiClient.acceptInvitation).toHaveBeenCalled();
      expect(gate.classList.contains('hidden')).toBe(true);
    });
    await initialization;
  });
});
