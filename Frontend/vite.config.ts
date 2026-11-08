import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 'localhost' covers both 127.0.0.1 and ::1, so browsers that try IPv6 first (Safari) still connect.
    host: 'localhost',
    proxy: Object.fromEntries(
      ['/api', '/dynamic-api', '/dynamic-app'].map((prefix) => [prefix, { target: 'http://127.0.0.1:5001', changeOrigin: true }]),
    ),
  },
});
