import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The simulation is headless by construction, so the default environment
    // is plain node. Anything needing a DOM must opt in per file.
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    reporters: ['default'],
  },
});
