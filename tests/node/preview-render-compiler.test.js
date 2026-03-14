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

test('compilePreviewDocument normalizes ASCII arrows in preview text', () => {
  const markdown = [
    '## Pie Chart -> Test',
    '',
    'Low <- Mid <-> High => Max',
    '',
    '[[README|Flow -> Docs]]',
    '',
    '`Inline -> code`',
  ].join('\n');

  const { html } = compilePreviewDocument({
    fileList: ['README.md'],
    markdownText: markdown,
  });

  assert.match(html, /<h2[^>]*>Pie Chart → Test<\/h2>/);
  assert.match(html, /<p[^>]*>Low ← Mid ↔ High ⇒ Max<\/p>/);
  assert.match(html, />Flow → Docs<\/a>/);
  assert.match(html, /<code>Inline -&gt; code<\/code>/);
});

test('compilePreviewDocument renders inline br tags without enabling arbitrary html', () => {
  const markdown = [
    '| Name | Description |',
    '| --- | --- |',
    '| BuySellTemplate | Template for BUY/SELL stocks txn <br> `partnerCorporateAccountNo` is defined on the filename |',
    '',
    '<div id="unsafe-html">unsafe</div>',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /Template for BUY\/SELL stocks txn <br> <code>partnerCorporateAccountNo<\/code>/);
  assert.ok(!html.includes('<div id="unsafe-html">unsafe</div>'));
  assert.match(html, /&lt;div id=.*unsafe-html.*&gt;unsafe&lt;\/div&gt;/);
});

test('compilePreviewDocument renders YouTube markdown images as no-cookie embeds', () => {
  const markdown = '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /class="video-embed-placeholder video-embed-shell diagram-preview-shell"/);
  assert.match(html, /data-video-embed-kind="youtube"/);
  assert.match(html, /data-video-embed-url="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /data-video-embed-label="Demo video"/);
  assert.doesNotMatch(html, /<img/);
});

test('compilePreviewDocument renders youtu.be markdown images as no-cookie embeds', () => {
  const markdown = '![Clip](https://youtu.be/dQw4w9WgXcQ?si=abc123)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-video-embed-kind="youtube"/);
  assert.match(html, /data-video-embed-url="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
});

test('compilePreviewDocument renders direct https mp4 markdown images as native video', () => {
  const markdown = '![Product demo](https://cdn.example.com/videos/demo.mp4)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-video-embed-kind="direct-video"/);
  assert.match(html, /data-video-embed-url="https:\/\/cdn\.example\.com\/videos\/demo\.mp4"/);
  assert.match(html, /data-video-embed-mime-type="video\/mp4"/);
  assert.match(html, /data-video-embed-label="Product demo"/);
  assert.doesNotMatch(html, /<img/);
});

test('compilePreviewDocument renders direct https webm markdown images as native video', () => {
  const markdown = '![WebM demo](https://cdn.example.com/videos/demo.webm?download=0)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-video-embed-kind="direct-video"/);
  assert.match(html, /data-video-embed-mime-type="video\/webm"/);
});

test('compilePreviewDocument keeps unsupported image urls as images', () => {
  const markdown = '![Screenshot](https://cdn.example.com/screenshot.png)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<img src="https:\/\/cdn\.example\.com\/screenshot\.png" alt="Screenshot">/);
  assert.doesNotMatch(html, /video-embed/);
});

test('compilePreviewDocument does not turn markdown links into video embeds', () => {
  const markdown = '[Watch](https://www.youtube.com/watch?v=dQw4w9WgXcQ)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<a[^>]+href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"[^>]*>Watch<\/a>/);
  assert.doesNotMatch(html, /video-embed/);
});

test('compilePreviewDocument does not auto-embed bare YouTube urls', () => {
  const markdown = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<a[^>]+href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.doesNotMatch(html, /video-embed/);
});

test('compilePreviewDocument does not embed Google Drive public links', () => {
  const markdown = '![Drive video](https://drive.google.com/file/d/abc123/view?usp=sharing)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<img src="https:\/\/drive\.google\.com\/file\/d\/abc123\/view\?usp=sharing" alt="Drive video">/);
  assert.doesNotMatch(html, /video-embed/);
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
