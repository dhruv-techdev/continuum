import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    // better-sqlite3's native module segfaults when too many test files
    // open SQLite DBs concurrently across worker threads; run test files
    // serially within a single process to avoid crashing mid-run.
    fileParallelism: false,
  },
});
