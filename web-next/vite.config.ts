import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 4928,
    host: '0.0.0.0',
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/pg': { target: 'http://localhost:3000', changeOrigin: true },
      '/v1': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@design': path.resolve(__dirname, '../design_file'),
    },
  },
});
