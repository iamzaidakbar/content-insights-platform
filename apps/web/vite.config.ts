import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // bind 0.0.0.0 so the container is reachable from the host
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    fs: {
      // @content-insights/shared is symlinked in from ../../packages/shared,
      // outside apps/web's own root — allow Vite to serve/watch it.
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
    watch: {
      ignored: ['!**/node_modules/@content-insights/shared/**'],
    },
  },
  preview: {
    host: true,
    port: Number(process.env.WEB_PORT ?? 5173),
  },
  optimizeDeps: {
    // Don't pre-bundle/cache the workspace package — pick up its rebuilt
    // dist/ output immediately instead of a stale esbuild dep cache.
    exclude: ['@content-insights/shared'],
  },
});
