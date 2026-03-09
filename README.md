# CollabMD

Collaborative markdown vault, like Obsidian but online.

<p align="center">
  <img src="./docs/assets/collabmd-hero.png" alt="CollabMD showing a file tree, markdown editor, live preview, and collaborator presence." width="100%">
</p>

<p align="center">
  <strong>Serve any markdown folder as a realtime collaborative workspace.</strong>
</p>

<p align="center">
  Local files stay on disk. Markdown stays plain text. Collaborators get live editing, preview, comments, chat, diagrams, and shareable sessions in the browser.
</p>

## See it in action

![CollabMD live demo](./docs/assets/collabmd-demo.gif)

Prefer video? [Open the WebM demo](./docs/assets/collabmd-demo.webm).

## Why CollabMD

- **Local-files-first** — your filesystem is the source of truth
- **Realtime collaboration** — multiple people can edit the same file at the same time via Yjs
- **Markdown with context** — live preview, wiki-links, backlinks, outline, quick switcher, and scroll sync
- **Review built in** — inline comments, collaborator presence, follow mode, and team chat
- **Diagram-friendly** — Mermaid fences and standalone `.mmd` / `.mermaid` files, PlantUML `.puml` / `.plantuml`, and `.excalidraw` support
- **Easy sharing** — Cloudflare Tunnel starts by default so collaborators can join over the internet

## Quick Start

### Requirements

- Node.js 24
- npm

### From source

```bash
git clone https://github.com/andes90/collabmd.git
cd collabmd
npm install
npm run build
npm link       # optional: makes `collabmd` available globally
collabmd ~/my-vault
```

Open `http://localhost:1234`, or share the tunnel URL that CollabMD prints on startup.

## Good fit for

- Collaborating on an existing Obsidian-style vault without migrating files
- Reviewing RFCs, product docs, and architecture notes in real time
- Sharing markdown-heavy knowledge bases with remote teammates
- Editing notes and diagrams together while keeping everything as plain files on disk

## Safety

- Authentication defaults to `none`, so anyone with the URL can edit the vault unless you enable an auth strategy.
- `--auth password` protects `/api/*` and `/ws/*` with a host password and a signed session cookie.
- If you omit auth, treat the URL as write access to the vault.
- Cloudflare Tunnel starts by default unless you pass `--no-tunnel`.
- `oidc` is reserved for a future implementation and is not usable yet.

## How it works

```text
cd ~/my-vault
collabmd
```

CollabMD starts a local server, scans for markdown files, and opens a browser-based editor with:

- **File explorer sidebar** — browse, create, rename, and delete `.md`, `.mmd`, `.mermaid`, `.puml`, `.plantuml`, and `.excalidraw` files plus folders
- **Live preview** — rendered as you type, with syntax-highlighted code blocks plus Mermaid and PlantUML diagrams
- **`[[wiki-links]]` + backlinks** — jump between notes and inspect linked mentions
- **Comments + room chat** — review content in context without leaving the document
- **Presence + follow mode** — see who is online and follow another collaborator's active cursor
- **Quick switcher + outline** — move around large vaults and long documents faster
- **Standalone diagram files** — open `.mmd` / `.mermaid` or `.puml` / `.plantuml` files in side-by-side editor + preview, or `.excalidraw` files in direct preview mode

Your filesystem is the source of truth. CollabMD reads files from disk, uses Yjs for the realtime collaboration layer, and writes plain text back to disk when the last editor disconnects.

## Usage

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
| `--no-tunnel` | Don't start Cloudflare Tunnel | tunnel on |
| `-v, --version` | Show version | |
| `-h, --help` | Show help | |

### Examples

```bash
# Serve the current directory
collabmd

# Serve a specific vault
collabmd ~/my-vault

# Use a custom port, no tunnel
collabmd --port 3000 --no-tunnel

# Require a generated password for collaborators
collabmd --auth password

# Require an explicit password
collabmd --auth password --auth-password "shared-secret"

# Use the local docker-compose PlantUML service
collabmd --local-plantuml

# Serve an Obsidian vault
collabmd ~/Documents/Obsidian/MyVault
```

## Cloudflare Tunnel

By default, the CLI starts a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) so your vault is accessible from the internet. Since the editor uses same-origin WebSocket routing (`/ws/:file`), the tunnel works for both HTTP and collaboration traffic.

If you are exposing the app through the tunnel, `collabmd --auth password` is the intended first-line protection. When you do not pass `--auth-password`, CollabMD generates a new password for that host run and prints it in the terminal. Restarting the app rotates that password and the signed session secret.

Install `cloudflared`:

