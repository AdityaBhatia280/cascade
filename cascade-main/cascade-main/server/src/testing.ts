// Test support: a DFW1 workspace on a temp log. The first call boots from an empty log (registers
// every seed document); later calls copy that log so each test starts from the same folded state.

import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTag, type FindingId, type FixGoal, type FixPlan } from '@cascade/core';
import { humanFrom, type HumanActor } from './actors.js';
import { openJsonlLog } from './log.js';
import { outboxMailer, type Mailer } from './mail.js';
import { Workspace, type LogEntry } from './workspace.js';

export const DFW1_SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../seed/sites/dfw1');

interface Subject { readonly kind: string; readonly tag: string }
/** The parts of the seed's planted ground truth that server tests check against. Tests only; the app never reads it. */
export const dfw1Truth = JSON.parse(readFileSync(path.join(DFW1_SITE_DIR, 'ground_truth.json'), 'utf8')) as {
  readonly defects: readonly { readonly id: string; readonly fix: { readonly onto: readonly Subject[] } }[];
  readonly conflicts: readonly { readonly entity: Subject; readonly field: string; readonly sources: readonly { readonly doc: string; readonly line: number }[] }[];
};
export const truthId = (s: Subject) => `${s.kind}:${normalizeTag(s.tag)}`;

let seeded: string | null = null;

export async function tempLogPath(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), 'cascade-test-')), 'events.jsonl');
}

/** The no-key transport, writing into an `outbox` folder next to the log. */
export const testOutbox = (file: string): Mailer => {
  const dir = path.join(path.dirname(file), 'outbox');
  return outboxMailer({ dir, shownAs: dir, reason: 'no email key', from: null, to: null });
};

export async function openAt(file: string, mailer: Mailer = testOutbox(file)): Promise<Workspace> {
  return Workspace.open({ site: 'dfw1', siteDir: DFW1_SITE_DIR, log: await openJsonlLog<LogEntry>(file), mailer });
}

/** A fresh DFW1 workspace and the path of its log. */
export async function dfw1(mailer?: (file: string) => Mailer): Promise<{ ws: Workspace; file: string }> {
  const file = await tempLogPath();
  if (seeded) await copyFile(seeded, file);
  const ws = await openAt(file, mailer?.(file));
  if (!seeded) {
    seeded = await tempLogPath();
    await copyFile(file, seeded);
  }
  return { ws, file };
}

export async function logLines(file: string): Promise<{ seq: number; payload: LogEntry }[]> {
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as { seq: number; payload: LogEntry });
}

export const human = (name = 'tester'): HumanActor => humanFrom({ header: (h) => (h === 'x-cascade-user' ? name : undefined) });

export function planFor(ws: Workspace, clear: FixGoal['clear']): FixPlan {
  const plans = ws.analysis().planFixes({ clear, maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'], alternatives: 3 });
  if (!plans[0]) throw new Error(`no plan for ${JSON.stringify(clear)}`);
  return plans[0];
}

export const D06: readonly FindingId[] = ['single-corded:cabinet:D06' as FindingId];
