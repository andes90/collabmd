import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { loadConfig } from '../../src/server/config/env.js';

test('loadConfig configures the Structurizr renderer', () => {
  const config = loadConfig({
    structurizr: {
      mirrorDir: '/tmp/collabmd-structurizr',
      serverUrl: 'http://127.0.0.1:19090',
      trustedExecutableDsl: true,
    },
    vaultDir: '/tmp/collabmd-vault',
  });

  assert.deepEqual(config.structurizr, {
    enabled: true,
    mirrorDir: '/tmp/collabmd-structurizr',
    serverUrl: 'http://127.0.0.1:19090',
    trustedExecutableDsl: true,
  });
});

test('loadConfig enables perf logging from COLLABMD_PERF_LOGGING', () => {
  const previousValue = process.env.COLLABMD_PERF_LOGGING;
  process.env.COLLABMD_PERF_LOGGING = '1';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.perfLoggingEnabled, true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_PERF_LOGGING;
    } else {
      process.env.COLLABMD_PERF_LOGGING = previousValue;
    }
  }
});

test('loadConfig accepts an isolated E2E public directory in test mode', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicDir = process.env.COLLABMD_E2E_PUBLIC_DIR;
  process.env.NODE_ENV = 'test';
  process.env.COLLABMD_E2E_PUBLIC_DIR = 'test-public';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.publicDir, resolve('test-public'));
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousPublicDir === undefined) {
      delete process.env.COLLABMD_E2E_PUBLIC_DIR;
    } else {
      process.env.COLLABMD_E2E_PUBLIC_DIR = previousPublicDir;
    }
  }
});


test('loadConfig configures global text search limits', () => {
  const previousMaxFileSize = process.env.COLLABMD_SEARCH_MAX_FILE_SIZE;
  const previousMaxBufferBytes = process.env.COLLABMD_SEARCH_MAX_BUFFER_BYTES;
  process.env.COLLABMD_SEARCH_MAX_FILE_SIZE = '5m';
  process.env.COLLABMD_SEARCH_MAX_BUFFER_BYTES = '8388608';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.searchMaxFileSize, '5M');
    assert.equal(config.searchMaxBufferBytes, 8 * 1024 * 1024);
  } finally {
    if (previousMaxFileSize === undefined) {
      delete process.env.COLLABMD_SEARCH_MAX_FILE_SIZE;
    } else {
      process.env.COLLABMD_SEARCH_MAX_FILE_SIZE = previousMaxFileSize;
    }

    if (previousMaxBufferBytes === undefined) {
      delete process.env.COLLABMD_SEARCH_MAX_BUFFER_BYTES;
    } else {
      process.env.COLLABMD_SEARCH_MAX_BUFFER_BYTES = previousMaxBufferBytes;
    }
  }
});

test('loadConfig configures the PDF upload limit', () => {
  const previousValue = process.env.COLLABMD_MAX_PDF_UPLOAD_BYTES;
  process.env.COLLABMD_MAX_PDF_UPLOAD_BYTES = '67108864';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.maxPdfUploadBytes, 64 * 1024 * 1024);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_MAX_PDF_UPLOAD_BYTES;
    } else {
      process.env.COLLABMD_MAX_PDF_UPLOAD_BYTES = previousValue;
    }
  }
});

test('loadConfig rejects invalid global text search file sizes', () => {
  const previousMaxFileSize = process.env.COLLABMD_SEARCH_MAX_FILE_SIZE;
  process.env.COLLABMD_SEARCH_MAX_FILE_SIZE = 'not-a-size';

  try {
    assert.throws(
      () => loadConfig({ vaultDir: process.cwd() }),
      /COLLABMD_SEARCH_MAX_FILE_SIZE must be a positive byte count/u,
    );
  } finally {
    if (previousMaxFileSize === undefined) {
      delete process.env.COLLABMD_SEARCH_MAX_FILE_SIZE;
    } else {
      process.env.COLLABMD_SEARCH_MAX_FILE_SIZE = previousMaxFileSize;
    }
  }
});

test('loadConfig enables wiki-link auto-create by default', () => {
  const previousValue = process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
  delete process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.wikiLinkAutoCreate, true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
    } else {
      process.env.COLLABMD_WIKI_LINK_AUTO_CREATE = previousValue;
    }
  }
});

