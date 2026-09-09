# MCP and WebMCP retrieval and authoring exploration

Research date: 2026-09-09. This records the initial exploration and the resulting
implementation; it is not an accepted ADR. Aim: an agent finds the right evidence, cites it, and
creates or edits the intended document without losing collaborator changes.

## Implemented follow-up

The five priorities below are implemented through the existing shared tools:
live search overrides disk results before limits (including visible Excalidraw
text), defaults are 10 files/2 snippets and 80 read lines, Markdown outline mode
supports heading navigation, WebMCP exposes revision-bound local selections,
and Markdown writes optionally return inline reference validation. Reads now
return whole lines and `nextStartLine`; an oversized individual line fails
explicitly. See [operator guidance](../ai-agents.md#retrieve-and-edit-efficiently)
for the current contract and limits. No dependencies, lockfiles, or protocol
versions were changed.

The fixed integration fixture compares the former explicit limits with the new
defaults: 12,400 versus 7,124 JSON bytes across two retrieval calls each, with
the same first-document evidence and revision. This is about 43% fewer response
bytes for that fixture, not a measurement of model tokens, semantic answer
accuracy, or general latency. The remaining evaluation ideas below remain
future work.

Regression coverage includes both MCP and WebMCP HTTP contracts, live text and
Excalidraw searches, revision conflicts, complete-line continuation, outlines,
and saved-snapshot validation. The focused browser flow uses a WebMCP API shim
with the real editor and server, verifies selected-text context and a visible
validated edit, and rejects a stale retry. Native browser agent discovery and
consent are still external-client compatibility checks.

Final verification: `npm run check` passed (6 guardrail, 721 unit, 147
integration, and 164 browser tests, plus lint/build). The focused
`npm run test:e2e:prebuilt -- tests/e2e/agent-documents.spec.js` passed. Independent
review found the active-Excalidraw search gap during implementation; it was fixed
and verified before completion.

## Keep the existing architecture

The repo already has 14 shared tools, including listing, literal search, range
reads, reference inspection, validation, Base queries, revision-guarded exact
edits, and retry-safe creation. Browser WebMCP adds active-file context. Both
adapters use the same Agent Content service; live rooms supply current text and
closed-file writes go through Workspace Reconciliation. Preserve this design.

Sources: [tool definitions](../../src/domain/agent-tool-definitions.js),
[application service](../../src/server/application/agent-content-service.js),
[MCP adapter](../../src/server/infrastructure/mcp/create-agent-mcp-handler.js),
[WebMCP registry](../../src/client/infrastructure/webmcp-tool-registry.js),
[ADR 0004](adr/0004-agent-connections-over-mcp.md).

## Fix evidence correctness first

Three cases were reproduced with the real AgentContentService and injected
in-memory collaborators; these are service-level reproductions, not browser or
deployed-client verification:

1. A disk search hit survives when the hydrated live room no longer contains the
   term. `searchVault` only replaces paths that have positive live matches and
   returns disk results unchanged when there are no live matches. All eligible
   live paths must override disk evidence, including zero-match results. Account
   for limits when filling the remaining results.
2. Replacing one disk hit with its live equivalent marks `truncated: true` even
   when nothing was omitted. Calculate truncation after deduplication and define
   whether it means omitted documents, omitted snippets, or an incomplete scan.
3. A line longer than 100,000 characters is cut mid-line by `readDocument`.
   Reading from `endLine + 1` skips its remainder. Return explicit continuation
   information or a clear unsupported-long-line outcome; do not imply that line
   pagination can retrieve all the text.

The first two share a root cause in result merging. Fix them before adding more
search modes. Sources: [search/read implementation](../../src/server/application/agent-content-service.js),
[existing focused tests](../../tests/node/agent-content-service.test.js).

## Improve the existing tools in small steps

| Priority | Change | User outcome and smallest approach |
| --- | --- | --- |
| 1 | Reliable search evidence and continuation | Correct the reproduced cases; add focused regressions. Preserve current-room authority. |
| 2 | Smaller default responses | Try 10 documents with 2 snippets each and 80-line reads, retaining explicit larger limits. Measure task success and total tokens before adopting these proposed defaults. |
| 3 | Better document navigation | Add an optional outline read mode returning heading text, level, line, and document revision. Use existing Markdown token/line-map patterns and handle duplicate headings and fenced code. |
| 4 | Markdown-aware browser context | Extend `collabmd_get_active_context` with document kind and bounded editor selection/range. Associate the selection with synchronized content; always get a fresh server revision before saving. |
| 5 | More useful authoring results | Optionally return reference-validation results from the exact written Markdown snapshot, following the existing Excalidraw inline-verification pattern. Avoid a later read being described as verification of an earlier revision. |

Today, search defaults to 50 files and 5 snippets per file; reads default to
500 lines with a 100,000-character response cap. These are bounds, not measured
optimal defaults. Search accepts one literal case-insensitive phrase, not a
natural-language question, regex, or semantic query. It has no search cursor or
relevance scoring. List has a path cursor. Document reads are limited to
1,000,000 source characters; text creation and existing edit inputs are bounded
separately. Expose relevant limits and recovery steps in tool descriptions so
agents can avoid predictable failures.

Sources: [schemas](../../src/domain/agent-tool-definitions.js),
[service bounds](../../src/server/application/agent-content-service.js),
[search backend](../../src/server/domain/ripgrep-search-service.js),
[existing heading parsing](../../src/client/application/preview-render-compiler.js),
[browser composition](../../src/client/bootstrap/collabmd-app-shell.js).

For server efficiency, `prefix` and `kinds` currently filter ripgrep output in
JavaScript; ripgrep still runs against the Vault root and all supported text
globs. Push validated filters into the search invocation when profiling shows
this matters. Keep path containment, argument safety, exclusions, live overlays,
and cancellation intact. This is a code-derived opportunity, not a measured
speedup.

## Teach a short workflow

- **Answer a question:** use path filtering if the document name is known;
  otherwise search a distinctive literal phrase. Read the relevant ranges,
  follow references only where needed, and cite returned path and line evidence.
  An empty literal search is not proof that the Vault lacks information.
- **Create a document:** inspect nearby documents for structure and naming,
  consult the kind-specific syntax guide if needed, create once, and validate
  references when the content uses them. Identical creation retries already
  succeed; different content at an existing path fails.
- **Edit a document:** identify the target (browser selection when applicable),
  read current text, send one batch of unique non-overlapping exact replacements
  with its full-document revision, and check the result. A revision conflict
  requires rereading and reconsidering the edit. Never blindly replay a stale
  replacement or silently replace the whole document.

Put guidance in shared tool descriptions as well as remote server instructions:
the WebMCP registry currently does not receive the MCP server's workflow prose,
and its extra active-context guidance focuses on Excalidraw. Preserve
machine-readable errors with actionable recovery, and make clear that Vault
text is evidence rather than instructions to the agent.

Existing exact edits cannot populate an empty document because `oldText` must
be non-empty. If filling empty documents is a required workflow, add the narrowest
revision-guarded insertion operation through the same mutation path. This is a
contract gap observed in code, not a reason to add an unrestricted overwrite tool.
Sources: [exact edit rules](../../src/domain/exact-text-edits.js),
[MCP workflow instructions](../../src/server/infrastructure/mcp/create-agent-mcp-handler.js),
[browser context](../../src/client/infrastructure/webmcp-tool-registry.js).

## Measure useful work, not tool count

Use a small fixed set of realistic tasks: a named-document lookup, a paraphrased
question, a fact spread across linked documents, a long-document section read,
a document creation with references, a targeted edit, and an edit racing a
collaborator. Include live text with a removed match and a truncated search.

Record correct-answer/source rate, intended-edit success, conflict recovery,
tool calls, input/output tokens, response bytes, and end-to-end latency. Evaluate
the actual MCP client and WebMCP-capable browser separately. Compare the same
tasks and Vault before/after; lower per-call output can still cost more overall
if it creates extra round trips. Passing deterministic tests is not evidence of
good agent tool selection or semantic retrieval quality.

Keep ripgrep initially. Add bounded multi-term matching or title/heading ranking
if real tasks show repeated literal-search misses; evaluate an index or semantic
retrieval only if those simpler options remain inadequate. Do not add a second
authoring service, mandatory preview/approval calls for every edit, bulk mutation
tools, or automatic Git publishing for this exploration.

## Protocol compatibility and browser differences

The official current MCP version is 2026-07-28, using per-request metadata and
`server/discover`. The installed SDK has a 2025-11-25 compatibility constant,
but that alone is not a supported-version inventory: this repo's existing
integration test also connects a client pinned to 2026-07-28. Keep protocol
migration separate from retrieval improvements and test intended clients before
claiming newer caching support. [MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)

Retain the existing input/output schemas, scope-filtered tool discovery, and
structured results plus serialized JSON text. The latter remains recommended
for compatibility; measure actual model-visible output before assuming these
representations double token use. Business failures should give the model
actionable tool errors, including instructions to reread on revision conflict.
[MCP tools and errors](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

MCP resources can support client document pickers and attachments, but are not
necessary for this search/read/edit workflow. Add them for a demonstrated client
need and reuse the same authorization and current-content service.
[MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

WebMCP's September 4, 2026 document is a Draft Community Group Report, not a W3C
Standard. Its current `document.modelContext.registerTool()` API and registration
AbortSignal match this repo. Its tool dictionary does not require MCP's
`outputSchema` or result envelope. Browser annotations include `readOnlyHint`,
`untrustedContentHint`, and `consequentialHint`; copying MCP annotations does not
give `destructiveHint` or `idempotentHint` browser semantics. Map these
deliberately, and test how the browser agent receives returned business errors
versus rejected promises. Hints do not replace authorization or revision checks.
[Current WebMCP draft](https://webmachinelearning.github.io/webmcp/)

Use remote MCP for external automation and WebMCP for work in an open browser
with visible context and feedback. Chrome documents an origin trial beginning
with Chrome 149; browser availability must be tested rather than assumed.
[Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp)
Its guidance also supports evaluating concrete user journeys and recovery, as
proposed above. [Workflow evaluation guidance](https://developer.chrome.com/docs/ai/webmcp/build-tools)

## Initial exploration verification

Node.js v26.7.0:

```bash
node --test tests/node/agent-content-service.test.js tests/node/agent-content-contracts.test.js tests/node/webmcp-tool-registry.test.js tests/node/ripgrep-search-service.test.js
```

At the initial exploration stage, all 35 tests passed. The three cases above were additionally reproduced with
in-memory service probes. No production source, dependency, or lockfile changes
had been made at that stage. Later checks are limited to the implemented
follow-up described above; native browser agents and model-level evaluations
remain unverified.
