// Append-only event log: the only persisted mutable state for a site. One JSONL file per site
// (data/<site>/events.jsonl). The log knows nothing about the domain: Workspace owns the payload type.
// Commercially the same records move to an append-only table behind this interface.

import { mkdir, open, readFile, truncate, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export interface LogRecord<P> {
  readonly seq: number;
  readonly at: string;
  readonly payload: P;
}

export interface EventLog<P> {
  /** Records present at open, in seq order. */
  readonly initial: readonly LogRecord<P>[];
  /** The torn final line dropped at open (crash mid-append), or null. */
  readonly tornTail: string | null;
  /** Seq the next append will receive. */
  nextSeq(): number;
  /** Appends one line and fsyncs before resolving. Single caller: the Workspace command queue. */
  append(at: string, payload: P): Promise<LogRecord<P>>;
  close(): Promise<void>;
}

class MalformedLog extends Error {}

function parseLine<P>(line: string, lineNo: number, expectedSeq: number): LogRecord<P> {
  const r = JSON.parse(line) as { seq?: unknown; at?: unknown; payload?: unknown };
  if (typeof r !== 'object' || r === null || r.seq !== expectedSeq || typeof r.at !== 'string' || typeof r.payload !== 'object' || r.payload === null) {
    throw new MalformedLog(`line ${lineNo}: expected a record with seq ${expectedSeq}`);
  }
  return r as LogRecord<P>;
}

/**
 * Opens (creating if needed) a JSONL log. A torn final line, the only shape a crash mid-append can
 * leave, is dropped and truncated away so later appends start on a clean line. Any other malformed
 * line throws: the log is the source of truth and is never silently repaired.
 */
export async function openJsonlLog<P>(file: string): Promise<EventLog<P>> {
  await mkdir(path.dirname(file), { recursive: true });
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const lastNewline = text.lastIndexOf('\n');
  const complete = text.slice(0, lastNewline + 1);
  const tail = text.slice(lastNewline + 1);
  const records: LogRecord<P>[] = [];
  const lines = complete.split('\n').slice(0, -1);
  lines.forEach((line, i) => {
    try {
      records.push(parseLine<P>(line, i + 1, records.length + 1));
    } catch (e) {
      throw new Error(`${file}: malformed event log at line ${i + 1}: ${(e as Error).message}`);
    }
  });
  let tornTail: string | null = null;
  if (tail.length > 0) {
    tornTail = tail;
    await truncate(file, Buffer.byteLength(complete, 'utf8'));
  }

  let handle: FileHandle | null = null;
  let seq = records.length;
  return {
    initial: records,
    tornTail,
    nextSeq: () => seq + 1,
    async append(at, payload) {
      handle ??= await open(file, 'a');
      const record: LogRecord<P> = { seq: seq + 1, at, payload };
      await handle.write(`${JSON.stringify(record)}\n`);
      await handle.sync();
      seq = record.seq;
      return record;
    },
    async close() {
      await handle?.close();
      handle = null;
    },
  };
}
