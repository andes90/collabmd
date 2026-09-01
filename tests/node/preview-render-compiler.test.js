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

test('compilePreviewDocument uses editor-supported aliases for fenced code highlighting', () => {
  for (const language of ['ecmascript', 'node']) {
    const { html } = compilePreviewDocument({
      markdownText: `\`\`\`${language}\nconst x = 1;\n\`\`\``,
    });

    assert.match(html, /<span class="hljs-keyword">const<\/span>/);
  }
});

test('compilePreviewDocument maps SQL dialect fences to deterministic SQL highlighting', () => {
  for (const language of ['cql', 'mariadb', 'mssql', 'mysql', 'plsql', 'sqlite']) {
    const { html } = compilePreviewDocument({
      markdownText: `\`\`\`${language}\nSELECT id <=> 42 FROM users;\n\`\`\``,
    });

    assert.match(html, /<span class="hljs-operator">&lt;=&gt;<\/span>/);
  }
});

test('compilePreviewDocument emits heading ids and keeps fragment links in-tab', () => {
  const markdown = [
    '# Title',
    '',
    '[Jump to section](#section-a)',
    '[Open file route](#file=docs/guide.md)',
    '',
    '## Section A',
    '',
    '## Section A',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<h1 [^>]*id="title"[^>]*>Title<\/h1>/);
  assert.match(html, /<h2 [^>]*id="section-a"[^>]*>Section A<\/h2>/);
  assert.match(html, /<h2 [^>]*id="section-a-1"[^>]*>Section A<\/h2>/);
  assert.match(html, /<a href="#section-a">Jump to section<\/a>/);
  assert.match(html, /<a href="#file=docs\/guide.md">Open file route<\/a>/);
  assert.doesNotMatch(html, /<a href="#section-a"[^>]*target="_blank"/);
  assert.doesNotMatch(html, /<a href="#file=docs\/guide.md"[^>]*target="_blank"/);
});

test('compilePreviewDocument uses parent context to disambiguate repeated nested headings', () => {
  const markdown = [
    '# Title',
    '',
    '## Approach A',
    '',
    '#### Pros',
    '',
    '## Approach B',
    '',
    '#### Pros',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<h4 [^>]*id="approach-a-pros"[^>]*>Pros<\/h4>/);
  assert.match(html, /<h4 [^>]*id="approach-b-pros"[^>]*>Pros<\/h4>/);
});

test('compilePreviewDocument emits base placeholders for fenced bases and base embeds', () => {
  const markdown = [
    '```base',
    'filters: file.ext == "md"',
    'views:',
    '  - type: table',
    '```',
    '',
    '![[views/tasks.base#Board|Tasks]]',
    '',
    '![[views/tasks.base#Board|Tasks]]',
  ].join('\n');

  const { html } = compilePreviewDocument({
    markdownText: markdown,
    sourceFilePath: 'notes/daily.md',
  });

  assert.match(html, /class="bases-embed-placeholder diagram-preview-shell"/);
  assert.match(html, /data-base-key="base-[a-z0-9]+-0"/);
  assert.match(html, /data-base-source="filters: file\.ext == &quot;md&quot;\nviews:\n {2}- type: table\n"/);
  assert.match(html, /data-base-source-path="notes\/daily\.md"/);
  assert.match(html, /data-base-key="views\/tasks\.base#Board#0"/);
  assert.match(html, /data-base-key="views\/tasks\.base#Board#1"/);
  assert.match(html, /data-base-path="views\/tasks\.base"/);
  assert.match(html, /data-base-view="Board"/);
  assert.match(html, /<strong>Tasks<\/strong>/);
});