test('loadConfig disables wiki-link auto-create from COLLABMD_WIKI_LINK_AUTO_CREATE=false', () => {
  const previousValue = process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
  process.env.COLLABMD_WIKI_LINK_AUTO_CREATE = 'false';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.wikiLinkAutoCreate, false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_WIKI_LINK_AUTO_CREATE;
    } else {
      process.env.COLLABMD_WIKI_LINK_AUTO_CREATE = previousValue;
    }
  }
});

test('loadConfig disables file watcher from COLLABMD_FILE_WATCHER_ENABLED=false', () => {
  const previousValue = process.env.COLLABMD_FILE_WATCHER_ENABLED;
  process.env.COLLABMD_FILE_WATCHER_ENABLED = 'false';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.fileWatcherEnabled, false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_FILE_WATCHER_ENABLED;
    } else {
      process.env.COLLABMD_FILE_WATCHER_ENABLED = previousValue;
    }
  }
});

test('loadConfig captures hosted workspace metadata settings', () => {
  const previousEnabled = process.env.COLLABMD_HOSTED_ENABLED;
  const previousDbPath = process.env.COLLABMD_HOSTED_METADATA_DB_PATH;
  const previousClaimEmail = process.env.COLLABMD_HOSTED_CLAIM_EMAIL;
  const previousClaimToken = process.env.COLLABMD_HOSTED_CLAIM_TOKEN;
  const previousGithubAppId = process.env.COLLABMD_GITHUB_APP_ID;
  const previousGithubAppSlug = process.env.COLLABMD_GITHUB_APP_SLUG;
  const previousGithubPrivateKey = process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY;
  const previousGithubApiBaseUrl = process.env.COLLABMD_GITHUB_API_BASE_URL;
  const previousGithubHtmlBaseUrl = process.env.COLLABMD_GITHUB_HTML_BASE_URL;
  const previousGithubFlowCookieName = process.env.COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME;
  const previousStrategy = process.env.AUTH_STRATEGY;
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousOidcClientId = process.env.AUTH_OIDC_CLIENT_ID;
  const previousOidcClientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;
  process.env.AUTH_STRATEGY = 'oidc';
  process.env.PUBLIC_BASE_URL = 'https://notes.example.com';
  process.env.AUTH_OIDC_CLIENT_ID = 'client-id';
  process.env.AUTH_OIDC_CLIENT_SECRET = 'client-secret';
  process.env.COLLABMD_HOSTED_ENABLED = 'true';
  process.env.COLLABMD_HOSTED_METADATA_DB_PATH = '/tmp/collabmd-hosted.sqlite';
  process.env.COLLABMD_HOSTED_CLAIM_EMAIL = 'admin@example.com';
  process.env.COLLABMD_HOSTED_CLAIM_TOKEN = 'claim-secret';
  process.env.COLLABMD_GITHUB_APP_ID = '1234';
  process.env.COLLABMD_GITHUB_APP_SLUG = 'collabmd-test';
  process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY = 'private-key';
  process.env.COLLABMD_GITHUB_API_BASE_URL = 'https://github.example/api';
  process.env.COLLABMD_GITHUB_HTML_BASE_URL = 'https://github.example';
  process.env.COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME = 'github_setup';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.hosted.enabled, true);
    assert.equal(config.hosted.metadataDbPath, '/tmp/collabmd-hosted.sqlite');
    assert.deepEqual(config.hosted.claim, {
      email: 'admin@example.com',
      token: 'claim-secret',
    });
    assert.deepEqual(config.hosted.githubApp, {
      apiBaseUrl: 'https://github.example/api',
      appId: '1234',
      appSlug: 'collabmd-test',
      flowCookieName: 'github_setup',
      htmlBaseUrl: 'https://github.example',
      privateKey: 'private-key',
    });
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.COLLABMD_HOSTED_ENABLED;
    } else {
      process.env.COLLABMD_HOSTED_ENABLED = previousEnabled;
    }

    if (previousDbPath === undefined) {
      delete process.env.COLLABMD_HOSTED_METADATA_DB_PATH;
    } else {
      process.env.COLLABMD_HOSTED_METADATA_DB_PATH = previousDbPath;
    }

    if (previousClaimEmail === undefined) {
      delete process.env.COLLABMD_HOSTED_CLAIM_EMAIL;
    } else {
      process.env.COLLABMD_HOSTED_CLAIM_EMAIL = previousClaimEmail;
    }

    if (previousClaimToken === undefined) {
      delete process.env.COLLABMD_HOSTED_CLAIM_TOKEN;
    } else {
      process.env.COLLABMD_HOSTED_CLAIM_TOKEN = previousClaimToken;
    }

    if (previousGithubAppId === undefined) {
      delete process.env.COLLABMD_GITHUB_APP_ID;
    } else {
      process.env.COLLABMD_GITHUB_APP_ID = previousGithubAppId;
    }

    if (previousGithubAppSlug === undefined) {
      delete process.env.COLLABMD_GITHUB_APP_SLUG;
    } else {
      process.env.COLLABMD_GITHUB_APP_SLUG = previousGithubAppSlug;
    }

    if (previousGithubPrivateKey === undefined) {
      delete process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY = previousGithubPrivateKey;
    }

    if (previousGithubApiBaseUrl === undefined) {
      delete process.env.COLLABMD_GITHUB_API_BASE_URL;
    } else {
      process.env.COLLABMD_GITHUB_API_BASE_URL = previousGithubApiBaseUrl;
    }

    if (previousGithubHtmlBaseUrl === undefined) {
      delete process.env.COLLABMD_GITHUB_HTML_BASE_URL;
    } else {
      process.env.COLLABMD_GITHUB_HTML_BASE_URL = previousGithubHtmlBaseUrl;
    }

    if (previousGithubFlowCookieName === undefined) {
      delete process.env.COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME;
    } else {
      process.env.COLLABMD_GITHUB_SETUP_FLOW_COOKIE_NAME = previousGithubFlowCookieName;
    }

    if (previousStrategy === undefined) {
      delete process.env.AUTH_STRATEGY;
    } else {
      process.env.AUTH_STRATEGY = previousStrategy;
    }

    if (previousPublicBaseUrl === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    }

    if (previousOidcClientId === undefined) {
      delete process.env.AUTH_OIDC_CLIENT_ID;
    } else {
      process.env.AUTH_OIDC_CLIENT_ID = previousOidcClientId;
    }

    if (previousOidcClientSecret === undefined) {
      delete process.env.AUTH_OIDC_CLIENT_SECRET;
    } else {
      process.env.AUTH_OIDC_CLIENT_SECRET = previousOidcClientSecret;
    }
  }
});

