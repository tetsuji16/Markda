import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/**/*.browser.test.ts'],
    // Editor suites are memory-heavy in jsdom. Capping workers avoids
    // tinypool IPC failures on Windows and keeps local release checks stable.
    maxWorkers: 2,
    testTimeout: 30_000,
  },
});
