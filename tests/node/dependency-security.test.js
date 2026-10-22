import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const converterRequire = createRequire(import.meta.resolve('@turbodocx/html-to-docx'));
const axiosRequire = createRequire(converterRequire.resolve('axios'));
const { http } = axiosRequire('follow-redirects');

async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function requestHeaders(url, options) {
  return new Promise((resolve, reject) => {
    http.get(url, options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

for (const arrayHeaders of [false, true]) {
  test(`DOCX HTTP dependency strips redirected credentials with ${arrayHeaders ? 'array' : 'object'} headers`, async (t) => {
    const destination = await listen(t, (req, res) => res.end(JSON.stringify(req.headers)));
    const origin = await listen(t, (req, res) => {
      if (req.url === '/target') {
        res.end(JSON.stringify(req.headers));
        return;
      }
      res.writeHead(302, { Location: req.url === '/same' ? '/target' : destination });
      res.end();
    });
    const credentials = {
      Authorization: 'Bearer test-token',
      'Proxy-Authorization': 'Basic test-proxy',
      Cookie: 'session=test-session',
      'X-Api^Key': 'test-caret',
      'X-Api|Key': 'test-pipe',
      'X-Public': 'preserved',
    };
    const options = () => {
      const headers = { Host: new URL(origin).host, ...credentials };
      return {
        headers: arrayHeaders ? Object.entries(headers).flat() : headers,
        sensitiveHeaders: ['X-Api^Key', 'X-Api|Key'],
      };
    };

    const sameOrigin = await requestHeaders(`${origin}/same`, options());
    for (const [name, value] of Object.entries(credentials)) {
      assert.equal(sameOrigin[name.toLowerCase()], value);
    }

    const crossOrigin = await requestHeaders(`${origin}/cross`, options());
    for (const name of Object.keys(credentials).filter((name) => name !== 'X-Public')) {
      assert.equal(crossOrigin[name.toLowerCase()], undefined, `${name} leaked across origins`);
    }
    assert.equal(crossOrigin['x-public'], 'preserved');
    assert.equal(crossOrigin.host, new URL(destination).host);
  });
}

const pluginRequire = createRequire(import.meta.resolve('@vscode/markdown-it-katex'));
const excalidrawMermaidRequire = createRequire(import.meta.resolve('@excalidraw/mermaid-to-excalidraw'));
const renderers = {
  markdown: pluginRequire('katex'),
  mermaid: createRequire(import.meta.resolve('mermaid'))('katex'),
  excalidraw: createRequire(excalidrawMermaidRequire.resolve('mermaid'))('katex'),
};

for (const [name, katex] of Object.entries(renderers)) {
  test(`${name} KaTeX ignores inherited trust while preserving ordinary math and explicit trust`, () => {
    const expression = '\\href{https://example.com}{link}';
    const inheritedTrust = Object.assign(Object.create({ trust: true }), { strict: false });
    assert.doesNotMatch(katex.renderToString(expression, inheritedTrust), /href="https:\/\/example.com"/);
    assert.match(katex.renderToString(expression, { trust: true }), /href="https:\/\/example.com"/);
    assert.match(katex.renderToString('E = mc^2'), /class="katex"/);
  });
}
