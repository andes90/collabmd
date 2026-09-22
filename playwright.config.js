import { defineConfig } from '@playwright/test';

const crossBrowserExcalidrawReliabilityProjects = process.env.PLAYWRIGHT_EXCALIDRAW_RELIABILITY_CROSS_BROWSER === '1'
  ? [
    {
      grep: /@excalidraw-smoke/,
      name: 'firefox-excalidraw-reliability',
      testMatch: /excalidraw-reliability\.spec\.js/,
      use: {
        browserName: 'firefox',
      },
    },
    {
      grep: /@excalidraw-smoke/,
      name: 'webkit-excalidraw-reliability',
      testMatch: /excalidraw-reliability\.spec\.js/,
      use: {
        browserName: 'webkit',
      },
    },
  ]
  : [];

export default defineConfig({
  globalSetup: './tests/e2e/helpers/global-setup.js',
  testDir: './tests/e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  retries: process.env.CI ? 2 : 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  fullyParallel: false,
  workers: '50%',
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
    ...crossBrowserExcalidrawReliabilityProjects,
  ],
});
