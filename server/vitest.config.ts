import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // integration tests share one database
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
