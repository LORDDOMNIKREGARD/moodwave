import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build` writes ./dist, which server.mjs serves. `npm run dev` proxies /api to the Node server.
export default defineConfig({
  base: './', // relative asset paths, so it works at a domain root or under /repo-name/ on GitHub Pages
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
