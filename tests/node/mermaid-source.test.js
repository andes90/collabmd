import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareMermaidRenderSource } from '../../src/client/domain/mermaid-source.js';

test('pads empty sequence-label lines without dropping line breaks', () => {
  const source = [
    'sequenceDiagram',
    'Note right of B: First<br/><br/><br/>Last<br/>',
    'A->>B: <BR>First<br /> <br />Last<br />',
  ].join('\n');
  const prepared = prepareMermaidRenderSource(source);
  assert.equal(prepared, [
    'sequenceDiagram',
    'Note right of B: First<br/>#160;<br/>#160;<br/>Last<br/>#160;',
    'A->>B: #160;<BR>First<br />#160; <br />Last<br />#160;',
  ].join('\n'));
  assert.equal(prepareMermaidRenderSource(prepared), prepared);
});

test('pads blank lines at semicolon statement boundaries and in participant aliases', () => {
  const source = [
    'sequenceDiagram',
    'participant A as <br/>Alice;',
    'actor B as <BR /> Bob',
    'A->>B: Hi<br/>;B->>A: <br/>Done<br/>;',
  ].join('\n');
  const prepared = prepareMermaidRenderSource(source);
  assert.equal(prepared, [
    'sequenceDiagram',
    'participant A as #160;<br/>Alice;',
    'actor B as #160;<BR /> Bob',
    'A->>B: Hi<br/>#160;;B->>A: #160;<br/>Done<br/>#160;;',
  ].join('\n'));
  assert.equal(prepareMermaidRenderSource(prepared), prepared);
});

test('keeps nonempty labels, directives, comments, and CRLF line endings intact', () => {
  const source = [
    '%%{init: {"theme":"dark"}}%%',
    'sequenceDiagram',
    '%% Example: First<br/><br/>',
    'A->>B: First<br/>Last',
    'Note right of B: Processing:<br/>Last',
    'Note right of B: First<br/>',
  ].join('\r\n');
  assert.equal(prepareMermaidRenderSource(source), source + '#160;');
});

test('leaves other diagram types unchanged', () => {
  const source = 'flowchart TD\nA[First<br/><br/>Last] --> B';
  assert.equal(prepareMermaidRenderSource(source), source);
});

test('does not treat sequenceDiagram inside another diagram label as a declaration', () => {
  const source = 'flowchart TD\nA["First\nsequenceDiagram\n<br/><br/>Last"] --> B';
  assert.equal(prepareMermaidRenderSource(source), source);
});

test('preserves the preamble while finding the sequence declaration', () => {
  const preamble = [
    '---',
    'title: |',
    '  sequenceDiagram',
    '  <br/><br/>Title',
    '---',
    '%% A comment',
    '%%{init: {',
    '  "theme": "default"',
    '}}%%',
    '',
  ].join('\r\n');
  const source = `${preamble}sequenceDiagram\r\nA->>B: Hi<br/>`;
  assert.equal(prepareMermaidRenderSource(source), source + '#160;');
  const flowchart = `${preamble}flowchart TD\r\nA[First<br/><br/>Last] --> B`;
  assert.equal(prepareMermaidRenderSource(flowchart), flowchart);
});

test('pads structured participant and actor aliases without changing other metadata', () => {
  const source = [
    'sequenceDiagram',
    'participant A@{ "type": "database", "alias": "<br/>Alice\\"Team\\"<br/><br/>" }',
    'actor B@{ type: boundary, alias: \'<br/>Bob\'\'s<br/>\' }',
    'participant C@{ type: queue, alias: <br/>Queue<br/> };',
    'participant D@{',
    '  type: database',
    '  alias: "<br/>Database<br/>"',
    '}',
    'Note over A,B: Example "alias": "<br/>Not a blank first line"',
    'A->>B: Hi',
  ].join('\n');
  const prepared = prepareMermaidRenderSource(source);
  assert.equal(prepared, [
    'sequenceDiagram',
    'participant A@{ "type": "database", "alias": "#160;<br/>Alice\\"Team\\"<br/>#160;<br/>#160;" }',
    'actor B@{ type: boundary, alias: \'#160;<br/>Bob\'\'s<br/>#160;\' }',
    'participant C@{ type: queue, alias: #160;<br/>Queue<br/>#160; };',
    'participant D@{',
    '  type: database',
    '  alias: "#160;<br/>Database<br/>#160;"',
    '}',
    'Note over A,B: Example "alias": "<br/>Not a blank first line"',
    'A->>B: Hi',
  ].join('\n'));
  assert.equal(prepareMermaidRenderSource(prepared), prepared);
});
