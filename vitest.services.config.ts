import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/services/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
