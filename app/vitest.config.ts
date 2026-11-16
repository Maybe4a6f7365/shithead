// ============================================================================
// Vitest config — engine, protocol, client and component tests (node pool;
// component tests opt into jsdom per file).
// src/worker is not unit-tested here: its extracted helpers are covered from
// engine/__tests__, and the Worker itself by scripts/test-worker-adversarial.mjs
// against a local wrangler dev.
// ============================================================================
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/worker/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/engine/**'],
      exclude: ['**/__tests__/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
