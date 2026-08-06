# Phase Two rich editing feasibility

Research for [issue #19](https://github.com/andes90/collabmd/issues/19), “Test Phase Two rich editing against canonical Markdown”. 2026-08-06.

## Decision

**No current off-the-shelf rich editor can satisfy all of the issue’s constraints at once.** ProseMirror/Tiptap, Milkdown, and Lexical can provide a good structured collaborative editor, but their collaborative models are trees (`Y.XmlFragment`, `Y.XmlElement`, or `Y.XmlText`), not CollabMD’s canonical Markdown `Y.Text`. Their Markdown support is a parse/serialize bridge, not a concrete-syntax-preserving source model. Switching to one would require changing the canonical-document invariant or accepting source loss/reformatting.

The strongest Phase Two choice is therefore **source-first structured assistance**: keep CodeMirror + `Y.Text` canonical, keep Source cursors/comments/undo exact, and add/extend source-producing commands plus the rendered preview. Do not add a second collaborative rich document.

If product requirements instead make true WYSIWYG editing non-negotiable, explicitly change the invariant to a structured Yjs document (Tiptap/ProseMirror or Milkdown is the most natural fit) and treat Markdown as generated/imported content. Do not call that source-preserving mixed-mode editing.

## Constraints being tested

“Canonical Markdown” means the content itself is one `Y.Text` shared type. The existing comment `Y.Array` and persisted sidecars remain collaboration metadata, not a second content document.

| Requirement | Required meaning | Result |
| --- | --- | --- |
| Canonical content | Markdown source in one shared `Y.Text`; filesystem stores its text | Met by current source editor; not by tree bindings |
| Exact mixed-mode positions | A Source index/selection/comment and a Visual position identify the same location, including Markdown delimiters | Not generally possible from an abstract Markdown tree |
| Source-preserving edits | Editing a visual span does not rewrite unrelated whitespace, delimiter spelling, escapes, HTML, or extensions | Not guaranteed by parse/serialize editors |
| Collaborative undo | Local undo/redo works across concurrent peers without undoing another peer | Available when all edits target one shared type; split models create two histories |
| External/source edits | File watcher and Git changes reconcile into the live room while retaining anchors | Existing path is Y.Text-specific |
| Mobile and accessibility | IME/composition, touch selection, keyboard navigation, and screen-reader behavior remain usable | Must be tested for any contenteditable replacement; source mode already has an ARIA-labelled editor |

## What CollabMD does today (repo evidence)

1. **One source text and one source-scoped undo manager.** [`EditorCollaborationClient.initialize`](../../src/client/infrastructure/editor-collaboration-client.js#L52-L102) creates a `Y.Doc`, `doc.getText('codemirror')`, `doc.getArray('comments')`, and `new Y.UndoManager(this.ytext)`, then exposes them over one `WebsocketProvider`.
2. **CodeMirror is bound directly to that text.** [`EditorViewAdapter.initialize`](../../src/client/infrastructure/editor-view-adapter.js#L490-L504) creates the CodeMirror document from `ytext.toString()` and installs `yCollab(ytext, awareness, { undoManager })`. The Markdown language extension and the editor’s `aria-label="Markdown editor"` are in [`getBaseExtensions`](../../src/client/infrastructure/editor-view-adapter.js#L381-L418).
3. **Selections are source offsets.** [`getCurrentSelectionCommentAnchor`](../../src/client/infrastructure/editor-view-adapter.js#L690-L725) returns start/end character indexes, source line numbers, and source excerpts.
4. **Comments are relative positions in that same `Y.Text`.** [`CommentThreadStore.createCommentThread`](../../src/client/infrastructure/comment-thread-store.js#L151-L183) calls `Y.createRelativePositionFromTypeIndex(this.ytext, ...)` for both ends. Resolution requires the position’s type to be exactly `this.ytext` in [`resolveCommentPosition`](../../src/client/infrastructure/comment-thread-store.js#L378-L394).
5. **Hydration starts from the file’s text.** [`CollaborationRoom.hydrate`](../../src/server/domain/collaboration/collaboration-room.js#L289-L321) reads editable content and comment sidecars, inserts normalized content into `doc.getText('codemirror')`, and populates the comments array.
6. **Persistence writes both plain content and a CRDT snapshot.** [`CollaborationRoom.persist`](../../src/server/domain/collaboration/collaboration-room.js#L485-L512) serializes `getPersistedContent()` (the `Y.Text` string for text rooms), comments, and `Y.encodeStateAsUpdate(this.doc)`. [`CollaborationDocumentStore.persistState`](../../src/server/domain/collaboration/collaboration-document-store.js#L46-L67) passes those values to the vault store, and [`VaultFileStore.persistCollaborationState`](../../src/server/infrastructure/persistence/vault-file-store.js#L648-L679) writes the text file plus comment JSON and binary snapshot as one managed operation.
7. **External edits are minimal source replacements.** [`CollaborationRoom.applyExternalContent`](../../src/server/domain/collaboration/collaboration-room.js#L545-L607) computes a prefix/suffix replacement and deletes/inserts only the changed `Y.Text` span under `workspace-reconcile`. This is what lets Yjs relative anchors move with source edits instead of resetting the whole document.
8. The product contract says the filesystem remains the source of truth and CollabMD continuously writes **plain text** back to disk, while external file changes reconcile into live rooms ([`README.md`](../../README.md#L195-L202); [`README.md`](../../README.md#L714-L721)). Current dependencies include CodeMirror, `y-codemirror.next`, `y-websocket`, and `yjs`, but no ProseMirror/Tiptap, Milkdown, or Lexical packages ([`package.json`](../../package.json#L65-L94)).

## What the candidate architectures actually synchronize

### ProseMirror, Tiptap, and Milkdown

- The official [`y-prosemirror`](https://github.com/yjs/y-prosemirror) binding says plainly: “This binding maps a `Y.XmlFragment` to the ProseMirror state.” It provides shared cursors and client-local shared undo/redo, and warns that JSON serialization is not primary collaborative storage because history steps are not retained.
- Tiptap’s official [Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration) configures a `Y.Doc`/`Y.XmlFragment` (`new Y.Doc().getXmlFragment('body')`) and supplies its own history commands. This is a structured Yjs document, not a `Y.Text` containing Markdown source.
- Tiptap’s official [Markdown documentation](https://tiptap.dev/docs/editor/markdown) describes Markdown as a bridge: Markdown string → lexer/tokens → Tiptap JSON, and Tiptap JSON → render handlers → Markdown string. It currently labels the extension beta and explicitly says comments are not supported and may be lost when Markdown content is replaced.
- Tiptap’s [Markdown export limitations](https://tiptap.dev/docs/conversion/export/markdown/editor-extension) explicitly say not to expect lossless conversion or round-trip identity; unsupported styling/layout is dropped and re-import is simplified. That is incompatible with exact source-preserving edits. (The optional `@tiptap-pro/extension-export-markdown` package is also published through Tiptap’s private registry.)
- Milkdown describes itself as a WYSIWYG Markdown editor built on ProseMirror and remark in its [official repository](https://github.com/Milkdown/milkdown). Its official [collaborative-editing guide](https://milkdown.dev/docs/guide/collaborative-editing) installs `y-prosemirror` and lists sync, remote cursors, and undo/redo. The [plugin-collab API](https://milkdown.dev/docs/api/plugin-collab) exposes both `bindDoc(doc)` and `bindXmlFragment(xmlFragment)`, confirming the structured Yjs binding. The official [vanilla collaboration example](https://github.com/Milkdown/examples/blob/main/vanilla-collab/src/create-editor.ts) binds a Yjs `Doc` to `CollabService`, applies a Markdown template, and connects the collab plugin; it does not make Markdown `Y.Text` the collaborative model.

**Assessment:** these are the best candidates if CollabMD accepts a tree as canonical. They solve structural transactions, remote cursors, and tree-scoped undo, but Markdown is an import/export representation. Keeping CollabMD’s `Y.Text` as an additional live model would create two collaborative documents and a conflict-prone bridge.

### Lexical

- The official [`@lexical/yjs` source](https://github.com/facebook/lexical/blob/main/packages/lexical-yjs/src/index.ts) exposes Yjs bindings, `RelativePosition`, `XmlElement`, `XmlText`, and a Yjs `UndoManager`; its binding is tree/node-oriented rather than a Markdown `Y.Text`.
- Lexical’s synchronization implementation directly imports and reconciles Yjs `XmlElement`, `XmlText`, and `Y.Map` events in [`SyncEditorStates.ts`](https://github.com/facebook/lexical/blob/main/packages/lexical-yjs/src/SyncEditorStates.ts), and maps Lexical selections to Yjs cursor positions.
- The official [`@lexical/markdown` package](https://github.com/facebook/lexical/tree/main/packages/lexical-markdown) offers `$convertFromMarkdownString` and `$convertToMarkdownString` through configurable transformers. The [Lexical repository README](https://github.com/facebook/lexical) lists Markdown/HTML serialization, Yjs collaboration, built-in accessibility/WCAG support, and browser support as separate features.

**Assessment:** Lexical has a credible rich editor and accessibility story, but it has the same canonical-model tradeoff. Markdown transformers map into/out of Lexical nodes; they do not preserve every source token or delimiter identity. It would also cross CollabMD’s current vanilla CodeMirror editor boundary and add a second editor state model.

### Current CodeMirror/Y.Text binding

The official [`y-codemirror.next`](https://github.com/yjs/y-codemirror.next) README says it binds a `Y.Text` to CodeMirror 6 and provides remote awareness ranges/cursors and client-local shared undo/redo as separate plugins. That is exactly CollabMD’s current architecture: source offsets, source comments, source-aware external reconciliation, and no semantic WYSIWYG projection.

Yjs does document [`Y.Text`](https://docs.yjs.dev/api/shared-types/y.text) as supporting inline formatting attributes and a Delta view, but `toString()` is still the character sequence and the type has no Markdown block/tree semantics. Adding formatting attributes to CollabMD’s existing `Y.Text` would not make `#`, `**`, list markers, fences, raw HTML, or line trivia into structured nodes; CodeMirror and the comment resolver would still be operating on source characters.

### Custom concrete-syntax projection over `Y.Text`

This is the only way to keep `Y.Text` as the sole content CRDT while attempting true visual editing: retain a concrete syntax tree (tokens, delimiters, whitespace, escapes, raw HTML, and extension nodes), map every visual node back to source spans, and compile visual transactions into minimal Y.Text edits. No candidate above supplies that bridge for CollabMD’s Markdown dialect. It is a new editor/parser/transaction engine, not an adapter, and it still needs a policy for unsupported or malformed Markdown.

## Why the full requirement is not representable by an abstract rich tree

Let `P(source)` be the Markdown parser and `S(tree)` be the serializer. A normal rich editor stores `P(source)` (or an equivalent abstract tree), not the original token stream. Markdown parsing is not injective:

```text
`**bold**`       and       `__bold__`
`- one`          and       `* one`
`# Heading`     and       `Heading\n=======`
`[site](https://example.com)`  and  `<https://example.com>`
`two  \n`         and       `two\\\n`
```

Each pair can render to the same semantic structure while differing in source bytes, delimiter choice, or invisible whitespace. Therefore `P(a) = P(b)` for distinct `a` and `b`; no serializer can guarantee both `S(P(a)) = a` and `S(P(b)) = b`. A serializer must choose a spelling and can rewrite source that the user did not edit. Tiptap’s own export documentation calls this out as lack of lossless conversion/round-trip identity.

Retaining the original spelling as extra node metadata can make a narrow subset round-trip, but that metadata is a concrete-syntax model. It must be collaboratively updated with every structural edit and concurrent merge; it is no longer “only the abstract rich tree plus Markdown export.” Unknown HTML, malformed-but-preserved text, wiki links, MDX-like constructs, diagram fences, and future Markdown extensions expand this custom model.

## Cursor, comment, undo, and concurrency limits

### Cursors and comments

Yjs relative positions are stable **within a particular shared type**. The official [relative-position documentation](https://docs.yjs.dev/api/relative-positions) says a position is fixed to an element in the shared document and resolves to the same index once peers sync. CollabMD’s comments intentionally create and resolve positions in `Y.Text('codemirror')`; a ProseMirror/Lexical cursor would instead be relative to a tree node/fragment. There is no universal index conversion:

- A Source caret between the two `*` characters in `**bold**` has no visible text caret equivalent.
- A Visual selection of the word `bold` may correspond to source `[2, 6)`, `[2, 6)` plus delimiters, or a semantic mark range depending on UX policy.
- A comment anchored to a source delimiter, escaped punctuation, or whitespace has no stable rendered glyph to attach to.
- Re-serializing a tree can change source length and line numbers around unrelated content, invalidating line fallback and preview source-line mappings.

An adapter can define best-effort policies, but that is not exact mixed-mode identity.

### Undo/redo

The official [Y.UndoManager documentation](https://docs.yjs.dev/api/undo-manager) scopes history to one shared type (or a set of shared types) and tracks transaction origins. CollabMD’s manager is scoped to `ytext` (repo evidence above). A structured editor’s undo manager is scoped to its Y.Xml tree. If visual edits serialize into Y.Text, one visual action may become a broad source replacement and source undo cannot reconstruct the tree action or its original delimiter choices. If both models have managers, undo order and ownership diverge; one client can undo a source edit while the visual tree still reflects a different projection.

### Concurrent and external edits

Y.Text character-level merges work when all peers edit that text. A tree editor merges node operations in Y.Xml types. Bridging by “parse current Y.Text, apply tree transaction, serialize whole document back to Y.Text” turns a local structural action into a replacement against a moving source; concurrent source edits can be reformatted or overwritten, and relative anchors may jump. CollabMD’s server-side external reconciliation is intentionally a minimal Y.Text replacement, so a visual serializer that rewrites an entire document defeats that invariant.

### Mobile and accessibility

Lexical’s repository advertises built-in accessibility/WCAG support, but that does not provide source↔visual Markdown mapping. ProseMirror/Tiptap/Milkdown contenteditable integrations and any custom bridge still require manual acceptance testing for mobile IME composition, touch selection, virtual keyboards, screen readers, and malformed Markdown. The current CodeMirror path already sets `aria-label="Markdown editor"` and has source keyboard/history behavior; preserving it as the fallback avoids making those guarantees depend on a new mapping layer.

## Options matrix

| Architecture | Rich visual editing | Sole canonical Markdown `Y.Text` | Exact source cursors/comments | Source-preserving bytes | Collaborative undo | Cost/risk |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Keep CodeMirror + `y-codemirror.next` (current) | No (preview/source assistance) | **Yes** | **Yes** | **Yes** | **Yes** | Lowest; proven code path |
| ProseMirror + `y-prosemirror` | **Yes** | No (`Y.XmlFragment`) | No, unless Source mode gives up exact identity | No for arbitrary Markdown | Yes in tree model | High migration; Markdown bridge and parser coverage |
| Tiptap collaboration + Markdown | **Yes** | No (`Y.XmlFragment`) | No; docs warn comments/loss/round-trip limits | No | Yes in tree model | High; extra framework/extensions; optional Pro export is private |
| Milkdown + `plugin-collab` | **Yes** | No (ProseMirror/Y.Xml) | No | No | Yes in tree model | High; ProseMirror + remark + plugin integration |
| Lexical + `@lexical/yjs` | **Yes** | No (`Y.XmlElement`/`Y.XmlText`) | No | No | Yes in tree model | High; new editor state/binding and Markdown transformers |
| Dual `Y.Text` + tree CRDT | **Yes** | **No** (two canonical states) | Best effort only | No under conflict/reformat | Two histories to reconcile | Highest; sync/merge/loop/conflict failure modes |
| Custom concrete-syntax editor over `Y.Text` | Restricted subset only | **In theory** | **Only for explicitly supported syntax** | **Only for that subset** | Possible if all transactions compile to Y.Text | Extreme; new parser, mapping, and mobile/a11y surface |

## Recommended Phase Two shape

1. Keep `Y.Text('codemirror')` as the only collaborative content model and retain CodeMirror for Source mode.
2. Add source-producing structured commands (heading/list/task/quote/emphasis/link/table helpers) that dispatch minimal ranges into the existing `Y.Text`; do not silently normalize untouched syntax.
3. Treat the rendered Markdown preview as the visual reading surface. Keep source-line metadata and the existing Y.RelativePosition comment path as the cross-surface contract.
4. If experimenting with visual editing, restrict it to an explicit, opt-in subset whose round-trip fixtures prove byte preservation; fall back to Source mode for raw HTML, unknown extensions, ambiguous delimiters, malformed Markdown, and diagram/wiki-link constructs. This is a constrained experiment, not a general WYSIWYG claim.
5. If a product decision requires unrestricted WYSIWYG, write a new ADR that changes the canonical model to ProseMirror/Tiptap/Milkdown (or Lexical), stores the structured Yjs snapshot as canonical, and defines Markdown export/import as potentially reformatting. Keep Source mode as a separate import/export or review view, not a second live CRDT. Do not dual-write `Y.Text` and a tree.

## Proof/acceptance plan before any future visual experiment

No prototype is recommended for the current Phase Two decision. If the invariant is changed or a constrained subset is approved, the smallest meaningful gate is a fixture and browser test matrix:

- Round-trip source fixtures for delimiter aliases, list markers, setext/ATX headings, hard breaks, escapes/entities, whitespace, raw HTML, GFM tables/tasks, wiki links, fenced diagrams, and malformed input. Assert `source → visual → source` is byte-identical for every claimed supported fixture.
- Mixed-mode cursor and comment fixtures at text, delimiter, whitespace, and line boundaries. Assert a remote Y.Text insertion/deletion moves the same source anchor and the same visual annotation.
- Two-client concurrent source/visual edits plus external file reconciliation. Assert no unrelated source rewrite and no lost comment.
- Local undo/redo after remote edits in each mode. Assert one user cannot undo another user’s operation and source/visual histories do not diverge.
- Mobile viewport/IME tests (including composition), touch selection, keyboard navigation, and screen-reader checks. Keep Source fallback available whenever any gate fails.

## Ready-to-post resolution answer

> **Resolved:** true structured collaboration is available in ProseMirror/Tiptap/Milkdown and Lexical, but none can keep CollabMD’s plain Markdown `Y.Text` as the sole canonical content while also guaranteeing exact Source↔Visual cursors/comments, source-preserving edits, and shared undo. Their Yjs bindings synchronize structured trees (`Y.XmlFragment`/`Y.XmlElement`/`Y.XmlText`); Markdown is parsed in and serialized out, and official Tiptap docs explicitly warn about unsupported comments, lossless conversion, and round-trip identity. A dual Y.Text+tree design would violate the single-canonical-document invariant and introduce merge/undo conflicts. Phase Two should stay source-first (CodeMirror + Y.Text + relative comments + rendered preview) and add minimal source-producing formatting commands. If unrestricted WYSIWYG is required later, make a deliberate ADR change to a structured Yjs canonical model and accept Markdown reformatting/import-export; do not promise exact mixed-mode source identity.
