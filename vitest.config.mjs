import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [
        { browser: 'chromium' },
      ],
      provider: playwright(),
    },
    include: ['tests/browser/**/*.browser.test.js'],
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