- macOS: `brew install cloudflared`
- Linux/Windows: [official installer](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

To disable the tunnel:

```bash
collabmd --no-tunnel
```

You can also configure the tunnel via environment variables:

```bash
TUNNEL_TARGET_PORT=4000 collabmd
TUNNEL_TARGET_URL=http://127.0.0.1:4000 collabmd
CLOUDFLARED_EXTRA_ARGS="--loglevel info" collabmd
```

## Docker / Coolify deployment

```bash
docker build -t collabmd .
docker run -p 1234:1234 -v /path/to/vault:/data collabmd
```

The container listens on `0.0.0.0:1234` and stores vault files at `/data`.

### Local docker-compose with a private PlantUML server

The included `docker-compose.yml` runs a prebuilt CollabMD image together with a local `plantuml/plantuml-server:jetty` container and points `PLANTUML_SERVER_URL` at the private service automatically.

```bash
mkdir -p data/vault
docker build -t collabmd:local .
docker compose up
```

Open `http://localhost:1234`.

By default, compose uses `COLLABMD_IMAGE=collabmd:local`. To run the published GitHub Container Registry image instead:

```bash
COLLABMD_IMAGE=ghcr.io/<owner>/<repo>:latest docker compose up
```

The PlantUML container is also published on loopback by default at `http://127.0.0.1:18080`, so the host-based CLI can reuse it with:

```bash
npm run start:local-plantuml
```

To use an existing vault on your machine instead of `./data/vault`:

```bash
HOST_VAULT_DIR=/absolute/path/to/vault docker compose up
```

To change the host port:

```bash
COLLABMD_HOST_PORT=3000 docker compose up
```

To change the local PlantUML host port used by both `docker compose` and `--local-plantuml`:

```bash
PLANTUML_HOST_PORT=18081 npm run start:local-plantuml
```

Recommended Coolify setup:

1. Use the included `Dockerfile`.
2. Expose port `1234`.
3. Mount a persistent volume to `/data` containing your markdown files.
4. Add a health check for `GET /health`.
5. Run a single replica only because room state is in-process and not shared across instances.
6. Set `PUBLIC_WS_BASE_URL` only if your WebSocket endpoint differs from the app origin.

For a standard Coolify reverse-proxy setup, the default same-origin WebSocket routing works as-is and you should not need `PUBLIC_WS_BASE_URL`.

Health check: `GET /health`

## Development

Install dependencies:

```bash
npm install
```

Build and run:

```bash
npm start
```

Open `http://localhost:1234`.

Useful commands:

```bash
npm run build                 # Build client bundle
npm run check                 # Syntax check all entry points
npm run start                 # Build + start server
npm run start:local-plantuml  # Build + start server with local docker-compose PlantUML
npm run start:prod            # Start server (expects previous build)
npm run test                  # Run unit + e2e tests
npm run test:unit             # Fast Node-based unit tests
npm run test:e2e              # Playwright browser tests
npm run tunnel                # Start only the Cloudflare tunnel
npm run plantuml:up           # Start only the local docker-compose PlantUML service
npm run plantuml:down         # Stop only the local docker-compose PlantUML service
npm run capture:readme-assets # Regenerate the README screenshot and demo assets
```

## Testing

### Unit tests

```bash
npm run test:unit
```

Covers the vault file store, HTTP endpoints, collaboration room, WebSocket integration behavior, and supporting domain logic.

### End-to-end tests

```bash
npx playwright install chromium    # first time only
npm run test:e2e
```

Playwright boots the full app against the `test-vault/` directory and verifies the file explorer, editor, preview, comments, collaboration, chat, outline, and scroll sync flows.

### All tests

```bash
npm run test
```

<details>
<summary>Architecture</summary>

```text
bin/
  collabmd.js              CLI entry point
src/
  client/
    application/           app orchestration, preview rendering, wiki-links
    domain/                room/user generators
    infrastructure/        runtime config, auth bootstrap, collaborative editor session
    presentation/          file explorer, comments, backlinks, quick switcher, outline, scroll sync, theme, layout
  domain/                  shared comment and wiki-link helpers
  server/
    auth/                  strategy selection and cookie-backed auth sessions
    config/                environment loading
    domain/                collaboration room model, registry, backlink index, PlantUML renderer
    infrastructure/        HTTP request handler, vault file store, WebSocket gateway
public/
  assets/css/              static styles
  index.html               app shell
scripts/
  build-client.mjs         client bundling and vendored browser assets
  cloudflare-tunnel.mjs    Cloudflare quick tunnel helper
  local-plantuml-compose.mjs
  capture-readme-assets.mjs
```

</details>

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
| `PLANTUML_SERVER_URL` | Upstream PlantUML server base URL used for server-side SVG rendering | `https://www.plantuml.com/plantuml` |
| `COLLABMD_VAULT_DIR` | Vault directory path | current directory |
| `WS_BASE_PATH` | WebSocket base path | `/ws` |
| `PUBLIC_WS_BASE_URL` | Public WebSocket URL override for reverse proxies | |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | Keep-alive timeout | `5000` |
| `HTTP_HEADERS_TIMEOUT_MS` | Header read timeout | `60000` |
| `HTTP_REQUEST_TIMEOUT_MS` | Request timeout | `30000` |
| `WS_HEARTBEAT_INTERVAL_MS` | Heartbeat interval for evicting dead clients | `30000` |
| `WS_MAX_BUFFERED_AMOUNT_BYTES` | Max outbound buffer per WebSocket | `1048576` |
| `WS_MAX_PAYLOAD_BYTES` | Max inbound WebSocket frame | `4194304` |
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

## Notes

- The filesystem is the source of truth; Yjs is the collaboration layer on top.
- CollabMD assumes it is the only writer while a file is open; there is no live `fs.watch` reconciliation.
- `.obsidian`, `.git`, `.trash`, and `node_modules` directories are ignored.
- Only `.md`, `.markdown`, and `.mdx` files are indexed.
- PlantUML preview rendering is server-side and uses `PLANTUML_SERVER_URL`; point it at a self-hosted renderer if you do not want to use the public PlantUML service.
- `docker compose up --build` uses the included local PlantUML service and avoids the public renderer by default.
- `collabmd --local-plantuml` and `npm run start:local-plantuml` will start the local PlantUML compose service first, then run CollabMD against `http://127.0.0.1:${PLANTUML_HOST_PORT:-18080}`.

## License

MIT
