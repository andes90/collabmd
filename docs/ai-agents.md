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

With password or OIDC auth, open **More actions → Connect AI Agent** after signing in. Create a named connection, choose read/edit scope, and copy the token shown once. Tokens expire after 30 days by default and can be revoked from the same dialog. OIDC connections retain Collaborator attribution; shared-password connections are workspace-level because password sessions have no individual identity.

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

