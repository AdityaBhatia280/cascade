import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-test-'));
process.env['CASCADE_DB_PATH'] = path.join(dir, 'cascade-db.json');
for (const key of ['RESEND_API_KEY', 'DEMO_INBOX', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_LLM_ID']) {
  process.env[key] = '';
}
