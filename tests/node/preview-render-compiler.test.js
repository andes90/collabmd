import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';
import {
  LARGE_DOCUMENT_CHAR_THRESHOLD,
  analyzeMarkdownComplexity,
  isLargeDocumentStats,
} from '../../src/client/application/preview-render-profile.js';

test('compilePreviewDocument emits stable excalidraw placeholder keys and wiki-link anchors', () => {
  const markdown = [
    '# Preview',
    '',
    '![[sample-excalidraw.excalidraw]]',
    '',
    '![[sample-excalidraw.excalidraw|Sample Excalidraw]]',
    '',
    'See [[README]].',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: Hello',
    '@enduml',
    '```',
  ].join('\n');

  const { html, stats } = compilePreviewDocument({
    fileList: ['README.md'],
    markdownText: markdown,
  });

  assert.match(html, /data-embed-key="sample-excalidraw\.excalidraw#0"/);
  assert.match(html, /data-embed-key="sample-excalidraw\.excalidraw#1"/);
  assert.match(html, /class="wiki-link"/);
  assert.match(html, /data-mermaid-key="mermaid-[a-z0-9]+-0"/);
  assert.match(html, /data-mermaid-source-hash="[a-z0-9]+"/);
  assert.match(html, /data-plantuml-key="plantuml-[a-z0-9]+-0"/);
  assert.match(html, /data-plantuml-source-hash="[a-z0-9]+"/);
  assert.equal(stats.excalidrawEmbeds, 2);
  assert.equal(stats.mermaidBlocks, 1);
  assert.equal(stats.plantumlBlocks, 1);
});

test('compilePreviewDocument keeps Mermaid keys stable across unrelated markdown edits', () => {
  const baseMarkdown = [
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
  ].join('\n');
  const editedMarkdown = [
    'Intro paragraph',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
  ].join('\n');

  const baseHtml = compilePreviewDocument({ markdownText: baseMarkdown }).html;
  const editedHtml = compilePreviewDocument({ markdownText: editedMarkdown }).html;
  const baseKey = baseHtml.match(/data-mermaid-key="([^"]+)"/)?.[1];
  const editedKey = editedHtml.match(/data-mermaid-key="([^"]+)"/)?.[1];

  assert.equal(baseKey, editedKey);
});

test('compilePreviewDocument emits stable PlantUML embed shell keys', () => {
  const markdown = [
    '![[sample-plantuml.puml]]',
    '',
    '![[sample-plantuml.puml|Sequence flow]]',
  ].join('\n');

  const { html, stats } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-plantuml-key="sample-plantuml\.puml#0"/);
  assert.match(html, /data-plantuml-key="sample-plantuml\.puml#1"/);
  assert.match(html, /data-plantuml-target="sample-plantuml\.puml"/);
  assert.match(html, /<strong>Sequence flow<\/strong>/);
  assert.equal(stats.plantumlBlocks, 2);
});

test('compilePreviewDocument emits stable Mermaid embed shell keys', () => {
  const markdown = [
    '![[sample-mermaid.mmd]]',
    '',
    '![[sample-mermaid.mmd|Flow]]',
  ].join('\n');

  const { html, stats } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-mermaid-key="sample-mermaid\.mmd#0"/);
  assert.match(html, /data-mermaid-key="sample-mermaid\.mmd#1"/);
  assert.match(html, /data-mermaid-target="sample-mermaid\.mmd"/);
  assert.match(html, /<strong>Flow<\/strong>/);
  assert.equal(stats.mermaidBlocks, 2);
});

test('compilePreviewDocument emits stable .plantuml embed shell keys', () => {
  const markdown = [
    '![[architecture.plantuml]]',
    '',
    '![[architecture.plantuml|Sequence flow]]',
  ].join('\n');

  const { html, stats } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-plantuml-key="architecture\.plantuml#0"/);
  assert.match(html, /data-plantuml-key="architecture\.plantuml#1"/);
  assert.match(html, /data-plantuml-target="architecture\.plantuml"/);
  assert.match(html, /<strong>Sequence flow<\/strong>/);
  assert.equal(stats.plantumlBlocks, 2);
});

test('large-document classification triggers on any configured threshold', () => {
  const largeByChars = analyzeMarkdownComplexity('a'.repeat(LARGE_DOCUMENT_CHAR_THRESHOLD));
  assert.equal(isLargeDocumentStats(largeByChars), true);

  const largeByMermaid = analyzeMarkdownComplexity('```mermaid\ngraph TD\nA-->B\n```\n'.repeat(20));
  assert.equal(isLargeDocumentStats(largeByMermaid), true);

  const largeByMermaidEmbed = analyzeMarkdownComplexity('![[diagram.mmd]]\n'.repeat(20));
  assert.equal(isLargeDocumentStats(largeByMermaidEmbed), true);

  const largeByExcalidraw = analyzeMarkdownComplexity('![[diagram.excalidraw]]\n'.repeat(8));
  assert.equal(isLargeDocumentStats(largeByExcalidraw), true);

  const largeByPlantUml = analyzeMarkdownComplexity('```plantuml\n@startuml\nAlice -> Bob: Hi\n@enduml\n```\n'.repeat(12));
  assert.equal(isLargeDocumentStats(largeByPlantUml), true);

  const largeByPlantUmlEmbed = analyzeMarkdownComplexity('![[diagram.puml]]\n'.repeat(12));
  assert.equal(isLargeDocumentStats(largeByPlantUmlEmbed), true);

  const largeByPlantUmlLongEmbed = analyzeMarkdownComplexity('![[diagram.plantuml]]\n'.repeat(12));
  assert.equal(isLargeDocumentStats(largeByPlantUmlLongEmbed), true);
});
