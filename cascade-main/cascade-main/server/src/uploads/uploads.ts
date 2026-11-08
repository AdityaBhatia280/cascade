// Upload batches: files a user dropped, read and ingested one at a time so the model grows file by
// file. Each file moves through one state machine (queued → reading → classified → ingested, or
// rejected from reading or classified), and every move is announced as an `upload-file` event.
//
// A batch runs in two passes. Reading (several files at once when a model is configured): extract the
// text, decide the kind, and for a contract have the model read its terms, checked against the text.
// Ingesting (one file at a time, in UPLOAD_KIND_SPECS order): register the document, which folds it
// into the model and announces `model-changed`. Batches run one after another. The files are kept
// under the site's data directory; batch progress lives in memory.

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkReading, classifyByRules, readsAs, renameColumns, sourceDocument, uploadSummary, UPLOAD_KIND_SPECS, type ContractReading, type DocFormat, type SourceDocument } from '@cascade/core';
import type { ServerEventDto, UploadBatchDto, UploadFileDto, UploadKind, UploadStatus } from '@cascade/core/contract';
import { nameOf, type HumanActor } from '../actors.js';
import type { Workspace } from '../workspace.js';
import { pdfText } from './pdf.js';
import type { Reader } from './reader.js';

export interface UploadedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

type UploadEvent = Extract<ServerEventDto, { type: 'upload-file' | 'upload-done' }>;

const NEXT: { readonly [S in UploadStatus]: readonly UploadStatus[] } = {
  queued: ['reading', 'rejected'],
  reading: ['classified', 'rejected'],
  classified: ['ingested', 'rejected'],
  ingested: [],
  rejected: [],
};

const FORMATS: Readonly<Record<string, DocFormat>> = { '.csv': 'csv', '.json': 'json', '.txt': 'text', '.pdf': 'pdf' };
const EXCERPT_LINES = 60;
const EXCERPT_CHARS = 6000;

interface FileWork {
  readonly index: number;
  dto: UploadFileDto;
  bytes: Uint8Array | null;
  doc: SourceDocument | null;
  reading: ContractReading | null;
}

interface Batch {
  readonly id: string;
  readonly by: HumanActor;
  files: FileWork[];
  done: boolean;
  readonly settled: Promise<UploadBatchDto>;
}

const isContract = (k: UploadKind) => k === 'contract-msa' || k === 'contract-order-form';

/** A file name safe to keep on disk and to register as a document path. */
function safeName(raw: string, taken: Set<string>): string {
  const base = path.basename(raw.replace(/\\/g, '/')).replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '') || 'file';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = base.replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
  taken.add(name.toLowerCase());
  return name;
}

