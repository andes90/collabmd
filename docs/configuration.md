# Usage

> Operator docs. Start with the [README](../README.md) for the product overview.

```bash
collabmd [directory] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `directory` | Path to the vault directory (default: current directory) |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Port to listen on | `1234` |
| `--host` | Host to bind to | `127.0.0.1` |
| `--auth` | Auth strategy: `none`, `password`, `oidc` | `none` |
| `--auth-password` | Password for `--auth password` | generated per run |
| `--local-plantuml` | Start the bundled local docker-compose PlantUML service | off |
| `--local-structurizr` | Start the bundled local Structurizr renderer | off |
| `--no-tunnel` | Don't start Cloudflare Tunnel | tunnel on |
| `-v, --version` | Show version | |
| `-h, --help` | Show help | |

### Examples

```bash
# Serve the current directory locally
collabmd --no-tunnel

# Serve a specific vault locally
collabmd ~/my-vault --no-tunnel

# Use a custom port, no tunnel
collabmd --port 3000 --no-tunnel

# Share with collaborators using a generated password
collabmd --auth password

# Require an explicit password
collabmd --auth password --auth-password "shared-secret"

# Use Google OIDC on a stable public domain
PUBLIC_BASE_URL=https://notes.example.com \
AUTH_OIDC_CLIENT_ID=your-google-client-id \
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret \
collabmd --auth oidc --no-tunnel

# Use the local docker-compose PlantUML service
collabmd --local-plantuml

# Use the local Structurizr renderer for .dsl workspaces
collabmd --local-structurizr

