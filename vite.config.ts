import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    exclude: [
      ...configDefaults.exclude,
      'tests/e2e/**',
      'supabase/**',
      // Agent worktrees are stale full checkouts of the repo; without this,
      // vitest crawls them, re-runs every test twice, and fails on their
      // Deno-only (jsr:) supabase tests, which the 'supabase/**' entry above
      // doesn't match at that nested path.
      '**/.claude/**',
      '**/.worktrees/**',
    ],
  },
})
