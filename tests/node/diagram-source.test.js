import assert from 'node:assert/strict';
import test from 'node:test';

import { listRenderableDiagrams } from '../../src/domain/diagram-source.js';

test('ignores examples in frontmatter and outer fences and resolves longer matching closes', () => {
  const markdown = [
    '---', 'example: |', '  ```mermaid', '  graph TD', '  ```', '---',
    '````markdown', '```mermaid', 'graph TD', '```', '`````',
    '~~~markdown', '```plantuml', '@startuml', '```', '~~~',
    '  ~~~puml', '@startuml', '@enduml', '  ~~~~~',
    '```mermaid', 'graph TD', '```',
    '````markdown', '```mermaid', 'graph TD', '```',
  ].join('\r\n');

  assert.deepEqual(listRenderableDiagrams(markdown, 'examples.md'), [
    { endLine: 20, kind: 'plantuml', source: '@startuml\n@enduml', startLine: 17 },
    { endLine: 23, kind: 'mermaid', source: 'graph TD', startLine: 21 },
  ]);
});
