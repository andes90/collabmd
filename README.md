# CollabMD

Collaborative markdown vault — like Obsidian, but online. Run the CLI in any directory to serve it as a realtime collaborative editing environment with live preview, Mermaid and PlantUML diagrams, and `[[wiki-links]]`.

## How it works

```text
cd ~/my-vault
collabmd
```

CollabMD starts a local server, scans for markdown files, and opens a browser-based editor with:

- **File explorer sidebar** — browse, create, rename, and delete `.md`, `.puml`, and `.excalidraw` files plus folders
- **Realtime collaboration** — multiple people can edit the same file at the same time via Yjs
- **Live preview** — rendered as you type, with syntax-highlighted code blocks plus Mermaid and PlantUML diagrams
- **`[[wiki-links]]`** — click a wiki-link in the preview to jump to that file
- **Standalone diagram files** — open `.puml` files in side-by-side editor + preview, or `.excalidraw` files in direct preview mode
- **Cloudflare Tunnel** — auto-starts by default so collaborators can reach your vault over the internet

Your filesystem is the source of truth. CollabMD reads `.md` files from disk, uses Yjs for the realtime collaboration layer, and writes plain text back to disk when the last editor disconnects.

## Architecture

```text
bin/
  collabmd.js              CLI entry point
src/
  client/
    application/           app orchestration, preview rendering, wiki-links
    domain/                room/user generators
    infrastructure/        runtime config, collaborative editor session
    presentation/          file explorer, theme, layout, outline, scroll sync, toast
  server/
    config/                environment loading
    domain/                collaboration room model and registry
    infrastructure/        HTTP request handler, vault file store, WebSocket gateway
public/
  assets/css/              static styles
  index.html               app shell
scripts/
  build-client.mjs         client bundling and vendored browser assets
  cloudflare-tunnel.mjs    Cloudflare quick tunnel helper
```

## Requirements

- Node.js >= 20
- npm

## Install

### From source

```bash
git clone https://github.com/andes90/collabmd.git
cd collabmd
npm install
npm run build
npm link       # optional: makes `collabmd` available globally
```

## Usage

```bash
collabmd [directory] [options]
```

### Arguments

| Argument    | Description                                          |
|-------------|------------------------------------------------------|
| `directory` | Path to the vault directory (default: current directory) |

### Options

| Option          | Description                            | Default      |
|-----------------|----------------------------------------|--------------|
| `-p, --port`    | Port to listen on                      | `1234`       |
| `--host`        | Host to bind to                        | `127.0.0.1`  |
| `--local-plantuml` | Start the bundled local docker-compose PlantUML service | off |
| `--no-tunnel`   | Don't start Cloudflare Tunnel          | tunnel on    |
| `-v, --version` | Show version                           |              |
| `-h, --help`    | Show help                              |              |

### Examples

```bash
# Serve the current directory
collabmd

# Serve a specific vault
collabmd ~/my-vault

# Use a custom port, no tunnel
collabmd --port 3000 --no-tunnel

# Use the local docker-compose PlantUML service
collabmd --local-plantuml

# Serve an Obsidian vault
collabmd ~/Documents/Obsidian/MyVault
```

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
npm run build          # Build client bundle
npm run check          # Syntax check all entry points
npm run start          # Build + start server
npm run start:local-plantuml  # Build + start server with local docker-compose PlantUML
npm run start:prod     # Start server (expects previous build)
npm run test           # Run unit + e2e tests
npm run test:unit      # Fast Node-based unit tests
npm run test:e2e       # Playwright browser tests
npm run tunnel         # Start only the Cloudflare tunnel
npm run plantuml:up    # Start only the local docker-compose PlantUML service
npm run plantuml:down  # Stop only the local docker-compose PlantUML service
```

## Testing

### Unit tests

```bash
npm run test:unit
```

Covers the vault file store, HTTP endpoints, collaboration room, and WebSocket integration behavior.

### End-to-end tests

```bash
npx playwright install chromium    # first time only
npm run test:e2e
```

Playwright boots the full app against the `test-vault/` directory and verifies the file explorer, editor, preview, collaboration, outline, and scroll sync flows.

### All tests

```bash
npm run test
```

## Cloudflare Tunnel

By default, the CLI starts a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) so your vault is accessible from the internet. Since the editor uses same-origin WebSocket routing (`/ws/:file`), the tunnel works for both HTTP and collaboration traffic.

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

### Local docker-compose with a private PlantUML server

The included `docker-compose.yml` starts CollabMD together with a local `plantuml/plantuml-server:jetty` container and points `PLANTUML_SERVER_URL` at the private service automatically.

```bash
mkdir -p data/vault
docker compose up --build
```

Open `http://localhost:1234`.

The PlantUML container is also published on loopback by default at `http://127.0.0.1:18080`, so the host-based CLI can reuse it with:

```bash
npm run start:local-plantuml
```

To use an existing vault on your machine instead of `./data/vault`:

```bash
HOST_VAULT_DIR=/absolute/path/to/vault docker compose up --build
```

To change the host port:

```bash
COLLABMD_HOST_PORT=3000 docker compose up --build
```

To change the local PlantUML host port used by both `docker compose` and `--local-plantuml`:

```bash
PLANTUML_HOST_PORT=18081 npm run start:local-plantuml
```

Recommended Coolify setup:

1. Use the included `Dockerfile`.
2. Expose port `1234`.
3. Mount a persistent volume to `/data` containing your markdown files.
4. Run a single replica only — room state is in-process and not shared across instances.
5. Set `PUBLIC_WS_BASE_URL` only if your WebSocket endpoint differs from the app origin.

Health check: `GET /health`

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HOST` | Bind host | `127.0.0.1` (dev), `0.0.0.0` (prod) |
| `PORT` | HTTP + WebSocket port | `1234` |
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

## Notes

- No authentication or authorization layer — anyone with the URL can edit.
- The filesystem is the source of truth; Yjs is the collaboration layer on top.
- CollabMD assumes it is the only writer while a file is open — no live `fs.watch` reconciliation.
- `.obsidian`, `.git`, `.trash`, and `node_modules` directories are ignored.
- Only `.md`, `.markdown`, and `.mdx` files are indexed.
- PlantUML preview rendering is server-side and uses `PLANTUML_SERVER_URL`; point it at a self-hosted renderer if you do not want to use the public PlantUML service.
- `docker compose up --build` uses the included local PlantUML service and avoids the public renderer by default.
- `collabmd --local-plantuml` and `npm run start:local-plantuml` will start the local PlantUML compose service first, then run CollabMD against `http://127.0.0.1:${PLANTUML_HOST_PORT:-18080}`.

## License

MIT
