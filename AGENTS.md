# AGENTS.md

CollabMD serves a plain-file Vault as a collaborative browser workspace for
Markdown, diagrams, comments, and git-backed docs. Files remain the source of
truth. Use [CONTEXT.md](CONTEXT.md) for product terms and invariants.

## Start and finish

- Check `git status --short`; preserve unrelated work. Trace the existing
  implementation and callers before editing.
- Define the observable user outcome and own it through integration and
  verification. Use the [contributor workflow](docs/dev/development.md#completing-a-change)
  for risk-based checks, skills, and bounded delegation.
- Read [architecture](docs/dev/architecture.md) before crossing layers and
  [ADRs](docs/dev/adr/) before changing a documented decision.
- Keep changes scoped; reuse existing code and dependencies. Add the nearest
  focused regression test for behavior changes.
- Do not commit, merge, publish, deploy, change lockfiles, or regenerate
  unrelated assets without explicit authorization.

## Code map and boundaries

- `bin/collabmd.js`: CLI; `src/client/app/`, `bootstrap/`: browser
  entry and composition; `src/server/startup/`: server startup.
- Client and server `application/`: workflows over injected collaborators;
  `domain/`: pure rules; `infrastructure/`: HTTP, WebSocket, filesystem, git,
  browser, and external-service adapters. Shared pure rules: `src/domain/`.
- Client `presentation/`: DOM/UI; `export/`: export flows; `styles/`: layered CSS.
  Server `auth/` and `config/`: access and configuration.
- Keep dependencies inward. Presentation receives application/infrastructure
  behavior through composition. Client infrastructure does not import application
  or presentation. Follow `eslint.config.js`; never bypass a boundary restriction.
- Opening or hydrating Editable Vault Content must preserve its bytes. Only an
  intentional edit produces an Editable Content Save. External filesystem/git
  changes are observations, not collaborator mutations. Comments and editor
  snapshots are Collaboration Sidecars, not Vault Content.
- Preserve HTTP and WebSocket authorization, validate untrusted content and paths,
  and keep errors free of secrets and filesystem internals. Deployment is
  single-instance; do not imply shared room state across replicas.
- Use ES modules, single quotes, semicolons, and no unused variables (`_` prefix
  for intentionally unused arguments). Keep visual CSS in `src/client/styles/`;
  raw colors only in `foundation/themes.css`. Preserve keyboard/focus access,
  responsive layouts, and reduced motion.

## Verification and sources of truth

Use Node.js 26 and npm. [Development](docs/dev/development.md) owns setup and the
check matrix; `package.json` owns command definitions. `npm run check` runs lint,
build, guardrails, unit, integration, and browser tests. Run relevant Playwright
flows with `npm run test:e2e -- tests/e2e/<name>.spec.js`; `npm test` runs all
suites but does not include lint.

Tests live in `tests/node/`, `tests/node/integration/`, `tests/browser/`, and
`tests/e2e/`. Inspect failures in `test-results/` before retrying. Do not remove
coverage or refresh snapshots just to pass. Report outcomes exercised, check
results, unverified boundaries, and blockers; recheck the final diff and status.
`dist/`, `.tmp/`, and `test-results/` are generated; `test-vault/` is a fixture.

[Configuration](docs/configuration.md) owns CLI/configuration behavior; keep
`.env.example` aligned when options change. [README](README.md) owns the product
overview and links, [contributor docs](docs/dev/README.md) link deeper guidance.
