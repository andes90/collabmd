import assert from 'node:assert/strict';
import test from 'node:test';

import { createDrawioSaveQueue } from '../../src/client/infrastructure/drawio-save-queue.js';

test('draw.io serializes concurrent flushes and persists only the latest pending XML', async () => {
  const firstWrite = Promise.withResolvers();
  const written = [];
  const queue = createDrawioSaveQueue(async (xml) => {
    written.push(xml);
    if (xml === 'first') await firstWrite.promise;
  });

  queue.enqueue('first');
  const flushing = queue.flush();
  queue.enqueue('second');
  queue.enqueue('latest');
  assert.equal(queue.flush(), flushing);
  assert.deepEqual(written, ['first']);
  assert.equal(queue.hasPendingWrites(), true);
  firstWrite.resolve();
  await flushing;

  assert.deepEqual(written, ['first', 'latest']);
  assert.equal(queue.hasPendingWrites(), false);
});

for (const hasNewerXml of [false, true]) {
  test(`draw.io retries ${hasNewerXml ? 'the newer XML' : 'the failed XML'} after a write error`, async () => {
    const firstWrite = Promise.withResolvers();
    const written = [];
    const queue = createDrawioSaveQueue(async (xml) => {
      written.push(xml);
      if (written.length === 1) await firstWrite.promise;
    });
    queue.enqueue('first');
    const flushing = queue.flush();
    if (hasNewerXml) queue.enqueue('latest');
    firstWrite.reject(new Error('Write failed'));
    await assert.rejects(flushing, /Write failed/u);

    assert.equal(queue.hasPendingWrites(), true);
    await queue.flush();
    assert.deepEqual(written, ['first', hasNewerXml ? 'latest' : 'first']);
  });
}
