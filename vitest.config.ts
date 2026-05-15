/**
 * vitest.config.ts
 * 
 * Configuration for Vitest — the test runner for this project.
 * 
 * To run tests:
 *   npx vitest --run          (run once and exit)
 *   npx vitest                (watch mode — re-runs on file changes)
 *   npx vitest --coverage     (shows which lines are tested)
 */

import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // Use jsdom so React components can be tested in Node.js
    environment: 'jsdom',
    // Enable globals (describe, it, expect) without importing
    globals: true,
    // Setup file runs before each test file
    setupFiles: ['./tests/setup.ts'],
    // Include test files matching these patterns
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      // Match the @/ alias from tsconfig.json
      '@': path.resolve(__dirname, './src'),
    },
  },
})
