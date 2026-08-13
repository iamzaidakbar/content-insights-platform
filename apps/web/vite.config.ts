import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { analyzer } from 'vite-bundle-analyzer';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

// The app's own network calls go straight to the absolute VITE_API_URL (see
// lib/api-client.ts) — that's the tested, working path across both docker-compose and
// bare `vite dev`, and isn't changed here. This proxy is an additive dev convenience for
// anyone who wants to call a relative `/api/...` path instead (avoids CORS entirely, the
// standard Vite pattern) without needing to also flip api-client.ts's baseURL strategy.
// Points at the API's real port (API_PORT, default 4000) — this repo has never run the
// API on 3000.
const apiProxyTarget = `http://localhost:${process.env.API_PORT ?? 4000}`;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(appRoot, './src'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Writes a static treemap report instead of opening a live server/browser tab, so a
    // normal `vite build` never hangs waiting on a browser in headless/CI/docker
    // environments. Only runs when explicitly requested: `ANALYZE=true pnpm build`.
    analyzer({
      enabled: process.env.ANALYZE === 'true',
      analyzerMode: 'static',
      openAnalyzer: false,
      fileName: 'bundle-report',
    }),
  ],
  // Vite defaults to reading .env files only from this app's own root
  // (apps/web/.env, which doesn't exist). The real .env/.env.example live at
  // the monorepo root alongside every other service's env vars — point Vite
  // there instead of introducing a second, app-local .env convention.
  envDir: searchForWorkspaceRoot(process.cwd()),
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
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
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
    // Pre-bundle the CJS-heavy wordcloud stack so Vite serves a single ESM chunk.
    include: ['react-wordcloud'],
  },
  build: {
    // Matches the production chunk-size budget (see manualChunks below) — Vite's own
    // build warning now fires at the same threshold we're actually enforcing, instead of
    // its default 500kB (which would silently tolerate a chunk twice our real budget).
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        // Function form, not the object form — the object form matches on exact package
        // name and misses submodule entry points like `react-dom/client` (what
        // createRoot() actually resolves to), which left react-dom's ~350kB runtime
        // stuck in the main app chunk instead of being split out. Checking the resolved
        // module id's path catches every subpath of a package, not just its root import.
        // Only the React stack gets a forced bucket (react/react-dom/react-router-dom
        // together — splitting react-dom from react produced a genuine circular-chunk
        // warning from Rollup, since they're mutually interdependent at the module
        // level). Everything else is left to Rollup's own automatic chunking, which is
        // dependency-graph-aware and doesn't produce cycles the way hand-rolled buckets
        // for unrelated libraries (query/axios/toast) did here.
        manualChunks(id) {
          if (
            id.includes('/react-dom/') ||
            id.includes('/react-router-dom/') ||
            id.includes('/react-router/') ||
            id.includes('/scheduler/') ||
            /\/react\//.test(id)
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
