# Obsidian Canvas interaction reference

Initial review: 2026-09-11, using official documentation and demos. Desktop
follow-up: 2026-09-13, inspecting Obsidian 1.13.7 with Computer. The desktop
inspection confirmed the bottom creation dock, right navigation rail, external
file/group labels, selection color palette, and searchable heading picker with
a whole-file option. Picker browsing was cancelled without editing the Vault.
The comparison below describes CollabMD's initial UI.

## Verified reference

- **Create:** double-click empty canvas for text; toolbar/context-menu pickers
  add Vault notes/media; sidebar files can be dragged in.
- **Edit:** double-click text/note cards; Escape or clicking outside exits.
- **Connect:** drag an edge handle onto another card, or blank space to create
  a card; double-click connections to label them.
- **Select/arrange:** marquee, Shift-click, select all, Alt/Option-drag
  duplication, snapping, and groups around selected cards.
- **Context:** color/delete controls appear above the selection.
- **Navigate:** Space-drag or middle-drag pans; wheel pans vertically,
  Shift-wheel horizontally; Space/Ctrl/Cmd-wheel zooms; Shift+1 fits all and
  Shift+2 fits the selection.

Source: [official Canvas help](https://obsidian.md/help/plugins/canvas).

The [official tips](https://obsidian.md/canvas#protips) link a six-second
[heading demo](https://obsidian.md/videos/22-modify-narrow.mp4). It shows a
selected note with a floating toolbar, then right-click → **Narrow to section…**
→ a searchable **Type name of heading** dialog → heading selection. The card
then displays that section; its outer label changes from `Canvas` to
`Canvas > Add text cards`. The menu, picker, and result are visible around
1.35s, 3.8s, and 5.6s respectively. Duplicate-heading, block, and no-heading
behavior are not established by this demo.

## CollabMD comparison

The initial [editor view](../../src/client/presentation/canvas-editor-view.js)
has permanent add/connect/delete controls and a
[210px inspector](../../src/client/styles/surfaces/canvas-editor.css), including
when nothing is selected. File and heading suggestions use native datalists.
Text cards edit inline; linked notes open in the workspace. Dragging uses the
card header, resizing one corner, and connections use toolbar selection.
Background dragging pans; selection supports Shift-click but lacks marquee,
select-all, and fit-selection. Groups start as empty rectangles.

## Recommended first pass

1. Give the canvas more room: show selection actions near cards, make the
   inspector collapsible or selection-only, and display the referenced filename
   with a compact heading label.
2. Reuse the [quick-switcher search and UI patterns](../../src/client/presentation/quick-switcher-controller.js)
   for searchable Vault files and explicit headings from the chosen file,
   including a whole-file choice. Its controller binds global IDs and is not a
   drop-in picker. Preserve typed references when the target is unavailable.
3. Add double-click creation at the pointer, edge-handle connections, marquee
   selection with Space/middle-button panning, and fit-selection shortcuts.
4. Follow with duplication, snapping, and grouping selected cards. Defer inline
   linked-note editing until its separate synchronized document session is
   designed and verified.

Retain standard JSON Canvas files and collaboration only between CollabMD
clients, as established in the [implementation scope](json-canvas-feasibility.md).
Selection, navigation, and picker browsing must preserve Vault Content bytes;
only an intentional content change saves. Although
[Help](https://obsidian.md/help/plugins/canvas) describes bringing selected cards
forward, persist ordering changes only through intentional Arrange actions.
Keep camera state local and presence in Awareness. Verify these interactions
with keyboard access and two collaborators using disposable fixtures.

## Implemented first pass

CollabMD now has the contextual toolbar, optional Properties inspector, file and
heading search dialogs, whole-file choice, and readable reference labels above.
It supports background double-click creation, sidebar file drops, handle-drawn
connections and labels, marquee/select-all, touch and Space/middle-drag panning,
and fit-selection. These controls reuse the existing Canvas collaboration actions
and Markdown renderer. Duplication, snapping, grouping a selection, and inline
linked-note editing remain outside this pass.

The visual follow-up uses a floating creation dock and navigation rail, compact
selection actions, external labels, subtle card borders, and a grid that follows
the local camera. Cards drag from their noninteractive content; a group's label,
frame, or empty background moves its enclosed cards. Shift-drag selects inside
a group, and Space/middle-drag pans. Properties opens as an optional pane beside the
canvas. **Choose section** stays visible on Markdown file selections,
and advanced reference, geometry, color, and connection fields remain available.
Existing card types and injected actions remain the extension points; this
redesign introduces no new dependency or persisted data format.
