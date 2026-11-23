import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { DrawioLeaseClient } from '../../src/client/infrastructure/drawio-lease-client.js';

test('draw.io only grants editing while synced and respects another holder on reconnect', async () => {
  const provider = Object.assign(new EventEmitter(), {
    synced: false,
    awareness: Object.assign(new EventEmitter(), { setLocalStateField() {} }),
  });
  const client = new DrawioLeaseClient({
    filePath: 'notes.drawio',
    roomName: '__drawio__:notes.drawio',
    resolveWsBaseUrlFn: () => 'ws://example.test',
    websocketProviderFactory: () => provider,
    clearIntervalFn() {},
    setIntervalFn: () => 1,
  });
  const sync = (synced) => {
    provider.synced = synced;
    provider.emit('sync', synced);
  };
  try {
    await client.connect();
    assert.equal(client.currentState.isEditor, false);
    assert.equal(client.tryAcquireLease(), false);
    sync(true);
    assert.equal(client.currentState.isEditor, true);
    sync(false);
    assert.equal(client.currentState.isEditor, false);
    assert.equal(client.tryAcquireLease(), false);
    client.leaseMap.set('holderClientId', 'another collaborator');
    client.leaseMap.set('heartbeatAt', Date.now());
    sync(true);
    assert.equal(client.currentState.isEditor, false);
    assert.equal(client.tryAcquireLease(), false);
  } finally {
    client.destroy();
  }
});
