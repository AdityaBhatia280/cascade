import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The dev server listens on every address so localhost, 127.0.0.1 and ::1 all work, but only this machine may use it. */
function localOnly(): Plugin {
  return {
    name: 'local-only',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (LOOPBACK.has(req.socket.remoteAddress ?? '')) return next();
        res.statusCode = 403;
        res.end('Cascade dev server accepts local connections only');
      });
    },
  };
}

export default defineConfig({
  plugins: [localOnly(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Dual-stack: 127.0.0.1, ::1 and localhost all reach it; localOnly() turns away other machines.
    host: '::',
    proxy: Object.fromEntries(
      ['/api', '/dynamic-api', '/dynamic-app'].map((prefix) => [prefix, { target: 'http://127.0.0.1:5001', changeOrigin: true }]),
    ),
  },
});
