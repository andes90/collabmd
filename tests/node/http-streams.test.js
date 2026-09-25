import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import { readBinaryRequestBody } from '../../src/server/infrastructure/http/request-body.js';
import { sendStreamResponse } from '../../src/server/infrastructure/http/http-response.js';

test('request body reader drains an oversized stream before returning 413', async () => {
  let chunksRead = 0;
  const request = Readable.from((async function* chunks() {
    for (const text of ['abc', 'def', 'ghi']) {
      chunksRead += 1;
      yield Buffer.from(text);
    }
  })());

  await assert.rejects(() => readBinaryRequestBody(request, 5), { statusCode: 413 });
  assert.equal(chunksRead, 3);
});

test('stream response writes its source through the response', async () => {
  const chunks = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  response.writeHead = (statusCode, headers) => {
    assert.equal(statusCode, 200);
    assert.equal(headers['Content-Type'], 'text/plain');
  };

  await sendStreamResponse({ method: 'GET' }, response, {
    headers: { 'Content-Type': 'text/plain' },
    stream: Readable.from(['one', 'two']),
  });
  assert.equal(Buffer.concat(chunks).toString(), 'onetwo');
});
