import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const repoRoot = process.cwd();
const envConfigPath = resolve(repoRoot, 'src/server/config/env.js');
const envExamplePath = resolve(repoRoot, '.env.example');
const configDocPath = resolve(repoRoot, 'docs/configuration.md');
const httpHandlersRoot = resolve(repoRoot, 'src/server/infrastructure/http');

// Internal, test-only, standard Git, or legacy-alias env vars intentionally
// excluded from operator-facing docs / .env.example parity checks.
const INTERNAL_OR_ALIAS_ENV_VARS = new Set([
  'COLLABMD_BUILD_ID',
  'COLLABMD_E2E_PUBLIC_DIR',
  'COLLABMD_PERF_LOGGING',
  'COLLABMD_STRUCTURIZR_SERVER_URL',
  'DRAWIO_BASE_URL',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_NAME',
  'NODE_ENV',
  'STRUCTURIZR_MIRROR_DIR',
  'STRUCTURIZR_TRUSTED_EXECUTABLE_DSL',
  'TEST_WS_ROOM_HYDRATE_DELAY_MS',
]);

// Optional advanced OIDC / hosted-only vars documented in docs/configuration.md
// that do not need to clutter the default self-hosted .env.example template.
const DOC_ONLY_ENV_VARS = new Set([
  'AUTH_OIDC_FLOW_COOKIE_NAME',
  'AUTH_OIDC_ISSUER_URL',
  'COLLABMD_GITHUB_API_BASE_URL',
  'COLLABMD_GITHUB_APP_ID',
  'COLLABMD_GITHUB_APP_PRIVATE_KEY',
  'COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE',
  'COLLABMD_GITHUB_APP_SLUG',
  'COLLABMD_GITHUB_HTML_BASE_URL',
  'COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME',
  'COLLABMD_HOSTED_CLAIM_EMAIL',
  'COLLABMD_HOSTED_CLAIM_TOKEN',
  'COLLABMD_HOSTED_ENABLED',
  'COLLABMD_HOSTED_METADATA_DB_PATH',
]);

function extractConfigEnvVars(source) {
  return Array.from(new Set(
    [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/gu)].map((match) => match[1]),
  )).sort();
}

test('operator environment variables in src/server/config/env.js are documented in docs/configuration.md', async () => {
  const [envSource, configDoc] = await Promise.all([
    readFile(envConfigPath, 'utf8'),
    readFile(configDocPath, 'utf8'),
  ]);

  const docVars = new Set(
    [...configDoc.matchAll(/`([A-Z][A-Z0-9_]+)`/gu)].map((match) => match[1]),
  );

  const undocumented = extractConfigEnvVars(envSource)
    .filter((name) => !INTERNAL_OR_ALIAS_ENV_VARS.has(name) && !docVars.has(name));

  assert.deepEqual(undocumented, []);
});

test('self-hosted operator environment variables in src/server/config/env.js appear in .env.example', async () => {
  const [envSource, envExample] = await Promise.all([
    readFile(envConfigPath, 'utf8'),
    readFile(envExamplePath, 'utf8'),
  ]);

  const exampleVars = new Set(
    [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gmu)].map((match) => match[1]),
  );

  const missingFromExample = extractConfigEnvVars(envSource)
    .filter((name) => (
      !INTERNAL_OR_ALIAS_ENV_VARS.has(name)
      && !DOC_ONLY_ENV_VARS.has(name)
      && !exampleVars.has(name)
    ));

  assert.deepEqual(missingFromExample, []);
});

test('HTTP handlers do not echo raw error.message without status-code gating', async () => {
  const entries = await readdir(httpHandlersRoot, { withFileTypes: true });
  const violations = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name === 'http-request-helpers.js') {
      continue;
    }

    const filePath = resolve(httpHandlersRoot, entry.name);
    const repoPath = relative(repoRoot, filePath).replace(/\\/gu, '/');
    const lines = (await readFile(filePath, 'utf8')).split('\n');

    lines.forEach((line, index) => {
      if (!/error\??\.message/u.test(line)) return;
      if (/console\./u.test(line)) return;
      if (/statusCode\s*(?:>=|<)\s*500|Number\.isInteger\(error\?\.statusCode\)/u.test(line)) return;
      violations.push(`${repoPath}:${index + 1} | ${line.trim()}`);
    });
  }

  assert.deepEqual(violations, []);
});
