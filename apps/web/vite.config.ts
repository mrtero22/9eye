/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Local development only (decision 0002): localhost:4101, API proxied to localhost:4100.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 4101,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4100' },
  },
  preview: { host: '127.0.0.1', port: 4101, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
