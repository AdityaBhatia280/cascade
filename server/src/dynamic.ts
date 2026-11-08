import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cascade-main/cascade-main');
const DIST = path.join(APP_DIR, 'frontend/dist');
const PORT = Number(process.env['DYNAMIC_PORT'] ?? 5002);
const RESTART_DELAY_MS = 2000;

/**
 * Mounts the embedded 3D site app on this server: its built frontend at /dynamic-app/ and its API at
 * /dynamic-api/*, streamed to its own server on 127.0.0.1:DYNAMIC_PORT so SSE and multipart uploads pass
 * through unbuffered. Mount before any body parser: the proxy pipes the raw request body.
 */
export function mountDynamicApp(app: Express): void {
  app.use('/dynamic-api', (req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: PORT, method: req.method, path: `/api${req.url}`, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else res.status(502).json({ error: 'The 3D site server is not running' });
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });

  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.warn(`[dynamic] ${DIST} is missing; run \`npm run build:dynamic\` to serve /dynamic-app/`);
  }
  app.use('/dynamic-app', express.static(DIST));
  app.get('/dynamic-app/*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

/** Runs the embedded app's server for as long as this process lives, restarting it whenever it exits. Returns stop. */
export function superviseDynamicServer(): () => void {
  if (!fs.existsSync(path.join(APP_DIR, 'node_modules'))) {
    console.warn(`[dynamic] ${APP_DIR} has no node_modules; run \`npm install\` at the repo root`);
    return () => {};
  }
  let stopping = false;
  let kill = () => {};

  const start = () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: path.join(APP_DIR, 'server'),
      env: { ...process.env, DYNAMIC_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    kill = () => child.kill('SIGTERM');
    readline.createInterface({ input: child.stdout }).on('line', (l) => console.log(`[dynamic] ${l}`));
    readline.createInterface({ input: child.stderr }).on('line', (l) => console.error(`[dynamic] ${l}`));
    child.on('error', (err) => console.error(`[dynamic] ${err.message}`));
    child.on('exit', (code, signal) => {
      if (stopping) return;
      console.warn(`[dynamic] exited (${signal ?? code}); restarting in ${RESTART_DELAY_MS / 1000}s`);
      setTimeout(start, RESTART_DELAY_MS);
    });
  };

  start();
  return () => {
    stopping = true;
    kill();
  };
}
