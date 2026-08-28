import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentConnectionController } from '../../src/client/presentation/agent-connection-controller.js';

function mountDialog() {
  document.body.innerHTML = `
    <button id="trigger">Connect AI Agent</button>
    <dialog id="dialog"><div id="content"></div></dialog>
  `;
  return {
    content: document.getElementById('content'),
    dialog: document.getElementById('dialog'),
    trigger: document.getElementById('trigger'),
  };
}

describe('AgentConnectionController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows no-auth setup without exposing browser token management', async () => {
    const elements = mountDialog();
    new AgentConnectionController({
      apiClient: {},
      ...elements,
      runtimeConfig: {
        agentAccess: { enabled: true, endpoint: '/mcp', managed: false },
        auth: { strategy: 'none' },
      },
    });

    elements.trigger.click();
    await vi.waitFor(() => {
      expect(elements.content.textContent).toContain('No authentication required');
    });
    expect(elements.content.querySelector('[data-agent-create]')).toBeNull();
    expect(elements.content.querySelector('[data-agent-copy-setup="generic"]')?.textContent).toBe('Copy connection details');
  });

  it('creates a managed connection, shows token once, and clears it on close', async () => {
    const elements = mountDialog();
    const createConnection = vi.fn(async () => ({
      connection: { clientKind: 'codex', id: 'connection-1' },
      token: 'cmd_agent_secret',
    }));
    const controller = new AgentConnectionController({
      apiClient: {
        createConnection,
        listConnections: async () => ({ connections: [] }),
      },
      ...elements,
      runtimeConfig: {
        agentAccess: { enabled: true, endpoint: '/mcp', managed: true },
        auth: { strategy: 'password' },
      },
    });

    elements.trigger.click();
    await vi.waitFor(() => expect(elements.content.querySelector('[data-agent-create]')).not.toBeNull());
    expect(elements.content.textContent).toContain('Connect your first agent');
    expect(elements.content.querySelector('[data-agent-create]').textContent).toBe('Start setup');
    elements.content.querySelector('[data-agent-create]').click();
    expect(elements.content.textContent).toContain('Step 1 of 2');
    elements.content.querySelector('[data-agent-create-form]').requestSubmit();

    await vi.waitFor(() => {
      expect(elements.content.querySelector('.agent-connection-token').value).toBe('cmd_agent_secret');
    });
    expect(elements.content.textContent).toContain('Step 2 of 2');
    expect(elements.content.textContent).toContain('Finish setup in Codex');
    expect(controller.secretToken).toBe('cmd_agent_secret');
    expect(createConnection).toHaveBeenCalledWith({
      clientKind: 'codex',
      label: 'My Codex',
      scopes: ['vault:read', 'vault:edit'],
    });

    elements.dialog.close();
    await vi.waitFor(() => expect(controller.secretToken).toBe(''));
    expect(elements.content.childElementCount).toBe(0);
  });
});
