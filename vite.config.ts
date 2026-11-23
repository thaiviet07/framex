import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

function gitSha(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  plugins: [],
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __APP_COMMIT__: JSON.stringify(gitSha()),
  },
  build: {
    target: 'es2022',
    // Source maps are useful locally (`npm run build:debug`) but must not ship publicly.
    sourcemap: process.env.SOURCEMAP === 'true',
    // Heavy export libs (pdf-lib, fflate, mp4-muxer) are split via dynamic import().
    chunkSizeWarningLimit: 600,
    reportCompressedSize: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        portal: resolve(import.meta.dirname, 'portal.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/share': 'http://127.0.0.1:8787',
    },
  },
});
