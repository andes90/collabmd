# JSON Canvas and realtime collaboration feasibility

Research and implementation date: 2026-09-11. This note records the original
feasibility assessment and the resulting implementation; it is not an ADR.
External findings below use primary sources.

## Implemented support

CollabMD now opens and creates standard `.canvas` files with all four node
types, connections, geometry, stacking, colors, labels, and file references.
The editor uses native HTML cards and SVG connections, with the installed
CodeMirror and Yjs packages. No dependency or lockfile change is needed.

The [shared codec](../../src/domain/canvas-room-codec.js) uses ID-keyed nested
Yjs maps, `Y.Text` for each text card, and separate fractional order keys with
deterministic ID tie-breaking. Saved files contain standard JSON Canvas data,
including unknown properties, without CRDT fields. Opening and presence changes
preserve original bytes; intentional saves use formatted JSON and LF newlines.

The [browser client](../../src/client/infrastructure/canvas-room-client.js)
reuses authorized WebSocket rooms and transient Awareness for pointers and
selection. Editing pauses until synchronized and while offline. Navigation
waits for a flush acknowledgment issued after durable persistence. Undo tracks
local edits. Concurrent property edits converge through Yjs; edges whose
endpoints were deleted are omitted. Group movement follows geometric containment.

The [server room](../../src/server/domain/collaboration/collaboration-room.js)
hydrates from files, validates snapshots against disk, preserves invalid files,
and observes filesystem/Git changes. Independent external changes merge at the
property level; overlapping changes pause content saves and preserve the local
snapshot until the user chooses a version. File deletion stops persistence.

File cards preview Markdown and images and open their targets in the existing
workspace. Markdown heading references preview the selected section and its
subsections; file and heading pickers are scoped to the current Vault and
selected file respectively, with manual reference inputs in Properties. Missing
headings show a message, and block previews are not supported. References and
all standard optional values are retained even where
the UI cannot preview a target. Live web embeds, inline canvas embeds, canvas
search/backlinks, node comments, agent writes, exports, and editing a linked note
inside a card are outside this implementation. Collaboration is only within
CollabMD; interoperability is defined by the file specification.

Regression coverage lives in `tests/node/canvas-room-codec.test.js`,
`tests/node/canvas-collaboration.test.js`, the host/navigation tests, and
`tests/e2e/canvas.spec.js`. Run `npm run check` and
`npm run test:e2e -- tests/e2e/canvas.spec.js` for the integrated checks.

## Original assessment (before implementation)

**Recommendation: proceed with a native `.canvas` editor using CollabMD's
existing Yjs/WebSocket infrastructure.** The architecture fits simultaneous
browser editing without another backend or database. This is a medium-sized
editor feature: the missing work is the canvas UI, format binding, and reliable
save/reconnect/conflict behavior. Adding an extension alone would not provide it.

Confirmed scope: `.canvas` files remain plain JSON conforming to JSON Canvas
1.0, and realtime collaboration happens entirely between CollabMD clients.
The file contains the canvas content; Yjs history and internal collaboration
metadata stay in sidecars, while cursors and presence stay transient. A standard
canvas file must remain readable and sufficient to initialize a fresh room
without those sidecars. Compatibility is measured against the specification.

## External findings

