# Connect an AI agent

> Operator docs. Start with the [README](../README.md) for the product overview.

Enable MCP Streamable HTTP access:

```bash
COLLABMD_AGENT_ACCESS_ENABLED=true collabmd --no-tunnel
```

CollabMD exposes `/mcp`, or `<BASE_PATH>/mcp` when a base path is configured, with these tools:

- `list_workspace_entries` with optional path-prefix, path-query, and content-kind filters, `search_vault` with optional path-prefix, content-kind, whole-word, and per-file snippet filters, and `read_document`
- `inspect_document_references` for resolved and missing wiki-links, embeds, public video embeds, and backlinks
- `validate_document` for missing Markdown references and unsupported public video embeds
- `query_base` to run a Base filter and inspect matching rows
- `render_diagram` for standalone or fenced PlantUML through remote MCP and Mermaid or PlantUML through WebMCP
- `apply_text_edits` with exact replacements and revision conflict protection
- `create_document`
- `create_excalidraw` and `edit_excalidraw` for canonical element creation, updates, relationship-aware translation, standalone text auto-resizing, same-ID replacement, explicit paint-order changes, deletion, and optional same-revision verification
- `inspect_excalidraw` for paint order, bounds, bindings, text layout properties, distant bound endpoints, connector/component intersections, unintended overlaps, occlusion, clipping, and validity warnings
- `verify_excalidraw` to inspect and render one exact revision with compact inspection; use `inspect_excalidraw` for per-element summaries
- `get_collabmd_syntax`

`search_vault` uses the server's ripgrep installation. Install `rg` on source or npm deployments; the Docker image already includes it.

Agent text writes support Markdown, HTML, Base, Mermaid, PlantUML, and Structurizr. Excalidraw writes use the dedicated element tools. draw.io, PDF, images, delete, rename, Git, and publish are not writable through Agent Access.

Remote MCP renders PlantUML through the configured PlantUML service; Mermaid rendering requires WebMCP because Mermaid needs a browser layout engine. Remote MCP Excalidraw rendering uses the basic element types supported by the agent tools. The `collabmd-basic-svg` renderer is intended for layout verification rather than pixel-identical Excalidraw reproduction and returns `preview-not-pixel-identical`. WebMCP replaces these previews with Excalidraw's official browser renderer.

Before the first Excalidraw creation or edit in a task, call
`get_collabmd_syntax` with `kind: "excalidraw"` (WebMCP:
`collabmd_get_collabmd_syntax`). The on-demand guide covers purpose, layout,
spacing, readable labels, bindings, visual hierarchy, and preserving existing
diagrams. It includes runnable flowchart and layered-architecture examples.
The general capabilities listing stays compact. Reuse the guide during the
task, request inline rendering, and inspect the image as well as the structural
diagnostics before claiming the diagram is visually verified.

With password or OIDC auth, open **More actions → Connect AI Agent** after signing in. Create a named connection, choose read/edit scope, and copy the token shown once. Tokens expire after 30 days by default and can be revoked from the same dialog. OIDC connections retain Collaborator attribution; shared-password connections are workspace-level because password sessions have no individual identity.

When enabling hosted workspace mode on an existing deployment, create new Agent Connections after joining the team. Tokens issued before hosted mode was enabled are rejected; new connections are bound to an active Team Membership.

Use these connection details with any Streamable HTTP MCP client:

```text
URL: https://notes.example.com/mcp
Transport: Streamable HTTP
Authorization: Bearer <token>
```

For protected workspaces, configure the generated token as a bearer credential in the MCP client. For `AUTH_STRATEGY=none`, omit the bearer token; MCP uses the same anonymous access policy as the web app, so anyone who can reach `/mcp` can read, edit, and create supported Vault Content.

CollabMD uses preconfigured bearer credentials rather than MCP OAuth enrollment.

The `Authorization` header is required for password and OIDC workspaces. Omit it for `AUTH_STRATEGY=none`.

Remote endpoints should use HTTPS. `COLLABMD_AGENT_ALLOWED_HOSTS` adds comma-separated MCP hostnames accepted for password/OIDC requests and browser-origin requests. OIDC automatically allows the hostname from `PUBLIC_BASE_URL`; localhost is always allowed. Native no-auth MCP clients normally omit `Origin` and remain anonymous; browser-origin MCP requests must use an allowed hostname to prevent DNS rebinding.

Vault text returned to an agent is untrusted input. Never paste managed Agent Access tokens into agent prompts or chat history. Treat every no-auth workspace URL as anonymous automated write access to the Vault.

## Retrieve and edit efficiently

Use `list_workspace_entries` with `pathQuery` when you know part of a filename.
Otherwise, `search_vault` accepts a literal case-insensitive phrase, not a
natural-language question. It defaults to 10 matching documents and 2 snippets
per document; explicit limits allow up to 50 documents and 10 snippets. Use
`prefix`, `kinds`, or a more distinctive phrase to narrow results. `truncated`
means documents/snippets were omitted or the search was incomplete, including
live documents still synchronizing. Match counts are observed counts, not
necessarily totals for the whole Vault. Live documents override disk evidence,
including when a collaborator removes the matching text.

`read_document` defaults to 80 complete lines. Follow `nextStartLine` until it is
`null`, retaining the revision with your citations. If the revision changes
between reads, reread the passages that your answer or edit depends on. Reads
allow up to 500 lines and 100,000 characters per response, from a source no
larger than 1,000,000 characters. A single line exceeding the response limit
returns `AGENT_DOCUMENT_LINE_TOO_LARGE` rather than partial text.

For a long Markdown document, call `read_document` with `mode: "outline"` first.
It returns headings instead of content, with level, source line, and the same
full-document revision. `lineCount` limits headings in this mode; follow
`nextStartLine` for another page. The outline supports top-level ATX (`#`) and
single-line Setext headings, skipping fenced code and YAML frontmatter. Heading
labels are capped at 200 characters and individually marked when truncated.
Read the relevant content ranges before making exact edits.

`create_document` and `apply_text_edits` accept `validate: true` for Markdown.
The optional `validation` result contains `valid` and reference `issues` for the
saved text identified by the returned revision; it does not reread a potentially
newer document. Issues are advisory and do not roll back the save. Validation
covers the same missing wiki-links, embeds, and unsupported public video embeds
as `validate_document`, not general writing quality or all Markdown syntax.

For edits, batch up to 20 unique, non-overlapping replacements against a fresh
read revision. Combined old/new replacement text is limited to 50,000
characters. On `AGENT_REVISION_CONFLICT`, reread and recompute the edit. For an
ambiguous match, include enough surrounding text to identify one occurrence.
An identical creation retry succeeds; different content at an existing path
fails. These tools do not publish or commit changes.

## Browser context

WebMCP additionally exposes `collabmd_get_active_context`. It returns the active
file kind and, for an initialized text editor, the primary selection with up to
2,000 characters, one-based line numbers, and zero-based UTF-16 offsets. A
collapsed selection describes the caret. `localRevision` identifies the local
editor snapshot; it does not acknowledge synchronization to the server. Compare
it with a fresh `read_document` revision and reconsider the selection if they
differ. During initial sync, or for documents over 1,000,000 characters, text
selection context is unavailable. Existing active-diagram context remains
available for Excalidraw.

Browser tool availability depends on WebMCP support in the client. Browser
read-only, untrusted-content, and consequential hints supplement server
authorization and revision checks; they do not replace them.
