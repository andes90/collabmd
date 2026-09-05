# Comment Overview

GitHub issue: https://github.com/andes90/collabmd/issues/12

## Goal

Make open comment threads discoverable across the workspace without introducing unread state, user mentions, or notification delivery.

## Scope

- Add a workspace-wide Comment Overview as a top-level left-sidebar tab next to Files and Git.
- Keep the top-level Comments tab visible regardless of the currently opened file kind.
- Show only open comment threads for current comment-supported Vault paths.
- Do not include resolved threads, including in hidden or secondary sections.
- Group threads by exact Vault path.
- Order file groups by newest open-thread activity.
- Order threads newest-first within each file group.
- Use deterministic tie-breakers after latest activity: Vault path for file groups, then source line and thread id for threads.
- List individual threads inside each file group. Do not aggregate same-anchor threads into per-file drawer-style anchor groups in the workspace overview.
- Show a subtle file-level marker/count in the file tree for files with open threads.
- Do not show a global numeric badge on the top-level Comments tab.
- Keep directory roll-up counts out of the first version.
- Keep search/filter out of the first version.
- Keep pagination and result limits out of the first version.

The exact Vault-relative path is the identity for each overview file group. The UI may display a stripped leaf name and parent path, but grouping must not merge same-name files from different folders or paths that differ only by case.

## Terminology

- An open comment thread is a current unresolved discussion attached to editable vault content.
- The Comment Overview is a discovery surface, not a notification inbox.
- Marker/count text means “this file has open comments,” not “you have unread comments.”
- Do not use unread/read naming in the first-version API or UI. If unread state is introduced later, it should be a separate user-specific design.

## Supported Content

The first version should include only Vault paths that currently support comments:

- Markdown
- Mermaid
- PlantUML

Markdown follows the app's Markdown file-kind classification, including `.md`, `.markdown`, and `.mdx`; this does not imply MDX runtime/component support.

Base files are editable Vault Content but are not comment-supported in this version, so `.base` sidecars should stay out of the overview.

Sidecars for missing files or unsupported file kinds should be omitted from the normal overview.

Overview reads should not clean up stale sidecars. Missing or unsupported sidecars are hidden from the normal overview, while cleanup belongs to file lifecycle operations or an explicit maintenance path.

Malformed or unfocusable threads should also be omitted from the normal overview. A thread needs an id, a valid source anchor, and at least one message to be shown as an overview item.

## Data Source

The server should build the overview from persisted comment-thread Collaboration Sidecars under `.collabmd/comments/**.json`.

Active collaboration rooms should not be the primary source for the overview because a room only represents a currently opened file. Room persistence already writes comment threads after a short debounce, so the overview can be close to live without becoming a push notification system.

The first version should not merge live in-memory room state into the overview. A newly created, replied-to, or resolved thread may appear after sidecar persistence and the next refresh rather than immediately.

The first version should not introduce a separate comment index. The overview is a simple read projection over current workspace state plus persisted sidecars; if performance data later requires indexing, start with a derived cache that treats sidecars as the source of truth.

Comment Overview is not Workspace State. It may use Workspace State to determine current Vault path membership, but the overview itself is a read projection over membership plus Collaboration Sidecars.

## API Shape

Expose a dedicated read endpoint, for example:

`GET /api/comments/overview`

Treat `/api/comments/overview` as the canonical endpoint.

Do not extend `/api/files` with comment summary data, because file-tree reads should remain focused on Vault tree data.
The endpoint should inherit normal workspace API access; do not add a separate authorization model for the first version.

The response should return lightweight summaries, not full conversations:

- `filePath`
- file-level `threadCount` for open thread count
- total open-thread count
- thread id
- anchor kind and start/end line
- anchor quote or excerpt
- created metadata
- latest message author, timestamp, and preview
- per-thread `messageCount`
- latest activity timestamp
- overview generation timestamp

Do not add a separate `fileCount` field in the first version; clients can derive file-group count from `files.length`.

The overview response should not replace per-file comment hydration; full conversation data stays with the existing per-file comment UI path.
Created metadata should remain in the lightweight summary as durable thread context and fallback display data, while the overview renders latest-message author context by default.
The generation timestamp is API/debug metadata and should not be shown prominently in the first-version UI.
The API should return raw summary fields. Client-side overview presentation owns line labels, localized timestamps, and display names.
Overview rows should show both latest-message preview and source anchor quote when available. The latest message gives discussion recency; the quote gives source context.
Overview previews should use a Markdown-preserving server-side cap of 140 characters, and the client should render them with the shared safe comment Markdown renderer using compact overview-specific spacing. Do not hydrate the full conversation for workspace-wide overview previews.

Latest activity means newest message `createdAt`, falling back to thread `createdAt`. Reactions should not affect ordering or trigger an overview refresh in the first version.
Do not include reaction summaries in the overview response or UI; reactions remain per-file thread detail.

## Interaction

Clicking a thread in the Comment Overview should:

1. Open the thread's file.
2. Keep the left sidebar on the Comments tab.
3. Wait for the file collaboration session and per-file comments to hydrate.
4. Focus the selected thread in the existing per-file comment UI.
5. Scroll or highlight the anchored location where possible.

Thread focus is the primary completion condition. Source scrolling or highlight is best-effort because anchors and line positions may be stale.

If a selected thread cannot be focused after hydration retries, keep the user on the Comments tab without showing a toast. The next successful overview refresh should remove stale rows that no longer qualify.

Thread focus should stay out of the route in the first version. The URL may point to the file and line, but the selected thread card is ephemeral sidebar state rather than a shareable comment-thread permalink.

The Comments sidebar tab should be preserved only for the one file route opened by an overview selection. Normal file navigation should continue to reset the sidebar to Files.

Resolving a thread should remove it from the Comment Overview and decrement any file marker/count after the next overview refresh.

## Refresh Strategy

Fetch the overview:

- on app load,
- when opening the Comments sidebar tab,
- after local per-file comment create/reply/resolve activity,
- after workspace reconciliation or file-tree refresh when the Comments sidebar tab is active.

Workspace tree changes that happen while another sidebar tab is active should mark the overview stale and refresh next time the Comments tab opens, rather than fetching immediately.

Do not add WebSocket push, unread tracking, mentions, assignment, or personal notifications in the first version.

Overview loading failures should degrade locally. A failed overview read may show an error in the Comments panel and a toast, but it should not block file navigation, editor access, or the file tree.

Failed overview refreshes should preserve the last known file-tree markers and counts. Do not clear counts unless a successful overview response says there are no open threads for that file.

After a failed refresh, the Comments panel should show the local error state rather than rendering stale overview rows. Last-known data may remain only as file-tree markers until the next successful refresh.

File-tree comment markers should be driven only by successful overview responses. Per-file comment actions may schedule a refresh, but should not mutate overview counts optimistically.
Client plumbing for file-tree markers should use thread-count naming, even if the visible UI says open comments.
Comment Overview styling should stay inside the comments feature stylesheet bundle, separated into its own CSS file but imported through the existing comments styles entrypoint.

## Empty State

The overview empty state should say there are no open comments. Comment creation remains anchored to editor selection or preview comment bubbles.
Do not offer global comment creation from the overview empty state.
