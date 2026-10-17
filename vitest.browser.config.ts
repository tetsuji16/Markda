import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: {
    include: [
      'markdown-it-emoji',
      'markdown-it-emoji/lib/data/light.mjs',
      'markdown-it-emoji/lib/data/full.mjs',
      'yaml',
    ],
  },
  test: {
    include: ['test/**/*.browser.test.ts'],
    // Browser suites share CPU-heavy editor and Mermaid initialization. Running
    // them serially makes startup budgets meaningful and avoids cross-test
    // contention masquerading as a product regression.
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
      viewport: { width: 900, height: 700 },
      // Vitest's default browser port (63315) falls inside the dynamic port
      // range (49152-65535) where Windows Hyper-V/WinNAT reserves blocks such
      // as 63304-63403, which makes the server fail with EACCES. Stay below it.
      api: { port: 43315 },
    },
  },
});
