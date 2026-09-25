import test from 'node:test';
import assert from 'node:assert/strict';

import { PlantUmlRenderer } from '../../src/server/infrastructure/plantuml/plantuml-renderer.js';
import { encodePlantUmlText } from '../../src/server/domain/plantuml-encoder.js';

test('PlantUML source keeps the expected server URL encoding', () => {
  assert.equal(
    encodePlantUmlText('@startuml\nAlice -> Bob: Hi\n@enduml'),
    'SoWkIImgAStDuNBCoKnELT2rKt3AJx9IyCZaSaZDIodDpG40',
  );
});

test('PlantUmlRenderer accepts SVG payloads prefixed with PlantUML processing instructions', async () => {
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '<?plantuml 1.2026.3beta3?><svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>',
    }),
    serverUrl: 'https://example.test/plantuml',
  });

  const svg = await renderer.renderSvg('@startuml\nAlice -> Bob: Hi\n@enduml\n');

  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>');
});

test('PlantUmlRenderer rejects non-SVG upstream payloads', async () => {
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-an-svg-response',
    }),
    serverUrl: 'https://example.test/plantuml',
  });

  await assert.rejects(
    () => renderer.renderSvg('@startuml\nAlice -> Bob: Hi\n@enduml\n'),
    /invalid SVG payload/i,
  );
});

test('PlantUmlRenderer serves repeated sources from the cache', async () => {
  let fetchCalls = 0;
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>',
      };
    },
    serverUrl: 'https://example.test/plantuml',
  });

  const source = '@startuml\nAlice -> Bob: Hi\n@enduml\n';
  const first = await renderer.renderSvg(source);
  const second = await renderer.renderSvg(source);

  assert.equal(first, '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>');
  assert.equal(second, first);
  assert.equal(fetchCalls, 1);
});

test('PlantUmlRenderer coalesces concurrent renders of the same source', async () => {
  let fetchCalls = 0;
  let releaseFetch = null;
  const fetchStarted = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => {
      fetchCalls += 1;
      await fetchStarted;
      return {
        ok: true,
        status: 200,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>',
      };
    },
    serverUrl: 'https://example.test/plantuml',
  });

  const source = '@startuml\nAlice -> Bob: Hi\n@enduml\n';
  const pending = [renderer.renderSvg(source), renderer.renderSvg(source)];
  releaseFetch();
  const [first, second] = await Promise.all(pending);

  assert.equal(first, second);
  assert.equal(fetchCalls, 1);
});

test('PlantUmlRenderer does not cache upstream failures', async () => {
  let fetchCalls = 0;
  const renderer = new PlantUmlRenderer({
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>',
      };
    },
    serverUrl: 'https://example.test/plantuml',
  });

  const source = '@startuml\nAlice -> Bob: Hi\n@enduml\n';
  await assert.rejects(() => renderer.renderSvg(source), /boom/);
  const svg = await renderer.renderSvg(source);

  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>');
  assert.equal(fetchCalls, 2);
});
