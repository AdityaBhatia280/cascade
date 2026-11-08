import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { llmFromEnv } from './agent/llm.js';
import { apiRouter } from './api.js';
import { openJsonlLog } from './log.js';
import { mailerFromEnv } from './mail.js';
import { Workspace, type LogEntry } from './workspace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

const SITE = process.env['CASCADE_SITE'] ?? 'dfw1';
if (!/^[a-z0-9-]+$/.test(SITE)) throw new Error(`CASCADE_SITE must be a lowercase slug, got ${SITE}`);
const PORT = Number(process.env['DYNAMIC_PORT'] ?? 5002);
const HOST = '127.0.0.1';
const ORIGINS = (process.env['CASCADE_CORS_ORIGINS'] ?? 'http://localhost:5174,http://127.0.0.1:5174,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5001').split(',').map((s) => s.trim());

const DATA_DIR = path.resolve(ROOT, process.env['CASCADE_DATA_DIR'] ?? 'data');
const log = await openJsonlLog<LogEntry>(path.join(DATA_DIR, SITE, 'events.jsonl'));
if (log.tornTail) console.warn(`[cascade] dropped a torn final log line (${log.tornTail.length} bytes) left by an interrupted write`);
const outboxDir = path.join(DATA_DIR, SITE, 'outbox');
const inRepo = path.relative(ROOT, outboxDir);
const mailer = mailerFromEnv(process.env, { dir: outboxDir, shownAs: inRepo.startsWith('..') || path.isAbsolute(inRepo) ? outboxDir : inRepo });
const ws = await Workspace.open({ site: SITE, siteDir: path.join(ROOT, 'seed', 'sites', SITE), log, mailer });
const llm = llmFromEnv(process.env);

const app = express();
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter(ws, llm));

const server = app.listen(PORT, HOST, () => {
  const f = ws.analysis().facility;
  console.log(
    `[cascade] http://${HOST}:${PORT}/api  site=${SITE} revision=${f.revision} companion=${llm ? llm.model : 'intent table (no LLM key)'} email=${mailer.kind === 'resend' ? 'resend' : `outbox (not sent: ${process.env['RESEND_API_KEY'] ? 'NOTIFY_FROM/NOTIFY_TO missing' : 'no email key'})`}`,
  );
});

const shutdown = () => {
  server.close();
  server.closeAllConnections();
  void ws.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
