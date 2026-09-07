import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Process Edge routes live outside /api/v1 on the API server (spec
      // section 10.1) — proxied separately so the pairing page can call
      // POST /edge/v1/pair/confirm directly.
      '/edge': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4001',
        ws: true,
      },
    },
  },
});