test('loadConfig requires OIDC when hosted workspace mode is enabled', () => {
  const previousValue = process.env.COLLABMD_HOSTED_ENABLED;
  const previousStrategy = process.env.AUTH_STRATEGY;
  process.env.COLLABMD_HOSTED_ENABLED = 'true';
  delete process.env.AUTH_STRATEGY;

  try {
    assert.throws(
      () => loadConfig({ vaultDir: process.cwd() }),
      /requires AUTH_STRATEGY=oidc/u,
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_HOSTED_ENABLED;
    } else {
      process.env.COLLABMD_HOSTED_ENABLED = previousValue;
    }

    if (previousStrategy === undefined) {
      delete process.env.AUTH_STRATEGY;
    } else {
      process.env.AUTH_STRATEGY = previousStrategy;
    }
  }
});

test('loadConfig does not read GitHub App private key files when hosted mode is disabled', () => {
  const previousEnabled = process.env.COLLABMD_HOSTED_ENABLED;
  const previousPrivateKeyFile = process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE;
  process.env.COLLABMD_HOSTED_ENABLED = 'false';
  process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE = '/tmp/collabmd-missing-github-app-key.pem';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.hosted.enabled, false);
    assert.equal(config.hosted.githubApp.privateKey, '');
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.COLLABMD_HOSTED_ENABLED;
    } else {
      process.env.COLLABMD_HOSTED_ENABLED = previousEnabled;
    }

    if (previousPrivateKeyFile === undefined) {
      delete process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE;
    } else {
      process.env.COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE = previousPrivateKeyFile;
    }
  }
});
