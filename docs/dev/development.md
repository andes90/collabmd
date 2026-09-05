# Development

> Operator docs. Start with the [README](../../README.md) for the product overview.

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
npm run build                 # Build the Vite client into dist/client
npm run check                 # Syntax check all entry points
npm run dev:client            # Start the Vite dev server with API/WebSocket proxying
npm run dev:server            # Start only the backend server for local frontend development
npm run start                 # Build + start server
npm run start:local-plantuml  # Build + start server with local docker-compose PlantUML
npm run start:local-structurizr # Build + start server with local Structurizr
npm run start:prod            # Start server (expects previous build)
npm run test                  # Run unit + e2e tests
npm run test:unit             # Fast Node-based unit tests
npm run test:e2e              # Playwright browser tests
npm run tunnel                # Start only the Cloudflare tunnel
npm run plantuml:up           # Start only the local docker-compose PlantUML service
npm run plantuml:down         # Stop only the local docker-compose PlantUML service
npm run structurizr:up        # Start only the local Structurizr renderer
npm run structurizr:down      # Stop only the local Structurizr renderer
npm run capture:readme-assets # Regenerate the README screenshot and demo assets
```

## Testing

### Unit tests

```bash
npm run test:unit
```

Covers the vault file store, HTTP endpoints, collaboration room behavior, WebSocket integration, and supporting domain logic.

### End-to-end tests

```bash
npx playwright install chromium    # first time only
npm run test:e2e
```

Playwright boots the full app against the `test-vault/` directory and verifies the file explorer, editor, preview, collaboration, chat, outline, and scroll sync flows.

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
    app/                     Vite-owned HTML entries and browser entry modules
    application/           app orchestration, preview rendering, workspace coordination
    bootstrap/             app-shell composition and startup wiring
    domain/                markdown editing, wiki-link, room, and vault helpers
    infrastructure/        runtime config, auth bootstrap, browser ports, collaborative editor session
    presentation/          file explorer, backlinks, quick switcher, outline, scroll sync, theme, layout
    static/                Vite passthrough assets copied into the built client
    styles/                app CSS
  domain/                  shared wiki-link helpers
  server/
    auth/                  strategy selection and cookie-backed auth sessions
    config/                environment loading
    domain/                collaboration room model, registry, backlink index, server-side abstractions
    infrastructure/        HTTP handlers, git service, vault file store, PlantUML, WebSocket gateway
    startup/               preflight vault bootstrap, including remote git checkout setup
dist/
  client/                  built client served by the backend and packaged for release
scripts/
  cloudflare-tunnel.mjs    Cloudflare quick tunnel helper
  local-plantuml-compose.mjs
  capture-readme-assets.mjs
vite.config.mjs            Vite multi-page build and dev-server proxy config
```

</details>


## Notes

- The filesystem is the source of truth; Yjs provides the collaboration layer.
- When `COLLABMD_GIT_REPO_URL` is set, startup clones the configured repo into `COLLABMD_VAULT_DIR` on first boot and reuses an existing same-origin checkout on later starts.
- With `COLLABMD_VAULTS`, each vault can name its own remote via `COLLABMD_GIT_REPO_URL_<VAULT_ID>` (id uppercased, non-alphanumeric characters become `_`); a per-vault URL wins for that vault and the shared URL stays the primary vault's fallback. Unmapped vaults boot from disk, one SSH key covers all vaults, and any failure names the vault and stops startup.
- If `COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE` is not set, SSH falls back to `StrictHostKeyChecking=accept-new`.
- External filesystem edits are reconciled back into active rooms and the explorer. Ambiguous watcher bursts still fall back to batched workspace reconciliation.
- `.obsidian`, `.git`, `.trash`, and `node_modules` directories are ignored.
- Markdown, HTML, Base, Mermaid, PlantUML, Structurizr DSL, draw.io, Excalidraw, PDF, and image files are tracked by the vault tree; global text search indexes supported text formats.
- PlantUML preview rendering is server-side and uses `PLANTUML_SERVER_URL`; point it at a self-hosted renderer if you do not want to use the public PlantUML service.
- Structurizr previews use a read-only official Local sidecar and a disposable `.collabmd/structurizr` mirror; the authoritative vault is never mounted into the renderer as its data directory.
- `docker compose up` uses the included local PlantUML and Structurizr services and avoids public diagram renderers by default. The initial git clone may also require a longer health-check grace period than a purely local vault.
- `collabmd --local-plantuml` and `npm run start:local-plantuml` start the local PlantUML compose service. `collabmd --local-structurizr` starts Structurizr Local against `http://127.0.0.1:${STRUCTURIZR_HOST_PORT:-19090}`.

