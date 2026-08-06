# Markdown round-trip compatibility

GitHub issue: [#22 — Map CollabMD Markdown round-trip compatibility](https://github.com/andes90/collabmd/issues/22)

## Bottom line

CollabMD is already source-backed for text. Markdown is kept in a Yjs
`Y.Text`/CodeMirror document; preview HTML is a projection and there is no
Markdown-AST-to-source serializer. A normal editor transaction therefore
changes only the selected range, leaving the other characters untouched. This
is the correct Phase One boundary.

There is one important byte caveat: hydration normalizes CRLF/CR to LF in the
collaboration document, and the first intentional editable-content save writes
that LF text to disk. An open-only session (including comments, preview,
switching files, or initial sync) does not write the vault. The guarantee is
therefore “unchanged source ranges stay byte-stable for LF input; CRLF is
canonicalized at the first real save,” not “every future save preserves the
original file byte stream.”

For this note, **Phase One** means the current CodeMirror/Yjs text editor and
toolbar. **Phase Two** means any future structured/block editing or
round-trip API. Phase Two must use source ranges (or a lossless concrete syntax
tree) and patch the original source; it must not serialize rendered HTML,
`markdown-it` tokens, or parsed YAML back into Markdown.

## Repository evidence

- Markdown paths are `.md`, `.markdown`, and `.mdx`; Base, Mermaid, PlantUML,
  Excalidraw, draw.io, and image paths have distinct kinds in
  [`src/domain/file-kind.js:1-145`](../../src/domain/file-kind.js).
- Markdown preview uses `markdown-it` with `html: false`, `linkify: true`, and
  `typographer: true`, then adds source-line attributes, heading IDs, custom
  fences, wiki links, embeds, task checkboxes, image/video handling, and table
  wrappers in [`src/client/application/preview-render-compiler.js:450-671`](../../src/client/application/preview-render-compiler.js).
- Valid YAML frontmatter is recognized only when the document starts with an
  exact `---` line, has a later exact `---` line, and parses with `js-yaml`;
  preview displays parsed values while replacing those source lines with blank
  lines to keep body source-line numbers aligned in
  [`src/domain/yaml-frontmatter.js:11-57`](../../src/domain/yaml-frontmatter.js) and
  [`src/client/application/markdown-frontmatter.js:31-94`](../../src/client/application/markdown-frontmatter.js).
- Toolbar actions are range edits, not AST edits. Exact marker patterns,
  block-prefix normalization, code-fence unwrap, table insertion, and the
  complete action set are in
  [`src/client/domain/markdown-formatting.js:1-515`](../../src/client/domain/markdown-formatting.js); CodeMirror dispatches those edits as
  `userEvent: 'input'` in [`src/client/infrastructure/editor-view-adapter.js:907-943`](../../src/client/infrastructure/editor-view-adapter.js).
- Markdown, Mermaid, and PlantUML are the only comment-supported kinds;
  comments persist as sidecars with Yjs-relative anchors, source lines, and a
  normalized quote. Base, draw.io, and Excalidraw are excluded by
  [`src/domain/file-kind.js:134-140`](../../src/domain/file-kind.js) and
  [`src/domain/comment-threads.js:146-238`](../../src/domain/comment-threads.js).
- Hydration and external reconciliation normalize editable text to LF in
  [`src/server/domain/collaboration/collaboration-room.js:133-135,289-312,545-607`](../../src/server/domain/collaboration/collaboration-room.js).
  Dirty content is persisted only when the Yjs text differs from the hydrated
  baseline ([`src/server/domain/collaboration/collaboration-room.js:423-432,485-512`](../../src/server/domain/collaboration/collaboration-room.js));
  `VaultFileStore` writes the supplied text verbatim and skips the vault write
  when `includeContent` is false ([`src/server/infrastructure/persistence/vault-file-store.js:648-679`](../../src/server/infrastructure/persistence/vault-file-store.js)).
- Existing tests prove the line-ending boundary and the current render/toolbar
  surface: [`tests/node/collaboration-room.test.js:97-172`](../../tests/node/collaboration-room.test.js),
  [`tests/node/websocket-collaboration.test.js:60-89`](../../tests/node/websocket-collaboration.test.js),
  [`tests/node/markdown-formatting.test.js:15-140`](../../tests/node/markdown-formatting.test.js), and
  [`tests/node/preview-render-compiler.test.js:11-498`](../../tests/node/preview-render-compiler.test.js).

Representative vault evidence is deliberately mixed rather than a synthetic
single “everything” note:

- [`test-vault/showcase.md:1-141`](../../test-vault/showcase.md) exercises block
  quotes, ordered/task lists, inline markers, links, Mermaid and PlantUML
  fences, Excalidraw/Mermaid/PlantUML embeds, and an unresolved wiki link.
- [`test-vault/sample-full.md:1-248`](../../test-vault/sample-full.md) is the
  dense technical note with multiple Mermaid fences plus standalone
  Excalidraw/PlantUML embeds and wiki links.
- [`test-vault/README.md:1-9`](../../test-vault/README.md) and
  [`test-vault/daily/2026-03-05.md:1-8`](../../test-vault/daily/2026-03-05.md)
  provide small link and task-list files; [`test-vault/projects/collabmd.md:1-20`](../../test-vault/projects/collabmd.md)
  includes a nested path and an unresolved empty link.
- Standalone text diagrams are [`test-vault/sample-mermaid.mmd`](../../test-vault/sample-mermaid.mmd),
  [`test-vault/showcase-mermaid.mmd`](../../test-vault/showcase-mermaid.mmd),
  [`test-vault/sample-plantuml.puml`](../../test-vault/sample-plantuml.puml),
  and [`test-vault/showcase-sequence.puml`](../../test-vault/showcase-sequence.puml);
  Excalidraw JSON is in [`test-vault/showcase.excalidraw`](../../test-vault/showcase.excalidraw).
  The checked-in vault has no `.base` or `.drawio` sample, so those kinds must
  be covered by the synthetic fixtures and existing tests.
- [`test-vault/.collabmd/comments/README.md.json`](../../test-vault/.collabmd/comments/README.md.json)
  currently contains resolved threads (`resolvedAt`), making it useful for
  overview filtering but not for an open-thread round-trip case; add a small
  open line/text sidecar fixture for that boundary.

## Compatibility matrix

Status terms: **P1 range-safe** means direct typing or a toolbar operation can
patch a known range without reserializing unrelated source. **P1 manual** means
ordinary text edits are safe but the existing toolbar does not understand the
source form. **P2 patchable** is a recommendation for a future lossless source
range editor, not an implementation claim. **Opaque/source-backed** means keep
the original bytes and do not offer a structural rewrite until a lossless
mapping exists.

| Construct / source form | Current renderer/editor evidence | Phase One | Phase Two boundary | Byte/source risks |
| --- | --- | --- | --- | --- |
| Plain paragraphs and inline text | `markdown-it` text/paragraph tokens; CodeMirror Markdown language | **P1 range-safe** for direct edits | **P2 patchable** by exact text span | Preview typographer/arrow substitutions are display-only; source remains authoritative. |
| ATX headings `#` through `######` | Heading IDs are generated in preview; toolbar has explicit H1–H6 actions | **P1 range-safe** for the toolbar’s `#{1,6} ` form | **P2 patchable** by heading marker/content spans | Heading IDs are derived HTML, not source. Setext headings (`Title` + `===`) render but are **P1 manual/opaque** to the toolbar. |
| Emphasis, strong, strike, inline code | Renderer supports Markdown emphasis/strike; toolbar toggles `**`, `_`, `~~`, and single backticks | **P1 range-safe** only for those exact toolbar markers; direct typing is safe for all parser forms | **P2 patchable** with delimiter-preserving spans | Existing `*em*`, `__strong__`, longer backtick runs, escapes, and nested delimiters are source-backed; toolbar will not reliably unwrap them. |
| Block quotes | Renderer supports Markdown block quotes; toolbar emits `> ` | **P1 range-safe** for simple first-level `> ` lines | **P2 patchable** per quote marker while preserving nesting | Nested `>>`, lazily continued lines, and quoted lists are **P1 manual/opaque**; block-prefix normalization can duplicate markers. |
| Unordered lists | Renderer supports `-`, `*`, `+`; toolbar recognizes those at column 0 and emits `- ` | **P1 range-safe** for unindented simple items | **P2 patchable** per list marker/indent | Selecting nested/indented items can prepend a second marker because toolbar patterns are anchored at column 0. Preserve marker style/indent in structured mode. |
| Ordered lists | Renderer supports normal ordered lists; toolbar recognizes `N. ` and emits renumbered `N. ` | **P1 range-safe** for `N. ` lines | **P2 patchable** with delimiter/indent preservation | `N)` and other valid marker styles are **P1 manual/opaque**; toolbar renumbers selected non-empty lines. |
| Task lists | Preview recognizes `[ ]`, `[x]`, `[X]` text and emits checkbox inputs; preview clicks replace only the marker | **P1 range-safe** for a checkbox toggle; toolbar emits `- [ ] ` | **P2 patchable** by marker span, retaining bullet/indent style | Toolbar only recognizes column-zero `- [ ]`; preview click regex is broader (nested, `*`/`+`, ordered markers). Keep the original prefix. |
| Fenced/indented code | `markdown-it` fallback fence with Highlight.js; toolbar wraps in triple backticks | **P1 range-safe** when inserting a new plain triple-backtick fence; direct edits inside any code block are safe | **P2 patchable** only with fence delimiter/info/body spans | Existing fence info is not lossless under toolbar toggle: `unwrapCodeFence` accepts any info then removes it; tildes, longer fences, and partial selections are **opaque**. |
| Mermaid / PlantUML fences (` ```mermaid`, ` ```plantuml`, ` ```puml` ) | Custom preview shells retain hidden source and `data-source-line` | **P1 manual/range-safe** inside the fence; no toolbar diagram rewrite | **P2 patchable** for body-only edits while preserving fence spelling, indentation, and info string | Rendering is a projection; changing fence headers or body can invalidate diagram source and comment line anchors. |
| Base fences (` ```base` ) | Custom Base placeholder carries the raw fence source; Base query/index reads Markdown frontmatter separately | **P1 manual/source-backed** only | **P2 patchable** for raw YAML/query spans with a lossless YAML source map | Parsed Base/query output must never be serialized over the source; comments are not supported for `.base`. |
| Standard links `[label](destination "title")` and autolinks | Renderer adds target/rel for non-fragment links; toolbar inserts only inline links with an `https://` placeholder | **P1 range-safe** for toolbar-created/selected inline links; direct edits safe for all forms | **P2 patchable** by label/destination/title spans | Reference links, angle destinations, escaped parentheses, titles, and autolinks are **P1 manual/opaque**. Fragment links intentionally stay in-tab. |
| Standard images `![alt](path)` | Renderer rewrites relative image attachments to `/api/attachment`; external images stay images | **P1 range-safe** for text/path edits; image upload inserts a normal inline image | **P2 patchable** by alt/destination span | Keep original destination syntax and titles. The API URL is preview-only and must never be written into Markdown. |
| Video image syntax | `![label](https://youtube…)` and direct `.mp4/.webm/.ogg` become preview shells; toolbar inserts the same syntax | **P1 range-safe** for the source image node | **P2 patchable** by original URL/label spans | Canonical no-cookie YouTube URL and `<video>` shell are derived; preserve the author URL (`data-video-embed-original-url`) in source. |
| Tables | `markdown-it` table tokens wrapped in `.table-wrapper`; toolbar inserts a simple 2×2 pipe table | **P1 range-safe** for inserted/simple tables; direct cell edits safe | **P2 patchable** per row/cell while retaining pipes, alignment, escapes, and spacing | Existing alignment, escaped pipes, multiline cells, and noncanonical spacing are **source-backed**; do not table-serialize. |
| Thematic breaks | Renderer supports Markdown rules; toolbar inserts `---` with block spacing | **P1 range-safe** for inserted `---` | **P2 patchable** as one source span | `***`, `___`, and frontmatter delimiters have different source meaning; preserve the original spelling. |
| Wiki links `[[target]]`, `[[target\|label]]` | Custom regex + exact/suffix/implicit-`.md` resolution; unresolved links may create files | **P1 manual/source-backed** (ordinary text edits); no toolbar action | **P2 patchable** only for target/label spans matched by the extension grammar | Regex is one-line and does not support heading fragments on ordinary links, nested `]`, or all escaping forms. Backlinks use a separate regex extractor. |
| Wiki embeds `![[*.base|*.excalidraw|*.drawio|*.mmd|*.mermaid|*.puml|*.plantuml]]` (+ Base `#view`) | Custom placeholders keyed by target/occurrence; diagram controllers hydrate separately | **P1 manual/source-backed**; edit the literal embed text only | **P2 patchable** by target/view/label spans, never by placeholder HTML | `![[image.png]]` is not this extension’s embed form. Placeholder keys, labels, and API paths are derived and must not replace source syntax. |
| YAML frontmatter (`---` … `---`) | Exact opening/closing lines + `js-yaml`; preview shows parsed/serialized values and blanks body lines for source-line alignment | **P1 manual/source-backed**; no metadata editor exists | **P2 patchable** only with raw key/value spans and delimiter preservation | YAML comments, quotes, key order, anchors, scalar style, dates, and line endings are not round-trippable through parsed data. Invalid/missing-close frontmatter falls back to ordinary Markdown. |
| Raw HTML, JSX/MDX, and custom directives | Renderer sets `html:false`; raw tags are escaped. `.mdx` is classified as Markdown but no MDX runtime is enabled | **P1 manual/source-backed** only | **P2 opaque** unless a dedicated extension provides lossless ranges | Do not interpret or serialize HTML/JSX. Security behavior depends on keeping raw HTML disabled. |
| Reference definitions, footnotes, extensions not listed above | No custom support in the renderer or toolbar | **P1 manual/source-backed** | **P2 opaque** until a parser/source map is explicitly added | A generic AST round-trip would normalize or drop definitions/whitespace and would violate untouched-byte stability. |
| Standalone `.mmd`/`.mermaid`, `.puml`/`.plantuml`, `.base` | File-kind selects Mermaid/PlantUML language or YAML; Markdown toolbar is hidden for non-Markdown | **P1 manual/range-safe** text edits; `.base` remains YAML source | **P2 patchable** only by file-kind-specific source editor | Direct `.drawio` and `.excalidraw` editors are separate structured formats, not Markdown. Their Markdown embeds stay source-backed. |
| Comments and source-line metadata | Comment sidecars store Yjs-relative positions, line range, and normalized quote; preview derives `data-source-line` from parser maps | **P1 safe as sidecar/source-anchor operations**; comments do not rewrite vault text | **P2 must update relative anchors and source ranges atomically** | `data-source-line*` attributes are HTML metadata, not persisted Markdown. Structural edits can make line fallback stale; do not key comments to rendered HTML IDs. |

## What “untouched” means

1. **Open-only:** read the file, hydrate, render, add/reopen comments, collapse
   frontmatter, navigate, and switch away. The original vault file bytes must
   remain unchanged. This is covered for CRLF by
   [`tests/node/websocket-collaboration.test.js:60-89`](../../tests/node/websocket-collaboration.test.js).
2. **Intentional text edit:** apply a CodeMirror/Yjs range delta. For an
   already-LF file, all characters outside the delta remain byte-for-byte
   identical when the dirty Yjs text is persisted. Persistence writes the whole
   text, but it does not parse or regenerate it.
3. **First edit of CRLF/CR input:** the Yjs document is normalized to LF during
   hydration, so the first dirty save rewrites line endings throughout the
   file. This is intentional canonicalization, proved by
   [`tests/node/collaboration-room.test.js:97-146`](../../tests/node/collaboration-room.test.js).
4. **Comment-only change:** sidecar writes can occur with `includeContent: false`;
   they must not touch vault content. A later content edit follows the LF save
   policy even if it visually returns to the old text after a prior save.
5. **External reconciliation:** external content is normalized to LF and
   replaced in the room by a minimal common-prefix/common-suffix text change;
   it is an observation, not an editable-content save. Any later intentional
   edit is governed by the same save boundary.

## Recommended minimal fixture corpus

Keep fixtures small and byte-visible. Each fixture should have an LF and a CRLF
variant where line-ending behavior matters; tests should compare raw bytes and
not only rendered HTML.

| Fixture | Required source forms | Assertions |
| --- | --- | --- |
| `core-markdown.md` | ATX + setext headings; paragraphs; nested block quotes; `-`, `*`, `+`, `N.`, `N)` lists; nested tasks; `**`, `__`, `_`, `*`, `~~`, single/long backticks; hard breaks; tables with alignment/escaped pipes; `---`, `***`, `___`; fenced and indented code | Preview output and `data-source-line` spans; every P1 toolbar action changes only its selected range; alternate forms remain unchanged when another block is edited; nested-list toolbar risk is explicit. |
| `links-media.md` | Inline links with titles/escaped destinations; reference link + definition; autolink; local image (`assets/x.png`), external image, unsupported URL, YouTube and direct video; `[[note]]`, `[[path/note.md\|label]]`, unresolved link, ordinary `[[note#heading]]`; all supported `![[…]]` diagram/Base embeds | Preview class/URL assertions from `tests/node/preview-render-compiler.test.js`; source keeps original URLs/targets; reference/heading-fragment forms stay opaque. |
| `extensions.md` | ` ```mermaid`, ` ```plantuml`, ` ```puml`, ` ```base`; custom fence info/indentation; duplicate fences/embeds; Base `#view` embed | Placeholder type, occurrence key, hidden source, and source-line assertions; body-only patch leaves fence header and all other blocks unchanged. |
| `metadata-and-opaque.md` | Valid frontmatter with scalar/list/complex/date/quoted values and YAML comments; empty frontmatter; invalid YAML; missing closer; raw HTML, JSX/MDX, and unknown directive | Valid metadata renders as a preview block with body line alignment; invalid/missing-close input renders as normal Markdown; parsed display is never used to regenerate source; raw tags stay escaped. |
| `line-endings.md` | Same `core-markdown.md` content in CRLF and LF, including a commentable line and a fence | Open-only byte/mtime equality; comment-only sidecar write leaves bytes/mtime; one intentional edit changes expected content and converts CRLF to LF; undo-before-first-persist does not write. |
| `vault/` | `README.md`, `showcase.md`, `sample-full.md`, nested notes, `.mmd`/`.mermaid`, `.puml`/`.plantuml`, `.base`, `.drawio`, `.excalidraw`, and image attachment | File-kind routing, Markdown toolbar visibility, standalone source editor, embed preview, and comment support match `file-kind.js`; unsupported files are not silently treated as Markdown. Existing representative content is in [`test-vault/`](../../test-vault). |
| `comments/` | Sidecar with line and text anchors on paragraph, heading, task, Mermaid/PlantUML fence; resolved and unsupported-kind sidecars | Relative anchors reopen after nearby edits; source quote/line fallback remains best-effort; comments never rewrite Markdown and `.base`/draw.io/Excalidraw are excluded. |

The smallest useful automated checks are:

- raw-byte snapshot before/after open-only and comment-only flows;
- a per-action source diff for `createMarkdownToolbarEdit` (including nested
  and alternate marker cases);
- preview assertions for every custom renderer extension and source-line range;
- a dirty-save check proving LF canonicalization and an unchanged LF block;
- sidecar/comment rehydration after an edit before the anchor;
- file-kind matrix checks for `.md`, `.markdown`, `.mdx`, `.base`, diagram
  files, and attachments.

## Ready-to-post resolution

> **Resolution:** Keep Markdown source as the authority. Phase One can safely
> use the existing CodeMirror/Yjs range edits and toolbar for plain text,
> ATX headings, simple first-level quotes/lists/tasks, the toolbar’s exact
> inline markers, standard inline links/images/video, simple tables, thematic
> breaks, and new plain code fences. Direct edits inside any other text remain
> safe because CollabMD does not serialize a Markdown AST. Mermaid, PlantUML,
> Base fences, wiki links/embeds, frontmatter, reference definitions, raw
> HTML/MDX, and noncanonical Markdown forms stay source-backed; preview HTML,
> placeholder keys, heading IDs, attachment API URLs, and `data-source-line`
> attributes are never written back.
>
> Phase Two may add structured editing only with a lossless source map (or a
> concrete syntax tree that retains delimiters, whitespace, comments, fence
> info, and raw scalar style) and must patch exact source ranges. It must leave
> unknown/unsupported blocks opaque and update Yjs-relative comment anchors
> atomically. Open-only sessions preserve bytes exactly; the first intentional
> save of CRLF/CR content intentionally canonicalizes the editable text to LF.
> The fixture corpus above proves both the safe boundary and these exclusions.
