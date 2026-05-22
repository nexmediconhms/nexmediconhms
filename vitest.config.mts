/**
 * vitest.config.mts
 *
 * Vitest configuration for NexMedicon HMS unit tests.
 *
 * IMPORTANT: This file uses .mts extension (ESM) because Vitest 4.x
 * requires ESM imports. The rest of the project does NOT use
 * "type": "module" in package.json (which would break next-pwa and
 * other CJS dependencies). The .mts extension forces Node to treat
 * ONLY this file as ESM, regardless of package.json settings.
 *
 * RUN TESTS:
 *   npm test                          → run all unit tests once
 *   npm run test:watch                → watch mode
 *   npm run test:coverage             → with coverage report
 *   npx vitest --run tests/unit/billing-gst.test.ts --config vitest.config.mts
 *
 * PATH ALIASES:
 *   '@/*' resolves to './src/*' — matches tsconfig.json paths.
 *
 * ENVIRONMENT:
 *   Tests run in 'node' environment (not jsdom) because we're testing
 *   pure logic (validation, calculations, state machines), not React
 *   components. Tests that import from @/lib/* do NOT need a browser.
 */

import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // Use ESM-native test runner
    globals: true,
    environment: 'node',

    // Test file patterns
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'node_modules',
      'tests/e2e/**',
      '.next',
      'dist',
    ],

    // Timeout for slow tests (Supabase mocks, etc.)
    testTimeout: 10000,

    // Coverage configuration
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**'],
      exclude: [
        'src/lib/supabase.ts',        // Client singleton — not unit-testable
        'src/lib/supabase-admin.ts',   // Server singleton — needs env vars
      ],
    },
  },

  resolve: {
    alias: {
      // Match the '@/*' path alias from tsconfig.json
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
