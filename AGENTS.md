# AGENTS.md

Guidance for coding agents working in CollabMD.

## Start here

1. Read `CONTEXT.md` for product terminology and invariants. Use its terms
   precisely.
2. Read `docs/dev/architecture.md` before moving code or adding imports across
   layers. Check `docs/dev/adr/` before changing a documented decision.
3. Check `git status --short`; preserve unrelated user changes.
4. Find the existing implementation and its callers before editing. Prefer the
   smallest root-cause change.
5. Add or update the nearest focused test for behavioral changes.

`docs/configuration.md` is the user-facing source of truth for CLI behavior,
configuration, and supported features; `README.md` covers the product overview
and links to it. Keep both and `.env.example` aligned with user-visible
config changes.

## Runtime and commands

- Node.js 26 (`.tool-versions`, CI, and `package.json` require it).
- Use `npm`; CI uses `npm ci` and this repo commits `package-lock.json`.
- Install: `npm install`
- Build: `npm run build`
- Lint: `npm run lint`
- Full non-E2E check: `npm run check`
- Full suite: `npm test`
- Local app: `npm start` → `http://localhost:1234`
- Split development: `npm run dev:server` and `npm run dev:client`

Run the narrowest relevant check while iterating:

```bash
node --test tests/node/<name>.test.js
npm run test:guardrails
npm run test:browser
npm run build && npx playwright test tests/e2e/<name>.spec.js
```

Use the npm wrappers for final validation because several suites require a
fresh build. Install Chromium once with `npx playwright install chromium` if
needed.

## Repository map

- `bin/collabmd.js`: CLI entry point.
- `src/domain/`: pure rules shared by client and server.
- `src/client/app/`: Vite HTML and browser entry modules.
- `src/client/bootstrap/`: startup and dependency wiring; keep thin.
- `src/client/application/`: workflows and orchestration.
- `src/client/domain/`: pure client rules and transformations.
- `src/client/infrastructure/`: HTTP, WebSocket, browser, persistence, and
  editor adapters.
- `src/client/presentation/`: DOM/UI controllers and views.
- `src/client/export/`: export flows (PDF/image).
- `src/client/styles/`: layered CSS system.

Major directories only; top-level entry modules (`main.js`, editor adapters)
also live under `src/client/`.
- `src/server/application/`: workflows over injected collaborators.
- `src/server/domain/`: server-side rules and models.
- `src/server/infrastructure/`: HTTP, WebSocket, filesystem, git, and remote
  adapters.
- `src/server/shared/`: server-only shared helpers.
- `src/server/auth/`, `config/`, `startup/`: auth, configuration, and
  bootstrapping.
- `tests/node/`: unit tests; `tests/node/integration/`: integration tests.
- `tests/browser/`: Vitest browser tests; `tests/e2e/`: Playwright full-app
  tests.
- `test-vault/`: committed test fixture vault.
- `dist/`, `test-results/`, `.tmp/`: generated artifacts; do not hand-edit or
  commit incidental output.

## Architecture rules

CollabMD is a layered monolith. Keep domain code pure and dependencies inward:

- Client presentation imports domain only; receive application/infrastructure
  behavior through composition.
- Client application may use domain and injected collaborators, not
  presentation/infrastructure adapters.
- Client infrastructure may use domain, but not application or presentation.
- Shared pure helpers belong in `src/domain/`.
- Network, filesystem, git, WebSocket, and browser APIs belong in
  infrastructure.
- Compose layers only in thin entry/bootstrap modules.

`eslint.config.js` enforces the currently durable boundaries. Do not bypass a
restriction; move the behavior to the correct layer or inject a collaborator.
See `docs/dev/architecture.md` for the exact allowed imports.

## Product invariants

- The filesystem is the source of truth for Vault Content.
- Opening or hydrating a file must not rewrite it. Only intentional edits
  produce an Editable Content Save.
- External filesystem/git changes are observations reconciled into live state,
  not collaborator mutations.
- Collaboration sidecars (comments and editor snapshots) are not Vault Content.
- Preserve authentication and authorization on both HTTP and WebSocket paths.
- Treat vault content, paths, HTML, diagram source, git input, and remote
  responses as untrusted at their boundaries.
- The supported deployment is single-instance; do not imply cross-replica room
  state.

## Code and UI conventions

- ES modules, single quotes, semicolons, and no unused variables; prefix
  intentionally unused arguments with `_`.
- Reuse nearby patterns and native/stdlib APIs. Avoid speculative abstractions
  and new dependencies.
- Keep public error responses safe; do not expose secrets, filesystem internals,
  or credentials.
- Put visual CSS in `src/client/styles/`, never inline `<style>` blocks or
  runtime-injected styles.
- Raw colors belong only in `src/client/styles/foundation/themes.css`; elsewhere
  use existing tokens.
- Follow the existing style layers and feature file naming. Run
  `npm run test:guardrails` for CSS/UI changes.
- Preserve keyboard access, focus behavior, responsive layouts, and
  reduced-motion behavior when changing UI.

## Testing and completion

Match tests to the changed boundary:

- Pure/domain behavior → focused `tests/node/*.test.js`.
- HTTP, filesystem, git, startup, or WebSocket wiring →
  `tests/node/integration/`.
- Browser component/DOM behavior → `tests/browser/`.
- Full user flows, routing, collaboration, or visual regressions →
  `tests/e2e/`.

Playwright failure artifacts (traces, screenshots) land in `test-results/`;
inspect them before re-running blind.

Before finishing:

1. Run the focused test(s).
2. Run `npm run lint` and `npm run build` for source changes.
3. Run `npm run check` when the change spans layers or UI behavior.
4. Run relevant Playwright tests for user-visible full-app flows.
5. Recheck `git status --short` and report exactly what changed and which checks
   ran.

Do not update snapshots merely to silence failures; inspect the rendered
change first. Do not commit, publish, alter lockfiles, or regenerate unrelated
assets unless explicitly requested.
