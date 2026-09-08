import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import { renderDocx } from '../../src/server/domain/docx-exporter.js';

const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const JSZip = converterRequire('jszip');
const gif = 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

test('DOCX rejects remote image representations without making requests', async (t) => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.end('unexpected image fetch');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/image.gif`;
  for (const html of [
    `<img src="${url}">`,
    `<picture><img src=${url}></picture>`,
    `<IMG SRC="${url}">`,
    `<img SRC="${gif}" src="${url}">`,
    `<img src="${gif}" src="${url}">`,
    `<img src="${url.replace('http:', 'http&#58;')}">`,
    `<img src="//127.0.0.1/image.gif">`,
    '<img src="file:///etc/passwd">',
    `<img src="data:image/png;base64,${url}">`,
    `<svg><image xlink:href="${url}" /></svg>`,
  ]) {
    await assert.rejects(renderDocx({ html }), { statusCode: 400 });
  }
  assert.equal(requests, 0);
});

test('DOCX preserves text, links and embedded images without fetching CSS imports', async (t) => {
  let requests = 0;
  const server = createServer((_req, res) => { requests += 1; res.end(''); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/style.css`;
  const result = await renderDocx({
    html: `<html><head><style>@import url('${url}');</style></head><body><h1>Exported</h1><p><a href="https://example.com">Reference</a></p><img src="${gif}"></body></html>`,
  });
  const zip = await JSZip.loadAsync(result);
  assert.match(await zip.file('word/document.xml').async('string'), /Exported/);
  assert.match(await zip.file('word/_rels/document.xml.rels').async('string'), /https:\/\/example.com/);
  assert.ok(Object.keys(zip.files).some((path) => path.startsWith('word/media/') && !zip.files[path].dir));
  assert.equal(requests, 0);
});
