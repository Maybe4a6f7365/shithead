// ============================================================================
// Vitest config — engine, protocol, client, component and Worker-helper tests
// (node pool; component tests opt into jsdom per file).
// The Worker's pure modules are unit-tested in src/worker/__tests__; the
// running Worker is exercised by scripts/test-worker-adversarial.mjs against a
// local wrangler dev.
// ============================================================================
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
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