**Feasible in principle:** JSON Canvas supplies an interoperable storage format;
a browser editor and its collaborative binding must be supplied separately.
The linked `obsidianmd/jsoncanvas` repository contains the specification,
documentation/site, assets, and a sample `.canvas` file. It does not supply an
embeddable editor or a collaboration protocol. The project describes
the format as freely implementable for storage, import, and export, and licenses
its resources under MIT. Sources: [repository](https://github.com/obsidianmd/jsoncanvas),
[sample](https://raw.githubusercontent.com/obsidianmd/jsoncanvas/main/sample.canvas).

### Format coverage and compatibility

The published specification is version 1.0, dated 2024-03-11. A `.canvas` document
contains optional `nodes` and `edges` arrays. Nodes have IDs, integer positions
and dimensions, and optional colors; array order determines their stacking.
The four node types are:

| Type | Additional content |
| --- | --- |
| Text | Markdown text |
| File | File path, optionally a heading/block subpath |
| Link | URL |
| Group | Optional label, background image, and background style |

Edges reference node IDs, with optional attachment sides, endpoint markers,
color, and label. Colors accept hex strings or six preset identifiers; the exact
preset shades are application-specific. Groups are visual containers; the
format does not define a parent/child relationship. Source:
[JSON Canvas 1.0 specification](https://jsoncanvas.org/spec/1.0/).

Implementation implications: preserve IDs, order, file references, and
optional values. Retain unrecognized properties defensively; the spec gives no
complete extension policy. Preserve imported bytes until an intentional edit,
then test exported semantics separately from byte fidelity on opening.

### Yjs supplies the required collaboration primitives

The following is a proposed mapping, not a tested CollabMD implementation:

| Canvas concern | Existing Yjs primitive and implication |
| --- | --- |
| Nodes and edges | Maps keyed by stable IDs; nested `Y.Map` values allow independent properties to be changed without replacing the entire record. [Y.Map](https://docs.yjs.dev/api/shared-types/y.map) |
| Concurrent card typing | A `Y.Text` for each text card supports character-level operations instead of replacing the whole string. [Y.Text](https://docs.yjs.dev/api/shared-types/y.text) |
| Stacking order | An ordered list of node IDs can use `Y.Array`; concurrent reordering still needs a defined policy and a focused test. [Y.Array](https://docs.yjs.dev/api/shared-types/y.array) |
| Cursors and selections | Awareness carries per-client JSON state separately from content; this suits transient presence. [Awareness](https://docs.yjs.dev/api/about-awareness) |
| Undo | `Y.UndoManager` supports shared-type scopes, tracked transaction origins, and capture boundaries; configure it to undo the current user's actions. [UndoManager](https://docs.yjs.dev/api/undo-manager) |

Yjs does not observe in-place mutation of ordinary JSON objects stored in shared
types. Integrated shared types also cannot be moved and reinserted elsewhere.
The binding must emit Yjs operations, and should keep node identity separate
from stacking order. These are explicit Yjs caveats, not reasons to invent a
second sync engine. Source:
[working with shared types](https://docs.yjs.dev/getting-started/working-with-shared-types).

CRDT convergence still leaves application behavior to define: two users moving
the same node, deleting a node while an edge is created, group movement,
concurrent reordering, undo after a remote edit, and external whole-file
replacement. Use small two-client checks to establish these semantics before
promising reliable collaboration.

### One plausible editor component

React Flow (`@xyflow/react`) is a plausible node/edge editor foundation. Its
documented API takes nodes, edges, and change handlers; JSON Canvas would need
an adapter and custom card rendering. The core is MIT-licensed. This is an
implementation candidate, not a recommendation to install it before checking
CollabMD's existing UI stack. Sources: [quick start](https://reactflow.dev/learn),
[core license](https://github.com/xyflow/xyflow/blob/main/LICENSE).

Its official collaborative example uses React Flow, Yjs, and `y-websocket` and
demonstrates a shared graph. It is explicitly a starting example, not a JSON
Canvas implementation. Downloadable source is a **Pro example under the xyflow
Pro License**, separate from the MIT core. Pro access is paid; this is optional
reference code, not a required subscription for building our own Yjs binding. Sources:
[collaborative example](https://reactflow.dev/examples/interaction/collaborative),
[Pro pricing](https://reactflow.dev/pro).

React Flow's own multiplayer guidance distinguishes durable nodes/edges from
transient cursors/viewports and calls out disconnects and concurrent changes.
That supports keeping canvas content in shared document state and presence in
Awareness. The example alone does not verify CollabMD authorization, persistence,
reconnection behavior, Markdown rendering, or `.canvas` round trips. Source:
[multiplayer guidance](https://reactflow.dev/learn/advanced-use/multiplayer).

## CollabMD integration assessment

Observable outcome: two collaborators open the same `.canvas` file in CollabMD,
edit cards and connections together, see each other's presence, and reopen a
valid file after saving or reconnecting. An open-only session preserves the
original file bytes. Every saved file conforms to the JSON Canvas specification
and can initialize a fresh CollabMD room without collaboration sidecars.

### Existing support and required changes

| Boundary | Evidence in this checkout | Required work |
| --- | --- | --- |
| Vault recognition | [File kinds](../../src/domain/file-kind.js) omit `.canvas`; [path validation](../../src/server/infrastructure/persistence/path-utils.js) and the [workspace tree](../../src/server/domain/workspace-state.js) use that classification. | Register the extension and editable kind; update accepted-path messages, capabilities, creation, and icons. |
| Browser integration | [WorkspaceCoordinator](../../src/client/application/workspace-coordinator.js) routes diagram files to dedicated previews. [Vite](../../vite.config.mjs) already builds separate diagram editor pages; [Excalidraw's entry](../../src/client/excalidraw-editor.js) uses React. | Add a lazy canvas editor and wire opening, teardown, identity, theme, and connection state through the existing composition. React and React DOM are installed; React Flow is not. [Dependencies](../../package.json). |
| Collaborative state | [Excalidraw's codec](../../src/domain/excalidraw-room-codec.js) already stores structured maps in Yjs. [CollaborationRoom](../../src/server/domain/collaboration/collaboration-room.js) broadcasts document updates and Awareness. | Add a canvas-specific parser/serializer and shared state binding. Extend room hydration, snapshot validation, dirty listeners, serialization, and external reconciliation. These currently distinguish Excalidraw from the text fallback. |
| Durable saves | [CollaborationDocumentStore](../../src/server/domain/collaboration/collaboration-document-store.js) delegates content/snapshot persistence. [VaultFileStore](../../src/server/infrastructure/persistence/vault-file-store.js) maintains a separate editable-kind allowlist and stages writes; [SidecarStore](../../src/server/infrastructure/persistence/sidecar-store.js) stores Yjs snapshots under `.collabmd/yjs`. | Enable the new editable kind and JSON MIME type; reuse existing persistence and sidecar lifecycle. Keep CRDT metadata out of `.canvas` files. |
| Access and room lifecycle | The [WebSocket gateway](../../src/server/infrastructure/websocket/attach-collaboration-gateway.js) authorizes upgrades and handles hosted access revocation. [RoomRegistry](../../src/server/domain/collaboration/room-registry.js) handles room rename/delete/reload. | Use the existing authorized room route. Extend format-specific reconciliation failures; keep current single-instance deployment. [ADR 0001](adr/0001-single-tenant-hosted-workspaces.md). |
| Vault references | [Preview compilation](../../src/client/application/preview-render-compiler.js) explicitly recognizes supported embed extensions. [BacklinkIndex](../../src/server/domain/backlink-index.js) extracts outgoing references from Markdown. | Resolve canvas file cards through existing authorized Vault APIs. Canvas embeds and outgoing canvas backlinks require explicit additions; file-kind registration does not implement them. |

The important server trap is `getPersistedContent()`: every ordinary room other
than Excalidraw currently serializes `doc.getText('codemirror')`. Adding canvas
maps only on the client could broadcast edits while failing to persist their
content correctly. Canvas handling must cover the complete room lifecycle.
Source: [CollaborationRoom](../../src/server/domain/collaboration/collaboration-room.js).

### Smallest implementation that meets the intent

1. **Prove one complete collaborative flow first.** Register `.canvas`, load
   text cards and connectors, edit from two browsers, persist, disconnect, and
   reopen. Include concurrent typing in one card. This is a development slice,
   not the final compatibility claim.
2. **Complete the core format.** Support all four node types, geometry, stacking,
   colors, connections, labels, and the defined optional fields. File cards can
   preview supported Vault content and open the existing editor for note edits;
   retain unsupported targets with a clear placeholder. Start link cards as
   links; arbitrary live web embeds and editing linked notes inside cards are
   separate UI features.
3. **Finish collaboration reliability.** Ship presence/cursors, selections,
   local undo, initial sync authority, reconnect handling, and external-change
   conflict behavior together with the editor. Reuse the connection-state
   approach in [ExcalidrawRoomClient](../../src/client/infrastructure/excalidraw-room-client.js),
   which distinguishes synchronized editing from read-only fallback/reconnect.

Use ID-keyed maps and change only the properties affected by an interaction.
Keep each card's text in `Y.Text`, and use Awareness for pointers/selections;
viewport movement must not save content. Avoid replacing an entire JSON string,
array, or node record for every drag or keystroke. The Excalidraw codec's revision
and tombstone rules depend on Excalidraw fields, so reuse its integration pattern
without copying its format-specific conflict algorithm.

Keep ordering separate from object identity. The installed
`@excalidraw/fractional-indexing` dependency is already used by
[scene ordering](../../src/domain/excalidraw-agent-scene.js) and is a candidate
for compact order keys; if used, tie-break equal keys deterministically and test
concurrent reorder. An ID array is another option but requires handling duplicate
IDs caused by concurrent delete/insert moves. Neither option has been prototyped
for canvas here.

React Flow is the strongest candidate from this limited investigation: the
project already bundles React, and a complete node/edge interaction surface is
more than a few native DOM helpers. It still needs custom cards, format conversion,
and our Yjs binding. Adapting everything into Excalidraw would also require
conversion of file cards, links, groups, edges, and metadata; it is not an obvious
shortcut to faithful `.canvas` editing. No dependency has been added or selected
as an accepted architectural decision.

### Behaviors that must be settled before release

- **File fidelity:** preserve IDs, unknown properties, stacking, and reference
  strings through edits; avoid default insertion or reformatting on open. Invalid
  JSON or unsupported structure must not become an empty autosaved canvas.
  Serialize only canvas content into `.canvas`; keep internal order keys,
  tombstones, undo history, and collaboration metadata outside the standard file.
- **Conflicting edits:** define what happens when users drag the same node,
  delete a node while another connects it, reorder together, or undo after a
  remote edit. Yjs convergence alone does not specify the desired visible result.
- **External writes:** [Workspace Reconciliation](../../src/server/application/workspace-reconciliation.js)
  already handles filesystem/Git observations, and rooms reload affected content.
  A clean canvas can adopt that observation without a save. If local edits are
  pending, detect the conflict and preserve them until resolved or implement a
  tested merge; do not assume Excalidraw's full-scene replacement preserves them.
- **Rendering and references:** validate untrusted JSON, IDs, geometry, reference
  paths, and URLs; render Markdown with existing safe conventions. File targets
  stay within authorized Vault access. Unsupported media and inaccessible links
  should remain represented without enabling arbitrary server-side URL fetching.
- **Editing boundaries:** a file card references another document. Editing that
  note belongs to its own room and file, not the canvas text state. Inline embeds,
  canvas backlinks, node comments, exports, and advanced media can follow the
  core editor; do not claim they arrive automatically.

## Verification and confidence

On Node.js 26.7.0, the existing focused checks passed **48/48**:

```sh
node --test --test-force-exit tests/node/file-kind.test.js tests/node/excalidraw-room-codec.test.js tests/node/collaboration-room.test.js tests/node/collaboration-document-store.test.js tests/node/room-registry.test.js
```

They exercise the current structured-scene merge, hydration, content baselines,
sidecar persistence, overlapping saves, and room lifecycle. The initial invocation
omitted the repository's `--test-force-exit` flag and remained alive after test
output; it was stopped and rerun with that existing runner setting.

These were baseline checks at the research stage. They did not exercise the
new Canvas editor; current implementation coverage is listed above.

Implementation should add focused codec and room tests plus two-browser E2E
coverage for simultaneous different-node edits, same-card typing, deletion,
ordering, undo, reconnect, and persisted convergence. Include a byte comparison
after open/presence-only sessions, invalid input preservation, external writes
during pending edits, and parse/save/reparse checks against JSON Canvas 1.0
using representative standard files. Verify reconstruction without sidecars,
preservation of supported fields and unknown properties, and exclusion of
CollabMD's internal collaboration metadata from saved files.
Use the [contributor check matrix](development.md#verification), including
`npm run check` and the relevant new E2E flow for the cross-layer implementation.

Confidence is high in architectural feasibility. The remaining uncertainty is
editor interaction quality, exact conflict semantics, and interoperability on
standard canvas files. A focused first slice should resolve those before
estimating the complete editor implementation.
