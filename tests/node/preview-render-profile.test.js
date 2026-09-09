import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RENDER_DEBOUNCE_MS,
  DIAGRAM_RENDER_DEBOUNCE_MS,
  LARGE_DOCUMENT_CHAR_THRESHOLD,
  getRenderProfile,
} from '../../src/client/application/preview-render-profile.js';

test('getRenderProfile debounces Mermaid and PlantUML previews', () => {
  assert.deepEqual(getRenderProfile('```mermaid\ngraph TD\nA-->B\n```'), {
    debounceMs: DIAGRAM_RENDER_DEBOUNCE_MS,
    deferUntilIdle: false,
  });
  assert.deepEqual(getRenderProfile('```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```'), {
    debounceMs: DIAGRAM_RENDER_DEBOUNCE_MS,
    deferUntilIdle: false,
  });
});

test('getRenderProfile keeps the large-document idle policy for diagrams', () => {
  const source = [
    '```mermaid',
    'graph TD',
    'A-->B',
    'x'.repeat(LARGE_DOCUMENT_CHAR_THRESHOLD),
    '```',
  ].join('\n');

  assert.deepEqual(getRenderProfile(source), {
    debounceMs: 500,
    deferUntilIdle: true,
  });
});

test('getRenderProfile debounces plain documents and instant embed-only documents', () => {
  assert.deepEqual(getRenderProfile('# Hello'), {
    debounceMs: DEFAULT_RENDER_DEBOUNCE_MS,
    deferUntilIdle: false,
  });
  assert.deepEqual(getRenderProfile('![[board.drawio]]'), {
    debounceMs: 0,
    deferUntilIdle: false,
  });
});