# Serve an Obsidian vault
collabmd ~/Documents/Obsidian/MyVault
```


<details>
<summary>Environment variables</summary>

| Variable | Description | Default |
|----------|-------------|---------|
| `HOST` | Bind host | `127.0.0.1` (dev), `0.0.0.0` (prod) |
| `PORT` | HTTP + WebSocket port | `1234` |
| `AUTH_STRATEGY` | Auth strategy: `none`, `password`, `oidc` | `none` |
| `AUTH_PASSWORD` | Shared password for `AUTH_STRATEGY=password` | generated per run |
| `AUTH_SESSION_COOKIE_NAME` | Session cookie name | `collabmd_auth` |
| `AUTH_SESSION_SECRET` | Cookie signing secret | generated per run |
| `AUTH_SESSION_MAX_AGE_MS` | Optional auth session lifetime in milliseconds; when set, cookies persist until that expiry | |
| `PUBLIC_BASE_URL` | Stable public app origin required for `AUTH_STRATEGY=oidc` | |
| `AUTH_OIDC_CLIENT_ID` | Google OAuth client ID used for `AUTH_STRATEGY=oidc` | |
| `AUTH_OIDC_CLIENT_SECRET` | Google OAuth client secret used for `AUTH_STRATEGY=oidc` | |
| `AUTH_OIDC_ALLOWED_EMAILS` | Comma-separated exact email allowlist for `AUTH_STRATEGY=oidc` | |
| `AUTH_OIDC_ALLOWED_DOMAINS` | Comma-separated email domain allowlist for `AUTH_STRATEGY=oidc` | |
| `COLLABMD_AGENT_ACCESS_ENABLED` | Enable scoped MCP Agent Access | `false` |
| `COLLABMD_AGENT_ALLOWED_HOSTS` | Extra comma-separated MCP hostnames accepted for password/OIDC and browser-origin requests | |
| `COLLABMD_AGENT_REQUESTS_PER_MINUTE` | Maximum MCP tool calls per managed connection or anonymous client address each minute | `120` |
| `COLLABMD_AGENT_CONNECTION_TTL_MS` | Managed Agent Connection lifetime in milliseconds | `2592000000` |
| `COLLABMD_AGENT_METADATA_DB_PATH` | SQLite path for managed Agent Connections | `<vault>/.collabmd/agent-access.sqlite` |
| `BASE_PATH` | URL path prefix for subpath deployments | |
| `COLLABMD_HOSTED_ENABLED` | Enable single-tenant hosted workspace mode; requires `AUTH_STRATEGY=oidc` | `false` |
| `COLLABMD_HOSTED_METADATA_DB_PATH` | SQLite database path for hosted workspace metadata | `<vault>/.collabmd/hosted.sqlite` |
| `COLLABMD_HOSTED_CLAIM_EMAIL` | Verified Google email allowed to claim the first Team Admin role | |
| `COLLABMD_HOSTED_CLAIM_TOKEN` | One-time token required for the first workspace claim | |
| `COLLABMD_GITHUB_APP_ID` | GitHub App ID used for hosted vault-source setup | |
| `COLLABMD_GITHUB_APP_SLUG` | GitHub App slug used to build the installation setup URL | |
| `COLLABMD_GITHUB_APP_PRIVATE_KEY` | GitHub App private key; `\n` escapes are converted to newlines | |
| `COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE` | File path for the GitHub App private key; used when direct key input is not set | |
| `COLLABMD_GITHUB_API_BASE_URL` | GitHub API base URL for hosted vault-source setup | `https://api.github.com` |
| `COLLABMD_GITHUB_HTML_BASE_URL` | GitHub web base URL for installation setup | `https://github.com` |
| `COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME` | Signed cookie name for the GitHub App setup callback flow | `collabmd_github_setup_flow` |
| `PLANTUML_SERVER_URL` | Upstream PlantUML server base URL used for server-side SVG rendering | `https://www.plantuml.com/plantuml` |
| `STRUCTURIZR_SERVER_URL` | Structurizr Local-compatible sidecar base URL used for `.dsl` previews | disabled |
| `COLLABMD_STRUCTURIZR_MIRROR_DIR` | Writable disposable mirror directory passed to Structurizr | `<vault>/.collabmd/structurizr` |
| `COLLABMD_STRUCTURIZR_TRUSTED_EXECUTABLE_DSL` | Allow Structurizr `!script` and `!plugin` directives; keep false for untrusted vaults | `false` |
| `COLLABMD_DRAWIO_BASE_URL` | diagrams.net base URL used for `.drawio` viewing and editing | `https://embed.diagrams.net` |
| `COLLABMD_WIKI_LINK_AUTO_CREATE` | Create missing markdown files when clicking unresolved wiki-links; set to `false` to disable | `true` |
| `COLLABMD_SEARCH_MAX_FILE_SIZE` | Maximum size of each file considered by global text search; supports bytes or `K`, `M`, and `G` suffixes | `1M` |
| `COLLABMD_SEARCH_MAX_BUFFER_BYTES` | Maximum ripgrep output buffer for one global text search | `2097152` |
| `COLLABMD_MAX_PDF_UPLOAD_BYTES` | Maximum size of a PDF upload in bytes; other uploads remain limited to the default 8 MiB request-body limit | `52428800` |
| `COLLABMD_VAULT_DIR` | Vault directory path | CLI: current directory, server entrypoint: `data/vault`, Docker: `/data` |
| `COLLABMD_VAULTS` | Multi-vault list (`id=path`, comma-separated; bare paths use the folder name). An explicit CLI directory wins. Vault APIs live at `/api/v/:vaultId/...` and realtime rooms at `/ws/v/:vaultId/:file`; unprefixed paths keep serving the first vault. With more than one vault the sidebar shows a vault switcher that reloads the workspace into the chosen vault (the open-file hash is preserved). Files, search, git status/commit, and git remote bootstrap (via `COLLABMD_GIT_REPO_URL_<VAULT_ID>`) are per-vault. Same auth and SSH key for every vault; agent, hosted, and Structurizr stay on the first vault. A primary-vault file literally at `v/<vaultId>/...` is shadowed by vault routing. | |
| `COLLABMD_GIT_ENABLED` | Enable or disable git integration in the UI and API | `true` |
| `COLLABMD_GIT_REPO_URL` | Remote git repository used to bootstrap the vault checkout | |
| `COLLABMD_GIT_SSH_PRIVATE_KEY_FILE` | SSH private key file path for remote git auth; preferred over base64 input | |
| `COLLABMD_GIT_SSH_PRIVATE_KEY_B64` | Base64-encoded SSH private key used when no key file path is provided | |
| `COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE` | Optional `known_hosts` file path for strict SSH host verification | |
| `COLLABMD_GIT_USER_NAME` | Fallback git author/committer name for in-app commits when OIDC is not active | |
| `COLLABMD_GIT_USER_EMAIL` | Fallback git author/committer email for in-app commits when OIDC is not active | |
| `WS_BASE_PATH` | WebSocket base path | `/ws` |
| `PUBLIC_WS_BASE_URL` | Public WebSocket URL override for reverse proxies | |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | Keep-alive timeout | `5000` |
| `HTTP_HEADERS_TIMEOUT_MS` | Header read timeout | `60000` |
| `HTTP_REQUEST_TIMEOUT_MS` | Request timeout | `30000` |
| `WS_HEARTBEAT_INTERVAL_MS` | Heartbeat interval for evicting dead clients | `30000` |
| `WS_ROOM_IDLE_GRACE_MS` | Delay before closing empty collaboration rooms to disk | `15000` |
| `WS_MAX_BUFFERED_AMOUNT_BYTES` | Max outbound buffer per WebSocket | `16777216` |
| `WS_MAX_PAYLOAD_BYTES` | Max inbound WebSocket frame | `16777216` |
| `CLOUDFLARED_BIN` | `cloudflared` binary path | `cloudflared` |
| `TUNNEL_TARGET_HOST` | Tunnel target host | `127.0.0.1` |
| `TUNNEL_TARGET_PORT` | Tunnel target port | `1234` |
| `TUNNEL_TARGET_URL` | Full tunnel target URL override | |
| `CLOUDFLARED_EXTRA_ARGS` | Extra `cloudflared` flags | |

Copy the example file:

```bash
cp .env.example .env
```

</details>

