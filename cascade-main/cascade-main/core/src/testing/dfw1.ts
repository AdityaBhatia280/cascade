import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceDocument, type DocFormat, type SourceDocument, type Statement } from '../ingest/documents.js';
import { parserFor } from '../ingest/sources.js';

export const DFW1_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../seed/sites/dfw1');

const FORMATS: Record<string, DocFormat> = { '.csv': 'csv', '.json': 'json', '.txt': 'text' };

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** Loads every DFW1 document and runs the parser registry over it (test support; reads the seed). */
export function loadDfw1(): { documents: SourceDocument[]; statements: Statement[]; unparsed: string[]; skipped: number } {
  const docsDir = path.join(DFW1_DIR, 'docs');
  const documents: SourceDocument[] = [];
  const statements: Statement[] = [];
  const unparsed: string[] = [];
  let skipped = 0;
  for (const file of walk(docsDir)) {
    const format = FORMATS[path.extname(file)];
    if (!format) continue;
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(docsDir, file);
    const doc = sourceDocument({ path: rel, format, text });
    documents.push(doc);
    const parser = parserFor(doc);
    if (!parser) {
      unparsed.push(rel);
      continue;
    }
    const r = parser.parse(doc);
    statements.push(...r.statements);
    skipped += r.skipped.length;
  }
  return { documents, statements, unparsed, skipped };
}
