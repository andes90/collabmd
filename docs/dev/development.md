# Development

Contributor setup and verification for CollabMD. Start with the
[product overview](../../README.md), [terminology](../../CONTEXT.md), and
[architecture boundaries](architecture.md). Runtime/configuration behavior belongs
in [configuration](../configuration.md), not this guide.

## Setup

Use Node.js 26 (the exact local version is in `.tool-versions`), npm, and ripgrep
(`rg`, required by search tests). From a clean checkout:

```bash
npm ci
npx playwright install chromium
npm start -- --no-tunnel
```

Open `http://localhost:1234`. `npm start` builds first. For split development,
run `npm run dev:server` and `npm run dev:client` in separate terminals; the
Vite URL printed by the latter proxies API/WebSocket traffic to the backend.
See [configuration](../configuration.md) for optional local diagram renderers.

## Completing a change

One owner carries the change from the requested outcome through integration and
verification. A short task/PR description is enough; no separate plan is needed
for a small change.

1. State what a collaborator should be able to do and the observable result.
   Trace only the necessary path through UI, application, API/WebSocket,
   persistence, background workers/timers, and external services. Mark unused
   boundaries as not applicable.
2. Inspect existing implementations, callers, tests, and suitable existing
   services before adding infrastructure. Fix the shared cause; keep unrelated
   cleanup separate.
3. Load an available skill only when its stated purpose matches the task (for
   example diagnosis for a hard failure, UI design for a redesign, or commit
   preparation when asked to commit). Read its instructions then; do not copy
   personal skill catalogs into this repo. There are currently no repository
   skills. Product [AI agent access](../ai-agents.md) describes Vault access over
   MCP/WebMCP, not how coding agents contribute to this repository.
4. Delegate only bounded, independent work when it reduces total effort. Name
   the owned files/output, avoid recursive delegation, and retain one integration
   owner. Review again only when a change or new evidence warrants it.
5. Run the checks below for the affected boundaries. On repeated failure, inspect
   logs/traces and investigate the cause before retrying or changing direction.
   Separate blocking defects from optional improvements. Preserve regression
   coverage unless evidence shows it obsolete, redundant, or ineffective.
6. Finish with the outcome, changed scope, commands and results, boundaries
   exercised/unverified, and any blocker. A passing unit test alone does not prove
   a browser flow or external integration. Measure before/after any performance
   claim. Stop once the scoped outcome is verified; release actions require
   authorization.

## Verification

`package.json` defines the commands. Use the narrowest check while iterating:

| Changed boundary | Focused command |
| --- | --- |
| Pure/domain rules | `node --test tests/node/<name>.test.js` |
| HTTP, filesystem, git, startup, WebSocket | `npm run build && node --test tests/node/integration/<name>.test.js` |
| Browser component/DOM | `npm run test:browser -- tests/browser/<name>.browser.test.js` |
| CSS/UI conventions | `npm run test:guardrails` |
| Full user flow | `npm run test:e2e -- tests/e2e/<name>.spec.js` |

For completion:

- Documentation only: check the diff, links, and any changed command examples.
- Source changes: focused tests plus `npm run lint` and `npm run build`.
- Changes spanning layers or UI behavior: `npm run check`, plus relevant E2E
  flows. `check` already includes lint and build; do not run them again unchanged.
- Broad changes: `npm run lint && npm test` runs lint and every test suite.

`check` runs lint, guardrails, unit (which builds), integration, and browser tests.
`npm test` runs guardrails, unit (which builds), integration, browser, and E2E;
it does **not** include lint. `:prebuilt` commands assume a current build and
are useful after `check`, not as standalone clean-checkout verification.

Playwright's app fixture starts isolated servers with temporary copies of
`test-vault/` and `dist/client/`; it does not edit the committed fixture vault.
Inspect `test-results/` traces, screenshots, and error context before retrying.
If Chromium fails before launch with an OS/sandbox permission error, resolve the
execution permission rather than modifying tests or disabling coverage.

The existing [Docker workflow](../../.github/workflows/docker-publish.yml)
validates PRs with `npm run check` and the Comment Overview E2E pilot below.
The NPM release workflow runs `check`; neither runs the entire E2E suite.
GitHub execution and live external services still need their own evidence.

## First feature pilot: Comment Overview

Outcome: a collaborator posts a comment on an Excalidraw element, leaves the
file, then uses Comments to reopen the persisted discussion at that element.
See the [feature notes](comment-overview.md#implementation-and-verification)
for the traced path and coverage limits. Run the same pilot selection as PR CI:

```bash
npm run check
npm run test:e2e:prebuilt -- tests/e2e/collaboration.spec.js --grep overview
```

This pilot exposed stale feature support notes, incorrect command descriptions,
and a CI gap: browser component tests did not exercise the full overview flow.
Leaving the file in the pilot also exposed a lost comment-open request during
iframe remounting; the host now resets readiness before mounting.
The existing feature tests and validation job cover the gap without a new test
runner or workflow. Use failures or missing evidence from the next real change
to choose further improvements; do not expand the process speculatively.

## Release notes

GitHub releases use the tag as the title and this body format:

```markdown
## Summary

- Added:
  - <headline feature>: <one-line detail>
- Changed:
  - <behavior or performance change>
- Fixed:
  - <bug fix>
- Internal:
  - <deps, tests, and the version bump>

**Full Changelog**: https://github.com/andes90/collabmd/compare/<prev>...<new>
```

Group commits by theme instead of listing them one by one, lead each
category with its biggest item, and keep one line per nested item.