test('compilePreviewDocument emits stable draw.io embed shell keys', () => {
  const markdown = [
    '![[architecture.drawio]]',
    '',
    '![[architecture.drawio|Architecture]]',
  ].join('\n');

  const { html, stats } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /data-drawio-key="architecture\.drawio#0"/);
  assert.match(html, /data-drawio-key="architecture\.drawio#1"/);
  assert.match(html, /data-drawio-target="architecture\.drawio"/);
  assert.match(html, /<strong>Architecture<\/strong>/);
  assert.equal(stats.drawioEmbeds, 2);
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

test('compilePreviewDocument renders YAML frontmatter as a metadata block and preserves body source lines', () => {
  const markdown = [
    '---',
    'title: Demo note',
    'tags:',
    '  - alpha',
    '  - beta',
    '---',
    '',
    '# Heading',
    '',
    'Body copy',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<section class="frontmatter-block" data-source-line="1" data-source-line-end="6">/);
  assert.match(html, /<div class="frontmatter-label">Properties<\/div>/);
  assert.match(html, /<dt class="frontmatter-key">title<\/dt>/);
  assert.match(html, /<span class="frontmatter-value-text">Demo note<\/span>/);
  assert.match(html, /<dt class="frontmatter-key">tags<\/dt>/);
  assert.match(html, /<span class="frontmatter-value-pill">alpha<\/span>/);
  assert.match(html, /<span class="frontmatter-value-pill">beta<\/span>/);
  assert.doesNotMatch(html, /<hr>\s*<p[^>]*>title: Demo note/);
  assert.match(html, /<h1[^>]*data-source-line="8"[^>]*data-source-line-end="8"[^>]*id="heading"[^>]*>Heading<\/h1>/);
  assert.match(html, /<p data-source-line="10" data-source-line-end="10">Body copy<\/p>/);
});

test('compilePreviewDocument renders complex and empty YAML frontmatter values', () => {
  const markdown = [
    '---',
    'aliases: []',
    'config:',
    '  theme: ocean',
    '  widgets:',
    '    - chart',
    '    - table',
    '---',
    '',
    '# Heading',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<section class="frontmatter-block" data-source-line="1" data-source-line-end="8">/);
  assert.match(html, /<dt class="frontmatter-key">aliases<\/dt>/);
  assert.match(html, /<div class="frontmatter-value-list"><\/div>/);
  assert.match(html, /<dt class="frontmatter-key">config<\/dt>/);
  assert.match(html, /<pre class="frontmatter-value-code"><code>theme: ocean/);
  assert.match(html, /widgets:\n {2}- chart\n {2}- table/);
});

test('compilePreviewDocument renders an empty frontmatter shell for empty YAML objects', () => {
  const markdown = [
    '---',
    '---',
    '',
    '# Heading',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /<section class="frontmatter-block" data-source-line="1" data-source-line-end="2">/);
  assert.match(html, /<dl class="frontmatter-properties"><\/dl><div class="frontmatter-empty">No properties<\/div>/);
  assert.match(html, /<h1[^>]*data-source-line="4"[^>]*data-source-line-end="4"[^>]*id="heading"[^>]*>Heading<\/h1>/);
});

test('compilePreviewDocument renders interactive frontmatter controls for preview mode', () => {
  const markdown = [
    '---',
    'title: Demo note',
    'tags:',
    '  - alpha',
    '---',
    '',
    '# Heading',
  ].join('\n');

  const { html } = compilePreviewDocument({
    frontmatterCollapsed: true,
    frontmatterInteractive: true,
    markdownText: markdown,
  });

  assert.match(html, /<section class="frontmatter-block" data-source-line="1" data-source-line-end="5" data-collapsed="true">/);
  assert.match(html, /<button type="button" class="frontmatter-toggle" aria-controls="frontmatter-body-1-5" aria-expanded="false">Show<\/button>/);
  assert.match(html, /<div class="frontmatter-summary">2 properties hidden<\/div>/);
  assert.match(html, /<div class="frontmatter-content" id="frontmatter-body-1-5" hidden>/);
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

test('compilePreviewDocument marks unresolved wiki-links as creatable by default', () => {
  const { html } = compilePreviewDocument({
    fileList: ['README.md'],
    markdownText: 'See [[missing-note]].',
  });

  assert.match(html, /class="wiki-link wiki-link-new"/);
  assert.match(html, /title="Create &quot;missing-note&quot;"/);
});

test('compilePreviewDocument marks unresolved wiki-links as missing when auto-create is disabled', () => {
  const { html } = compilePreviewDocument({
    fileList: ['README.md'],
    markdownText: 'See [[missing-note]].',
    wikiLinkAutoCreate: false,
  });

  assert.match(html, /class="wiki-link wiki-link-new"/);
  assert.match(html, /title="Missing &quot;missing-note&quot;"/);
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

test('compilePreviewDocument falls back to raw markdown rendering for invalid YAML frontmatter', () => {
  const markdown = [
    '---',
    'title: [oops',
    '---',
    '',
    '# Heading',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.doesNotMatch(html, /frontmatter-block/);
  assert.match(html, /<hr>/);
  assert.match(html, /title: \[oops/);
  assert.match(html, /<h1[^>]*data-source-line="5"[^>]*data-source-line-end="5"[^>]*id="heading"[^>]*>Heading<\/h1>/);
});

test('compilePreviewDocument falls back to raw markdown rendering when frontmatter is missing a closing delimiter', () => {
  const markdown = [
    '---',
    'title: Missing closer',
    '',
    '# Heading',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.doesNotMatch(html, /frontmatter-block/);
  assert.match(html, /<hr>/);
  assert.match(html, /<p data-source-line="2" data-source-line-end="2">title: Missing closer<\/p>/);
  assert.match(html, /<h1[^>]*data-source-line="4"[^>]*data-source-line-end="4"[^>]*id="heading"[^>]*>Heading<\/h1>/);
});

test('compilePreviewDocument preserves nested task list structure', () => {
  const markdown = [
    '- [ ] First todo',
    '  - [ ] Nested todo',
  ].join('\n');

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(
    html,
    /<li[^>]*class="task-list-item"[^>]*>[\s\S]*<ul[^>]*>[\s\S]*<li[^>]*class="task-list-item"[^>]*>/,
  );
});

test('compilePreviewDocument renders YouTube markdown images as no-cookie embeds', () => {
  const markdown = '![Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)';

  const { html } = compilePreviewDocument({ markdownText: markdown });

  assert.match(html, /class="video-embed-placeholder video-embed-shell diagram-preview-shell"/);
  assert.match(html, /data-video-embed-kind="youtube"/);
  assert.match(html, /data-video-embed-original-url="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
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
  assert.match(html, /data-video-embed-original-url="https:\/\/cdn\.example\.com\/videos\/demo\.mp4"/);
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

  assert.match(html, /<img src="https:\/\/cdn\.example\.com\/screenshot\.png" alt="Screenshot" loading="lazy" decoding="async">/);
  assert.doesNotMatch(html, /video-embed/);
});

test('compilePreviewDocument rewrites relative vault image attachments through the attachment API', () => {
  const markdown = '![Screenshot](README.assets/screenshot.png)';

  const { html } = compilePreviewDocument({
    attachmentApiPath: '/app/api/attachment',
    markdownText: markdown,
    sourceFilePath: 'README.md',
  });

  assert.match(
    html,
    /<img src="\/app\/api\/attachment\?path=README\.assets%2Fscreenshot\.png" alt="Screenshot" loading="lazy" decoding="async">/,
  );
});

test('compilePreviewDocument renders vault-root wiki image embeds through the attachment API', () => {
  const { html } = compilePreviewDocument({
    attachmentApiPath: '/api/attachment',
    markdownText: '- Image: ![[assets/image-20260528-091012.webp]]',
    sourceFilePath: 'webmcp-full-matrix-20260829/index.md',
  });

  assert.match(
    html,
    /<img src="\/api\/attachment\?path=assets%2Fimage-20260528-091012\.webp" alt="assets\/image-20260528-091012" loading="lazy" decoding="async">/,
  );
  assert.doesNotMatch(html, /wiki-link-new/);
});

test('compilePreviewDocument resolves relative wiki image embeds from the source file', () => {
  const { html } = compilePreviewDocument({
    attachmentApiPath: '/api/attachment',
    markdownText: '![[./cover.png|Cover]]',
    sourceFilePath: 'notes/welcome.md',
  });

  assert.match(
    html,
    /<img src="\/api\/attachment\?path=notes%2Fcover\.png" alt="Cover" loading="lazy" decoding="async">/,
  );
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

  assert.match(html, /<img src="https:\/\/drive\.google\.com\/file\/d\/abc123\/view\?usp=sharing" alt="Drive video" loading="lazy" decoding="async">/);
  assert.doesNotMatch(html, /video-embed/);
});

test('large-document classification triggers on any configured threshold', () => {
  const largeByChars = analyzeMarkdownComplexity('a'.repeat(LARGE_DOCUMENT_CHAR_THRESHOLD));
  assert.equal(isLargeDocumentStats(largeByChars), true);

  const largeByMermaid = analyzeMarkdownComplexity('```mermaid\ngraph TD\nA-->B\n```\n'.repeat(20));
  assert.equal(isLargeDocumentStats(largeByMermaid), true);

  const largeByMermaidEmbed = analyzeMarkdownComplexity('![[diagram.mmd]]\n'.repeat(20));
  assert.equal(isLargeDocumentStats(largeByMermaidEmbed), true);

  const largeByDrawio = analyzeMarkdownComplexity('![[diagram.drawio]]\n'.repeat(8));
  assert.equal(isLargeDocumentStats(largeByDrawio), true);

  const largeByExcalidraw = analyzeMarkdownComplexity('![[diagram.excalidraw]]\n'.repeat(8));
  assert.equal(isLargeDocumentStats(largeByExcalidraw), true);

  const largeByPlantUml = analyzeMarkdownComplexity('```plantuml\n@startuml\nAlice -> Bob: Hi\n@enduml\n```\n'.repeat(12));
  assert.equal(isLargeDocumentStats(largeByPlantUml), true);

  const largeByPlantUmlEmbed = analyzeMarkdownComplexity('![[diagram.puml]]\n'.repeat(12));
  assert.equal(isLargeDocumentStats(largeByPlantUmlEmbed), true);

  const largeByPlantUmlLongEmbed = analyzeMarkdownComplexity('![[diagram.plantuml]]\n'.repeat(12));
  assert.equal(isLargeDocumentStats(largeByPlantUmlLongEmbed), true);
});
