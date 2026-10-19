import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Slow, ROM-dependent scripted runs (not part of `npm test`):
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/run.test.ts
export default defineConfig({
  test: {
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 300000,
    root: path.resolve(import.meta.dirname, '../..'),
  },
});
