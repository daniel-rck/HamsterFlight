import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Absolute asset URLs: the site is deployed at the root, and public/_headers
  // matches on /assets/*. Relative URLs would break that under any subpath.
  base: '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    // Never inline assets. Most sprite frames are 2-5 kB, which is under the
    // 4 kB default, so they would be base64'd into the JS bundle - hundreds of
    // them. As separate files they are content-hashed and cached immutably,
    // and the entry chunk stays small enough to parse instantly.
    assetsInlineLimit: 0,
    // Fail loudly rather than silently shipping a bloated bundle.
    chunkSizeWarningLimit: 400,
  },
  server: {
    port: 5173,
    open: false,
  },
});
