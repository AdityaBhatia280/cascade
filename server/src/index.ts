import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { seedPortfolio } from './services/portfolio.js';
import { startTelemetryLoop } from './services/telemetry.js';
import { startRetellCallSyncLoop } from './services/actions.js';
import { store } from './db/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../../Frontend/dist');

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRouter);

// Serve compiled Frontend SPA in production if Frontend/dist exists
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      app: 'Cascade Operations Center',
      version: '1.0.0',
      endpoints: {
        graph: '/api/graph',
        findings: '/api/findings',
        telemetry: '/api/telemetry/stream',
        simulate: '/api/simulate',
        agent: '/api/agent/run',
        eval: '/api/eval',
      },
    });
  });
}

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`[Cascade Server] Listening on http://127.0.0.1:${config.port}`);
  try {
    console.log('[Cascade Server] Initializing portfolio seed data...');
    const summary = await seedPortfolio();
    store.loadFromDisk();
    console.log(`[Cascade Server] Seed complete: ${summary.nodes} nodes, ${summary.edges} edges, ${summary.findings} findings`);
    startTelemetryLoop();
    startRetellCallSyncLoop();
    console.log('[Cascade Server] Telemetry stream & Retell live call sync active');
  } catch (err) {
    console.warn('[Cascade Server] Auto-seed warning:', err);
  }
});

