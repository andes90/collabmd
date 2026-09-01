import test from 'node:test';
import assert from 'node:assert/strict';

import { getUserAvatarTextColor } from '../../src/client/domain/room.js';
import { LobbyPresence } from '../../src/client/infrastructure/lobby-presence.js';
import { createLazyLobbyPresence } from '../../src/client/bootstrap/lazy-collab-clients.js';


function installWindowStub(t) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      host: 'localhost:3000',
      protocol: 'http:',
      search: '',
    },
  };

  t.after(() => {
    globalThis.window = originalWindow;
  });
}

test('LobbyPresence emits remote workspace events once and ignores local echoes', async (t) => {
  installWindowStub(t);

  const received = [];
  const lobby = new LobbyPresence({
    onWorkspaceEvent: (event) => {
      received.push(event);
    },
    preferredUserName: 'Tester',
  });
  t.after(() => lobby.destroy());

  lobby._didInitialSync = true;
  lobby.localUser = { ...lobby.localUser, peerId: 'local-peer' };

  lobby.workspaceEvents.push([{
    action: 'pull',
    createdAt: Date.now(),
    id: 'remote-event-1',
    peerId: 'remote-peer',
    workspaceChange: {
      changedPaths: ['README.md'],
      deletedPaths: [],
      refreshExplorer: true,
      renamedPaths: [],
    },
  }]);
  lobby._emitWorkspaceEvents();
  lobby.workspaceEvents.push([{
    action: 'reset',
    createdAt: Date.now(),
    id: 'local-event-1',
    peerId: 'local-peer',
    workspaceChange: {
      changedPaths: [],
      deletedPaths: ['README.md'],
      refreshExplorer: true,
      renamedPaths: [],
    },
  }]);
  lobby._emitWorkspaceEvents();
  lobby.workspaceEvents.push([{
    action: 'pull',
    createdAt: Date.now(),
    id: 'remote-event-1',
    peerId: 'remote-peer',
    workspaceChange: {
      changedPaths: ['README.md'],
      deletedPaths: [],
      refreshExplorer: true,
      renamedPaths: [],
    },
  }]);
  lobby._emitWorkspaceEvents();

  assert.equal(received.length, 1);
  assert.equal(received[0].action, 'pull');
  assert.deepEqual(received[0].workspaceChange.changedPaths, ['README.md']);
});

test('avatar text color keeps room color labels readable', () => {
  assert.equal(getUserAvatarTextColor('#eab308'), '#000');
  assert.equal(getUserAvatarTextColor('#1e40af'), '#fff');
});

test('lazy lobby presence exposes connection state before the client loads', () => {
  const lobby = createLazyLobbyPresence({ preferredUserName: 'Andes' });
  assert.deepEqual(lobby.getConnectionState(), { status: 'connecting', unreachable: false });
});
