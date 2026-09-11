import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import katex from 'katex';
import { renderDocx } from '../../src/server/domain/docx-exporter.js';

const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const JSZip = converterRequire('jszip');
const gif = 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

function mathMarker(key, tex, displayMode = false) {
  const mathml = katex
    .renderToString(tex, { displayMode, throwOnError: false, trust: false })
    .match(/<math[\s\S]*<\/math>/)[0];
  return `<span class="export-math" data-mml="${encodeURIComponent(mathml)}">${key}</span>`;
}

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

test('DOCX renders math markers as native OMML equations', async () => {
  const result = await renderDocx({
    html: [
      '<html><body>',
      `<p>Inline ${mathMarker('COLLABMD-MATH-0', 'E = mc^2')} here.</p>`,
      `<p>${mathMarker('COLLABMD-MATH-1', '\\frac{a}{b}', true)}</p>`,
      `<ul><li>Item ${mathMarker('COLLABMD-MATH-2', 'x^2')} end</li>`,
      `<ul><li>${mathMarker('COLLABMD-MATH-3', '\\sum_{i=1}^{n} i', true)}</li></ul>`,
      '</body></html>',
    ].join(''),
    title: 'Math notes',
  });
  const zip = await JSZip.loadAsync(result);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.equal((documentXml.match(/<m:oMath[ >]/g) || []).length, 4);
  assert.doesNotMatch(documentXml, /<m:oMathPara[ >]/);
  assert.ok(documentXml.includes('<w:jc w:val="center"/>'), 'expected centered display paragraph');
  assert.doesNotMatch(documentXml, /COLLABMD-MATH/);
  assert.doesNotMatch(documentXml, /export-math/);
  assert.ok(documentXml.includes('<m:f>'), 'expected fraction OMML');
  assert.ok(documentXml.includes('<m:nary>'), 'expected summation OMML');
});

test('DOCX converts KaTeX padding wrappers without converter warnings', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const result = await renderDocx({
      html: `<html><body><p>${mathMarker('COLLABMD-MATH-0', '\\begin{pmatrix}a & b \\\\ \\vdots & \\vdots \\\\ c & d\\end{pmatrix}', true)}</p></body></html>`,
      title: 'Matrix',
    });
    const zip = await JSZip.loadAsync(result);
    const documentXml = await zip.file('word/document.xml').async('string');
    assert.ok(documentXml.includes('<m:m>'), 'expected matrix OMML');
    assert.ok(documentXml.includes('>(</m:t>'), 'expected opening bracket');
    assert.ok(documentXml.includes('>)</m:t>'), 'expected closing bracket');
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, []);
});

test('DOCX emits at most one argument-properties element per math argument', async () => {
  const result = await renderDocx({
    html: `<html><body><p>${mathMarker('COLLABMD-MATH-0', '\\begin{aligned}(x + y)^2 &= x^2 + 2xy + y^2 \\\\ &= z\\end{aligned}', true)}</p><p>After math.</p></body></html>`,
    title: 'Aligned',
  });
  const zip = await JSZip.loadAsync(result);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.doesNotMatch(documentXml, /<m:argPr\b(?:\/>|>[\s\S]*?<\/m:argPr>)\s*<m:argPr\b/);
  assert.ok(documentXml.includes('<m:m>'), 'expected matrix OMML');
  assert.ok(documentXml.includes('After math.'), 'expected trailing content');
  assert.ok(documentXml.includes('<w:jc w:val="center"/>'), 'expected centered display paragraph');
});
