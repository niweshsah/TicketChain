import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@ticketchain/shared': fileURLToPath(
        new URL('./src/contracts/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          state: ['@reduxjs/toolkit', 'react-redux'],
          validation: ['zod', '@js-temporal/polyfill'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 4175,
    strictPort: true,
    // Used only by the optional local integration-test stack.
    proxy: {
      '/auth/v1': {
        target: 'http://127.0.0.1:55441',
        rewrite: (path) => path.replace('/auth/v1', ''),
      },
      '/rest/v1': {
        target: 'http://127.0.0.1:55442',
        rewrite: (path) => path.replace('/rest/v1', ''),
      },
    },
  },
});
