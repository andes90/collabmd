# Phase One source-aware editor architecture

Issue: [Survey Phase One source-aware editor architectures](https://github.com/andes90/collabmd/issues/20)

## Recommendation

Extend the existing CodeMirror 6 editor with a small, source-offset-based visual
projection. Keep `Y.Text` as the only canonical document and keep comments as
Yjs relative positions. Add a CodeMirror `StateField<DecorationSet>` (plus a
small `ViewPlugin` only where measurement or event wiring is needed) that
renders visual marks, comment highlights, and non-text controls. Apply edits as
normal CodeMirror transactions so `y-codemirror.next` continues to sync them to
the existing `Y.Text`.

Phase One should use non-destructive `Decoration.mark`/`Decoration.line` and
gutter markers first. Use `Decoration.widget` for controls that do not replace
source text. Defer `Decoration.replace` (hiding Markdown delimiters) until the
source-offset, cursor, IME, screen-reader, and touch behavior is covered by
tests; replacement decorations change what is rendered and require careful
atomic-range and event handling. Scope visual editing to Markdown initially;
Mermaid and PlantUML remain source editors until their visual-to-source mapping
is specified.

This is the smallest path that preserves exact mixed-mode positions, source
ranges, comments, current collaboration, and the existing mobile/editor
integration. It does not introduce a second document model or a parse/serialize
round trip on every edit.

## Options matrix

| Approach | Canonical model and positions | Source preservation / collaboration | Accessibility and mobile | Integration cost and decision |
| --- | --- | --- | --- | --- |
| **CM6 decorations/widgets over Y.Text (recommended)** | Keep UTF-16 CodeMirror offsets over the canonical `Y.Text`; derive visual ranges from source offsets and Y relative positions. `DecorationSet` maps through CM changes; re-resolve Y positions after remote updates. | Existing `yCollab` binding, undo manager, and save path remain unchanged. Marks/widgets do not mutate source. | Existing CM content attributes, keymaps, IME handling, responsive CSS, and remote-caret precedent remain. Keep decorative widgets `aria-hidden`; expose actionable controls as keyboard-focusable UI. | Add one state field and a projection/update path. Lowest bundle and migration risk. **Adopt.** |
| CM6 with aggressive `Decoration.replace`/hidden syntax | Still Y.Text, but rendered positions differ from source positions. Every hidden range needs explicit source mapping, inclusivity, and atomic behavior. | Underlying source can remain intact, but visual clicks/selections must map back to source; widgets covering line breaks have layout constraints. | Higher risk for screen-reader output, cursor movement, composition, Android/iOS selection, and touch targets. | Same editor but substantially more edge cases. **Defer to a later increment; do not make it the Phase One baseline.** |
| ProseMirror + `y-prosemirror` + Markdown parser/serializer | Yjs binding expects a ProseMirror document tree/`Y.XmlFragment` style model; comments must be document state or Y relative positions. Source offsets become tree positions plus a source-map problem. | The official Markdown module parses CommonMark into a schema and serializes back to Markdown. That is a format conversion, not a source-preserving edit stream; it can normalize syntax/spacing and would replace the current Y.Text contract. | Rich node views are possible, but contenteditable and custom schema/node views add new keyboard, IME, and mobile/accessibility surfaces. | New editor, schema, binding, parser, serializer, comment mapping, persistence, and migration. **Reject for Phase One.** |
| Monaco + `y-monaco` | Can bind Y.Text, so source offsets are viable, but all current comment/preview/source mapping code still needs a new editor adapter. | Source text can remain canonical; no advantage over the already-installed CM6/Yjs path. | Large editor surface and separate mobile/accessibility validation; Yjs docs note a build step is required for the complete Monaco setup. | New dependency/runtime and duplicated integration. **Reject for Phase One.** |
| Native `<textarea>` plus overlays | Best raw source and browser/mobile text semantics, but no syntax tree, decoration set, selection geometry, remote-caret layer, folding, or editor commands. | Requires reimplementing the current CM/Yjs binding and all source-range UI around a textarea. | Strong baseline for typing, but overlays and comment widgets still need keyboard and touch semantics. | Rebuilds capabilities already present in CM6. **Reject; only a fallback if the editor is ever deliberately simplified.** |

The ProseMirror and Monaco trade-offs above are architectural inferences from
their documented data models and setup requirements; they are not claims that
those editors are generally inaccessible or unsuitable.

## Evidence from this repository

- The dependency set already contains the complete CM6 stack, `y-codemirror.next`,
  and Yjs; no editor dependency is missing ([`package.json:65-94`](../../package.json#L65-L94)).
- The editor adapter already imports `Decoration`, `WidgetType`, `StateField`,
  and `yCollab` ([`editor-view-adapter.js:24-39`](../../src/client/infrastructure/editor-view-adapter.js#L24-L39)).
  The remote-update flash is a working `StateField` that maps its decoration
  set through every transaction and renders a widget ([`editor-view-adapter.js:65-112`](../../src/client/infrastructure/editor-view-adapter.js#L65-L112)).
  A Phase One visual projection can follow this exact pattern.
- The base extensions already provide line numbers, folding, history, Markdown
  language support, selection drawing, and an accessible content label
  ([`editor-view-adapter.js:381-429`](../../src/client/infrastructure/editor-view-adapter.js#L381-L429)).
  Collaborative initialization creates the state from `ytext` and attaches
  `yCollab` without another document model ([`editor-view-adapter.js:490-503`](../../src/client/infrastructure/editor-view-adapter.js#L490-L503)).
- Collaboration creates one `Y.Doc`, the canonical `Y.Text('codemirror')`, a
  comment array, and a per-client `Y.UndoManager` ([`editor-collaboration-client.js:52-102`](../../src/client/infrastructure/editor-collaboration-client.js#L52-L102)).
- Comment creation stores start/end Y relative positions, not durable integer
  offsets ([`comment-thread-store.js:151-182`](../../src/client/infrastructure/comment-thread-store.js#L151-L182)).
  Resolution converts them back to current absolute indexes and retains line
  and quote fallbacks for deleted or invalid anchors
  ([`comment-thread-store.js:330-394`](../../src/client/infrastructure/comment-thread-store.js#L330-L394)).
  This is the right source of truth for comment decorations.
- Existing selection code already distinguishes line anchors from exact text
  ranges and records source indexes/lines/quotes
  ([`editor-view-adapter.js:690-724`](../../src/client/infrastructure/editor-view-adapter.js#L690-L724)).
  Existing geometry uses `coordsAtPos` and `lineBlockAt`, so a visual layer can
  reuse source positions rather than parse a second document
  ([`editor-view-adapter.js:757-801`](../../src/client/infrastructure/editor-view-adapter.js#L757-L801)).
- Persistence writes `Y.Text.toString()` and comment threads/snapshot together,
  and external reconciliation applies a minimal Y.Text replacement rather than
  replacing the whole editor model ([`collaboration-room.js:485-512`](../../src/server/domain/collaboration/collaboration-room.js#L485-L512), [`collaboration-room.js:574-607`](../../src/server/domain/collaboration/collaboration-room.js#L574-L607), [`collaboration-room.js:801-812`](../../src/server/domain/collaboration/collaboration-room.js#L801-L812)).
  The visual layer must leave this contract untouched.
- Mobile layout already sizes `.cm-editor`/`.cm-scroller` to 16px and turns the
  sidebar into a touch-friendly overlay ([`responsive.css:1-45`](../../src/client/styles/layout/responsive.css#L1-L45)).
  Reusing CM6 avoids introducing a second mobile input surface.

## Primary-source evidence

### CodeMirror 6

- The official [CodeMirror reference for `Decoration`](https://codemirror.net/docs/ref/#view.Decoration)
  documents mark, widget, replace, and line decorations. It explicitly notes
  that replacement/block widgets affect layout and that inclusivity controls
  whether inserted text joins a range.
- [`EditorView.decorations`](https://codemirror.net/docs/ref/#view.EditorView^decorations)
  says direct decoration sets may affect vertical layout, while function-based
  sets run after viewport computation and must not introduce block widgets or
  replacements across line breaks. It also points to
  [`EditorView.atomicRanges`](https://codemirror.net/docs/ref/#view.EditorView^atomicRanges)
  when a decorated range should act as an atomic cursor/deletion unit.
- [`RangeSet.map`](https://codemirror.net/docs/ref/#state.RangeSet.map) maps a
  range set through a `ChangeDesc`; this is the built-in mechanism for keeping
  visual ranges aligned with incremental source edits.
- [`WidgetType`](https://codemirror.net/docs/ref/#view.WidgetType) supports
  lazy DOM creation, equality/update hooks, coordinate overrides, and
  `ignoreEvent`. The current remote caret uses `aria-hidden` and ignores events,
  which is a useful pattern for decorative widgets.
- [`EditorView.contentAttributes`](https://codemirror.net/docs/ref/#view.EditorView^contentAttributes)
  provides DOM attributes on the editable element. CollabMD already uses it for
  `aria-label="Markdown editor"`.
- The official [CodeMirror changelog](https://codemirror.net/docs/changelog/)
  records ongoing Android/iOS fixes (virtual-keyboard composition, scrolling,
  touch selection, and native selection handles). This supports reusing CM6,
  while still requiring device tests for any new widget or hidden-source mode.
- The official [`@codemirror/lang-markdown` source README](https://github.com/codemirror/lang-markdown/blob/main/README.md)
  confirms that Markdown support is an editor language extension and that fenced
  code languages are parsed in-place; it does not require a Markdown
  parse/serialize loop for editing.

### Yjs and editor bindings

- The official [`y-codemirror.next` README](https://github.com/yjs/y-codemirror.next/blob/main/README.md)
  says the binding binds CodeMirror 6 to `Y.Text` and supplies awareness plus
  shared undo/redo as separate plugins. That matches CollabMD's current setup.
- Yjs [relative positions](https://docs.yjs.dev/api/relative-positions.md) are
  explicitly intended for cursor/selection/comment ranges: integer indexes are
  invalidated by remote edits, while relative positions stay attached to their
  referenced content and resolve to the same index after synchronization.
- Yjs [`Y.Text`](https://docs.yjs.dev/api/shared-types/y.text.md) documents
  UTF-16 code-unit length, incremental `insert`/`delete`, `toString`, and
  observers. CodeMirror and Y.Text therefore share the offset unit used by the
  current comment implementation; no code-point conversion layer is needed.
- Yjs's [ProseMirror binding notes](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror.md)
  warn that ordinary index positions do not remain stable under Yjs and advise
  relative positions for features such as comments. That caveat applies to a
  ProseMirror migration as well as to the current CM6 path.
- The binding's [primary README](https://github.com/yjs/y-prosemirror/blob/master/README.md)
  states that it maps a `Y.XmlFragment` to ProseMirror state. That is a
  different canonical type from CollabMD's `Y.Text` and would require a data
  model/persistence migration.
- Yjs's [Monaco binding notes](https://docs.yjs.dev/ecosystem/editor-bindings/monaco.md)
  show a Y.Text binding but state that the complete editor setup requires a
  build step. It offers no Phase One benefit over CollabMD's installed CM6
  binding.

### ProseMirror Markdown conversion

The official [`prosemirror-markdown` README](https://github.com/ProseMirror/prosemirror-markdown/blob/master/README.md)
describes a CommonMark schema plus a parser and serializer between Markdown
text and a ProseMirror document tree. That is a credible rich-text architecture,
but the documented conversion boundary is exactly what Phase One must avoid:
CollabMD's canonical source is the Markdown `Y.Text`, including source ranges
and comments, not a normalized tree.

## Risks and guardrails

1. **Stale visual ranges after collaboration.** Rebuild visual ranges from the
   current Y relative positions whenever comments or Y.Text change; let CM6 map
   the state field through local/remote transactions. Keep the existing line and
   quote fallback for deleted anchors.
2. **Hidden syntax changes cursor semantics.** Do not hide source delimiters in
   the initial increment. If `Decoration.replace` is later used, provide
   atomic ranges, explicit inclusivity, source-offset metadata, and tests for
   insertion at both boundaries and replacement across line breaks.
3. **Widgets can interfere with IME and touch selection.** Keep controls out of
   text-flow ranges where possible, use `ignoreEvent` only for decorative DOM,
   call `requestMeasure` when a block widget changes height, and run Android and
   iOS composition/selection tests.
4. **Assistive technology can miss visual controls.** Keep the editor's
   `aria-label`; make comment actions real buttons with visible focus and
   keyboard activation; mark purely decorative marks/carets as hidden. Do not
   rely on color-only syntax or comment state.
5. **Large-document cost.** Use `RangeSet`/viewport-scoped decorations and
   incremental Lezer syntax information. Never parse and serialize the whole
   Markdown document on every keystroke.
6. **Dialect drift.** Start visual editing with Markdown only. Keep Mermaid and
   PlantUML in the existing source mode until each dialect has a tested
   source-to-visual mapping.

## Ready-to-post resolution answer

**Recommend extending CodeMirror 6 with native decorations/widgets over the
existing canonical Markdown `Y.Text`; do not migrate to ProseMirror, Monaco, or
a second parsed document in Phase One.** CollabMD already has the CM6
`StateField`/`Decoration`/`WidgetType` hooks, the `y-codemirror.next` binding,
and comment anchors stored as Y relative positions. A visual projection can
therefore preserve exact source offsets, line/text comments, remote edits,
undo/redo, and the current save path without whole-document serialization.
Ship marks/line/gutter decorations and non-text widgets first; defer hidden
syntax (`Decoration.replace`) until cursor, IME, accessibility, and mobile
behavior are proven. Treat Markdown as the only Phase One visual dialect and
leave Mermaid/PlantUML in source mode. Acceptance is two-client insert/delete
tests that keep comment anchors and source ranges exact, plus keyboard,
screen-reader-label, Android, and iOS editor tests.
