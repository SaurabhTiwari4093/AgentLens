import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run tests from source. Without this, the compiled copies under each
    // package's dist/ get collected too and every test runs twice.
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
