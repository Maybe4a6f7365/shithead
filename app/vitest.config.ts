// ============================================================================
// Vitest config — engine + multiplayer tests
// Two modes:
//   - default (engine/protocol): node pool
//   - worker/: cloudflare pool (loaded with vitest --config vitest.worker.config.ts)
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