async function pool<T>(items: readonly T[], width: number, work: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

export class Uploads {
  private readonly batches = new Map<string, Batch>();
  private readonly byKey = new Map<string, string>();
  private readonly listeners = new Set<(e: UploadEvent) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: { readonly ws: Workspace; readonly reader: Reader | null; readonly dir: string }) {}

  /** Stores the files, queues the batch, and returns it with every file `queued`. A repeated key returns the first batch. */
  async start(files: readonly UploadedFile[], by: HumanActor, key: string): Promise<UploadBatchDto> {
    const prior = this.byKey.get(key);
    if (prior) return this.dto(this.batches.get(prior)!);
    const id = `B-${randomUUID().slice(0, 8)}`;
    const taken = new Set<string>();
    const work: FileWork[] = files.map((f, index) => {
      const name = safeName(f.name, taken);
      return { index, bytes: f.bytes, doc: null, reading: null, dto: { id: `${id}:${index + 1}`, name, kind: 'unknown', status: 'queued', title: name, detail: '', customer: null, reason: null } };
    });
    const dir = path.join(this.opts.dir, id);
    await mkdir(dir, { recursive: true });
    for (const f of work) await writeFile(path.join(dir, f.dto.name), f.bytes!);
    let settle!: (b: UploadBatchDto) => void;
    const batch: Batch = { id, by, files: work, done: false, settled: new Promise((r) => (settle = r)) };
    this.batches.set(id, batch);
    this.byKey.set(key, id);
    const run = () => this.run(batch).then(() => settle(this.dto(batch)));
    this.queue = this.queue.then(run, run);
    return this.dto(batch);
  }

  get(batchId: string): UploadBatchDto | null {
    const b = this.batches.get(batchId);
    return b ? this.dto(b) : null;
  }

  /** Resolves when every file in the batch is ingested or rejected. */
  settled(batchId: string): Promise<UploadBatchDto> | null {
    return this.batches.get(batchId)?.settled ?? null;
  }

  subscribe(listener: (e: UploadEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ───────────── the batch ─────────────

  private async run(batch: Batch): Promise<void> {
    try {
      await pool(batch.files, this.opts.reader ? 4 : 1, (f) => this.read(f, batch));
      batch.files = [...batch.files].sort((a, b) => UPLOAD_KIND_SPECS[a.dto.kind].order - UPLOAD_KIND_SPECS[b.dto.kind].order || a.index - b.index);
      for (const f of batch.files) if (f.dto.status === 'classified') await this.ingest(f, batch);
    } catch (e) {
      console.error(`[cascade] upload ${batch.id} failed`, e);
      for (const f of batch.files) if (NEXT[f.dto.status].includes('rejected')) this.move(f, batch, { status: 'rejected', reason: 'Cascade hit an internal error reading this file' });
    }
    batch.done = true;
    this.emit({ type: 'upload-done', batchId: batch.id, revision: this.opts.ws.revision() });
  }

  private async read(f: FileWork, batch: Batch): Promise<void> {
    this.move(f, batch, { status: 'reading' });
    const reject = (reason: string) => this.move(f, batch, { status: 'rejected', reason });
    const format = FORMATS[path.extname(f.dto.name).toLowerCase()];
    const bytes = f.bytes!;
    f.bytes = null;
    if (!format) return reject('Cascade reads CSV, JSON, text and PDF files');
    let text: string;
    try {
      text = format === 'pdf' ? await pdfText(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return reject(format === 'pdf' ? 'the PDF could not be opened' : 'the file is not UTF-8 text');
    }
    if (text.trim() === '') return reject(format === 'pdf' ? 'the PDF has no text layer (a scan?), so there is nothing to read' : 'the file is empty');
    const decided = await this.classify(sourceDocument({ path: f.dto.name, format, text }));
    if (decided.kind === 'unknown') return reject(decided.why);
    f.doc = decided.doc;
    if (isContract(decided.kind)) f.reading = await this.readContract(decided.doc);
    const customer = f.reading?.customerName ?? null;
    const spec = UPLOAD_KIND_SPECS[decided.kind];
    this.move(f, batch, { status: 'classified', kind: decided.kind, title: customer ? `${spec.title} · ${customer}` : spec.title, customer });
  }

  /**
   * The model's kind when that kind's parser reads the file, else the rules' kind when its parser does.
   * A CSV whose headers differ may be read after a model-proposed mapping whose every header exists.
   */
  private async classify(doc: SourceDocument): Promise<{ kind: Exclude<UploadKind, 'unknown'>; doc: SourceDocument } | { kind: 'unknown'; why: string }> {
    const reader = this.opts.reader;
    const rules = classifyByRules(doc);
    let model: UploadKind | null = null;
    if (reader) {
      const excerpt = doc.text.split(/\r?\n/, EXCERPT_LINES).join('\n').slice(0, EXCERPT_CHARS);
      model = await reader.classify(doc.path, excerpt).catch((e: unknown) => (console.warn(`[cascade] upload ${doc.path}: classification failed: ${(e as Error).message}`), null));
    }
    const candidates = [...new Set([model, rules])].filter((k): k is Exclude<UploadKind, 'unknown'> => k !== null && k !== 'unknown');
    const log = (kind: UploadKind) => console.log(`[cascade] upload ${doc.path}: model=${reader ? (model ?? 'no answer') : 'none'} rules=${rules} -> ${kind}`);
    for (const kind of candidates) {
      if (!readsAs(kind, doc)) continue;
      log(kind);
      return { kind, doc };
    }
    for (const kind of candidates) {
      const columns = UPLOAD_KIND_SPECS[kind].columns;
      if (!reader || !columns || doc.format !== 'csv') continue;
      const header = (doc.text.split(/\r?\n/, 1)[0] ?? '').split(',').map((h) => h.trim());
      const mapping = await reader.mapColumns(doc.path, UPLOAD_KIND_SPECS[kind].title, columns, header).catch(() => null);
      const renamed = mapping ? renameColumns(doc, kind, mapping) : null;
      if (renamed && readsAs(kind, renamed)) {
        log(kind);
        console.log(`[cascade] upload ${doc.path}: read with mapped columns ${JSON.stringify(mapping)}`);
        return { kind, doc: renamed };
      }
    }
    log('unknown');
    const named = candidates[0];
    return { kind: 'unknown', why: named ? `its columns do not match a ${UPLOAD_KIND_SPECS[named].title.toLowerCase()} export` : 'Cascade does not recognize it as one of the site exports or contracts it reads' };
  }

  /** The model's reading of a contract, checked against its text; without a model, none (the parser reads it). */
  private async readContract(doc: SourceDocument): Promise<ContractReading | null> {
    const reader = this.opts.reader;
    if (!reader) return null;
    try {
      const checked = checkReading(doc, await reader.readContract(doc.path, doc.text));
      const kept = Object.keys(checked.reading);
      console.log(`[cascade] upload ${doc.path}: contract fields kept [${kept.join(', ')}] dropped [${checked.dropped.map((d) => `${d.field}: ${d.why}`).join('; ')}]`);
      return kept.length > 0 ? checked.reading : null;
    } catch (e) {
      console.warn(`[cascade] upload ${doc.path}: contract reading failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async ingest(f: FileWork, batch: Batch): Promise<void> {
    const doc = f.doc!;
    const r = await this.opts.ws.register({ path: doc.path, format: doc.format, text: doc.text, reading: f.reading }, nameOf(batch.by), `upload:${f.dto.id}`);
    if (!r.ok) {
      this.move(f, batch, { status: 'rejected', reason: r.message });
      return;
    }
    const s = uploadSummary(f.dto.kind, doc, f.reading, this.opts.ws.analysis('documented').facility);
    this.move(f, batch, { status: 'ingested', title: s.title, detail: s.detail, customer: s.customer });
  }

  // ───────────── state ─────────────

  private move(f: FileWork, batch: Batch, change: Partial<UploadFileDto> & { readonly status: UploadStatus }): void {
    if (!NEXT[f.dto.status].includes(change.status)) throw new Error(`upload ${f.dto.id}: ${f.dto.status} cannot become ${change.status}`);
    f.dto = { ...f.dto, ...change };
    this.emit({ type: 'upload-file', batchId: batch.id, file: f.dto });
  }

  private emit(e: UploadEvent): void {
    for (const l of this.listeners) l(e);
  }

  private dto(b: Batch): UploadBatchDto {
    return { batchId: b.id, files: b.files.map((f) => f.dto), done: b.done };
  }
}
