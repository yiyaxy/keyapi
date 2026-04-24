import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// const baseTarget = "https://token.cymoon.cn/"

const baseTarget = "http://localhost:3000"

export default defineConfig({
  server: {
    port: 4928,
    host: '0.0.0.0',
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': { target: baseTarget, changeOrigin: true },
      '/pg': { target: baseTarget, changeOrigin: true },
      '/v1': { target: baseTarget, changeOrigin: true },
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
