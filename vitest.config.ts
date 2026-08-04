import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The real `obsidian` package is types-only and has no runtime entry
      // point, so tests resolve it to an in-memory stub instead.
      obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
});
