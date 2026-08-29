import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyExactTextChanges,
  resolveExactTextChanges,
} from '../../src/domain/exact-text-edits.js';
import { createEditableContentRevision } from '../../src/domain/editable-content-revision.js';
import { normalizeEditableText } from '../../src/domain/editable-text.js';
import {
  getCollabMdContentCapability,
  getCollabMdSyntaxGuide,
  isAgentCreatablePath,
  listCollabMdContentCapabilities,
} from '../../src/domain/collabmd-content-capabilities.js';


test('exact text edits resolve unique non-overlapping replacements', () => {
  const content = '# Title\n\nFirst paragraph.\nSecond paragraph.\n';
  const changes = resolveExactTextChanges(content, [
    { oldText: 'First paragraph.', newText: 'Updated first.' },
    { oldText: 'Second paragraph.', newText: 'Updated second.' },
  ]);

  assert.equal(
    applyExactTextChanges(content, changes),
    '# Title\n\nUpdated first.\nUpdated second.\n',
  );
  assert.throws(
    () => resolveExactTextChanges('same same', [{ oldText: 'same', newText: 'new' }]),
    { code: 'EXACT_EDIT_NOT_UNIQUE' },
  );
  assert.throws(
    () => resolveExactTextChanges('abcdef', [
      { oldText: 'abcd', newText: 'x' },
      { oldText: 'cdef', newText: 'y' },
    ]),
    { code: 'EXACT_EDIT_OVERLAP' },
  );
});


test('editable text normalization and revision are stable', async () => {
  const normalized = normalizeEditableText('one\r\ntwo\rthree\n');
  assert.equal(normalized, 'one\ntwo\nthree\n');
  assert.equal(
    await createEditableContentRevision(normalized),
    await createEditableContentRevision('one\ntwo\nthree\n'),
  );
});


test('CollabMD capability registry distinguishes supported and agent-writable content', () => {
  const kinds = listCollabMdContentCapabilities().map(({ kind }) => kind);
  assert.deepEqual(kinds, [
    'base',
    'drawio',
    'excalidraw',
    'html',
    'image',
    'markdown',
    'mermaid',
    'pdf',
    'plantuml',
    'structurizr',
  ]);
  assert.equal(isAgentCreatablePath('docs/note.md'), true);
  assert.equal(isAgentCreatablePath('drawing.excalidraw'), false);
  assert.equal(getCollabMdContentCapability('drawing.excalidraw').agentCreatable, true);
  assert.equal(getCollabMdContentCapability('diagram.mmd').kind, 'mermaid');
  assert.match(getCollabMdSyntaxGuide('markdown').guide, /wiki-links/);
  assert.match(getCollabMdSyntaxGuide('excalidraw').guide, /create_excalidraw/);
});
