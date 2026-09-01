import { createRandomUser } from '../domain/room.js';

function createLazyClient(load) {
  let impl = null;
  let loadPromise = null;

  function ensure() {
    loadPromise ??= Promise.resolve().then(load).then((created) => {
      impl = created;
      return created;
    });
    return loadPromise;
  }

  return {
    ensure,
    getImpl: () => impl,
    get provider() {
      return impl?.provider ?? null;
    },
    connect() {
      void ensure().then((client) => {
        client.connect();
      });
    },
    disconnect() {
      impl?.disconnect();
    },
    destroy() {
      impl?.destroy();
    },
  };
}

export function createLazyLobbyPresence(options = {}) {
  let currentFile = null;
  let localUser = createRandomUser(options.preferredUserName);
  const client = createLazyClient(async () => {
    const { LobbyPresence } = await import('../infrastructure/lobby-presence.js');
    const impl = new LobbyPresence({
      ...options,
      preferredUserName: localUser.name,
    });
    impl.localUser = localUser;
    if (currentFile) {
      impl.setCurrentFile(currentFile);
    }
    return impl;
  });

  return {
    get provider() {
      return client.provider;
    },
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    destroy: () => client.destroy(),
    setCurrentFile(filePath) {
      currentFile = filePath;
      client.getImpl()?.setCurrentFile(filePath);
    },
    setUserName(name) {
      if (!name) {
        return;
      }
      localUser = { ...localUser, name };
      client.getImpl()?.setUserName(name);
    },
    getLocalUser() {
      return client.getImpl()?.getLocalUser() ?? localUser;
    },
    sendChatMessage(text) {
      return client.getImpl()?.sendChatMessage(text) ?? null;
    },
    sendWorkspaceEvent(payload) {
      return client.getImpl()?.sendWorkspaceEvent(payload);
    },
  };
}

export function createLazyWorkspaceSyncClient(options = {}) {
  return createLazyClient(async () => {
    const { WorkspaceSyncClient } = await import('../infrastructure/workspace-sync-client.js');
    return new WorkspaceSyncClient(options);
  });
}
