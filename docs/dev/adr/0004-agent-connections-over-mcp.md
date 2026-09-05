# 0004: Agent Connections over MCP

Status: Accepted

## Context

CollabMD must let remote Pi, Codex, and compatible agents search, read, edit, and create Vault Content without bypassing live collaboration, Workspace Reconciliation, or existing authentication modes. WebMCP is browser-scoped. Direct filesystem or Yjs access cannot provide one safe hosted contract.

Google OIDC creates a browser session, not an MCP-audience OAuth access token. Password mode also has no individual identity suitable for OAuth enrollment. No-auth workspaces intentionally grant anonymous browser write access.

## Decision

Expose scope-filtered MCP Streamable HTTP at `/mcp` over one Agent Content application service. Use revision-guarded exact text edits, live-room reads and edits, and Workspace Reconciliation for closed files and creation.

Match MCP authentication to workspace authentication:

- OIDC: Collaborator-managed Agent Connections with individual attribution.
- Password: managed workspace-level Agent Connections.
- None: anonymous MCP access; anyone who can reach the endpoint receives read and edit tools.

Store managed token hashes in separate Agent Access SQLite metadata. Initial scopes are `vault:read` and `vault:edit`. Do not expose delete, rename, attachments, Git, or publish. Do not expose Yjs or CollabMD WebSocket transport directly.

## Consequences

Pi, Codex, generic MCP, and WebMCP share content and syntax rules. Stale edits fail instead of overwriting collaborator text. Password actions cannot claim individual attribution. No-auth deployments expose anonymous automated Vault writes in addition to anonymous browser writes. Full MCP OAuth login requires a dedicated authorization server later; CollabMD does not implement one.
