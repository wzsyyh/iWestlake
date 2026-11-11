import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173, watch: { usePolling: true, interval: 800 } },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, assetsInlineLimit: 0 },
});
