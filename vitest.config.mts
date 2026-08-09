import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Minimal harness for the pure units in src/lib. No jsdom, no globals, no setup
// files: the only thing under test right now is the pricing resolver, which has
// no imports of its own and touches neither the DOM nor the database.
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` -> `./src/*` mapping in tsconfig.json.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Scoped to src/ on purpose. Claude Code agent worktrees under .claude/ are
    // full checkouts carrying their own (often stale) copies of src/, and vitest's
    // default excludes do not cover them — eslint.config.mjs ignores them for the
    // same reason.
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', '.claude/**'],
    environment: 'node',
  },
});
