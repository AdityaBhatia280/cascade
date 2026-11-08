// Workspace: the single stateful module for one site. It owns the event log (sole writer) and
// derives everything else from it:
//   records ──assemble──▶ documented Facility (completed proposals are as built)
//           ──applyPatch over applied proposals, in order──▶ planned Facility (stale ones derived)
//           ──analyze(view facility)──▶ Analysis (memoized per state)
//
// Commands run through one serial queue. Each command folds its candidate entry into a NEW state,
// computes its result from that state, appends entry + result to the log (fsync), and only then
// swaps the state in. A crash before the append leaves nothing behind; a torn line is dropped at
// open. Every command carries an idempotency key: a repeated key replays the recorded result.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  analyze, assemble, assessWorkOrders, contractStatements, entityHistory, historyOf, maintenanceNotices, parserFor, shiftHandoff, siteId, sourceDocument, workOrdersOf,
  type AnyId, type EntityHistory, type HandoffBrief, type HistoryWindow, type LocalDateTime, type NoticeSet, type SiteHistory,
  type Analysis, type AssemblyIssue, type CompletedChange, type DocFormat, type Facility, type FixPlan, type Revision, type SourceDocument,
  type ContractReading, type Statement, type WorkOrder,
} from '@cascade/core';
import { applyPatch } from '@cascade/core';
import type { MessageKind, ModelView } from '@cascade/core/contract';
import { isMintedHuman, nameOf, type Actor, type HumanActor, type HumanName, type SystemActor } from './actors.js';
import type { EventLog } from './log.js';
import type { Delivery, Mailer } from './mail.js';
import { applyEvent, gate, type Proposal, type ProposalCommand, type ProposalEvent, type ProposalId } from './proposals.js';

declare const MID: unique symbol;
export type MessageId = string & { readonly [MID]: true };

/** A message a human approved, and what became of it. */
export interface SentMessage {
  readonly id: MessageId;
  readonly kind: MessageKind;
  readonly ref: string;
  readonly contentHash: string;
  readonly subject: string;
  readonly intendedFor: string;
  readonly approvedBy: HumanName;
  readonly at: string;
  readonly delivery: Delivery;
}

/** What to send, computed by the caller from the current records; `blocked` refuses it. */
export interface MessageDraft {
  readonly kind: MessageKind;
  readonly ref: string;
  readonly contentHash: string;
  readonly subject: string;
  readonly text: string;
  readonly intendedFor: string;
  readonly blocked: string | null;
}

export interface IngestReport {
  readonly doc: string;
  readonly via: 'parser' | 'unparsed';
  readonly valuesRead: number;
  readonly valuesRejected: number;
  readonly revision: Revision;
}

export type ErrorCode =
  | 'bad-request' | 'not-found' | 'forbidden' | 'idempotency-key-reused'
  | 'stale' | 'introduces-findings' | 'not-pending' | 'not-applied' | 'conflict' | 'blocked';

export type CommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

export type WorkspaceEvent =
  | { readonly type: 'model-changed'; readonly revision: Revision }
  | { readonly type: 'proposal-changed'; readonly id: ProposalId };

/** What one log line records. One command appends at most one event. */
export type DomainEvent =
  | {
      readonly type: 'document-registered';
      readonly path: string;
      readonly format: DocFormat;
      readonly sha256: string;
      /** The document text itself (a PDF's text layer), so the model re-folds the same after the file on disk changes. */
      readonly text: string;
      /** A model's checked reading of a contract, recorded because a model is not deterministic. */
      readonly reading?: ContractReading;
    }
  /** Empties the site: no documents, no proposals, no messages. Earlier entries stay in the log. */
  | { readonly type: 'site-reset' }
  | { readonly type: 'proposal-submitted'; readonly id: ProposalId; readonly plan: FixPlan; readonly rationale: string }
  | ProposalEvent
  | {
      readonly type: 'message-sent';
      readonly id: MessageId;
      readonly kind: MessageKind;
      readonly ref: string;
      readonly contentHash: string;
      readonly subject: string;
      /** The words as approved and handed to the transport. */
      readonly text: string;
      readonly intendedFor: string;
      readonly delivery: Delivery;
    };

export interface LogEntry {
  readonly actor: Actor | SystemActor;
  readonly key: string;
  readonly fingerprint: string;
  readonly event: DomainEvent;
  readonly result: CommandResult<unknown>;
}

interface Recorded {
  readonly fingerprint: string;
  readonly result: CommandResult<unknown>;
}

/** One registered version of a document, with the checked model reading it was registered with. */
interface Registered {
  readonly doc: SourceDocument;
  readonly reading: ContractReading | null;
}

/** A document to register: its text (a PDF's text layer) and, for a contract, a model's checked reading. */
export interface DocumentInput {
  readonly path: string;
  readonly format: DocFormat;
  readonly text: string;
  readonly reading: ContractReading | null;
}

interface Records {
  /** Every registered version, in registration order (the last per path is current). */
  readonly documents: readonly Registered[];
  readonly proposals: ReadonlyMap<ProposalId, Proposal>;
  /** Proposal ids in the order they were applied. */
  readonly applied: readonly ProposalId[];
  readonly completed: readonly ProposalId[];
  readonly messages: ReadonlyMap<MessageId, SentMessage>;
  readonly results: ReadonlyMap<string, Recorded>;
}

interface State {
  readonly records: Records;
  readonly documented: Facility;
  readonly planned: Facility;
  readonly issues: readonly AssemblyIssue[];
  /** CMMS work orders, joined to the documented model. Records, not facts: they never enter assembly. */
  readonly workOrders: readonly WorkOrder[];
  /** BMS and power monitoring events and trends, joined to the documented model. Records, not facts. */
  readonly history: SiteHistory;
  /** Applied proposals whose patch no longer applies to the planned model (derived, not logged). */
  readonly derivedStale: ReadonlyMap<ProposalId, string>;
  readonly analyses: Map<string, Analysis>;
}

const EMPTY: Records = {
  documents: [],
  proposals: new Map(),
  applied: [],
  completed: [],
  messages: new Map(),
  results: new Map(),
};

const FORMATS: Readonly<Record<string, DocFormat>> = { '.csv': 'csv', '.json': 'json', '.txt': 'text' };

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const fingerprintOf = (command: string, args: unknown) => `${command}:${createHash('sha256').update(canonicalJson(args)).digest('hex').slice(0, 24)}`;

const ok = <T>(value: T): CommandResult<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): CommandResult<never> => ({ ok: false, code, message });

const opsKey = (plan: FixPlan) => canonicalJson(plan.patch.ops);

// ───────────────────────────── fold ─────────────────────────────

const parseMemo = new Map<string, readonly Statement[]>();

/** Parser output is re-derived from the document at fold time (deterministic, never logged); a recorded reading adds to it. */
function parsedStatements(r: Registered): readonly Statement[] {
  const key = r.reading ? `${r.doc.id}:${canonicalJson(r.reading)}` : r.doc.id;
  let statements = parseMemo.get(key);
  if (!statements) {
    statements = contractStatements(r.doc, r.reading);
    parseMemo.set(key, statements);
  }
  return statements;
}

/** The current version of each path, in the order paths were first registered. */
const currentDocuments = (documents: readonly Registered[]): Registered[] => [...new Map(documents.map((d) => [d.doc.path, d])).values()];

function reduce(r: Records, seq: number, at: string, entry: LogEntry): Records {
  const results = new Map(r.results).set(entry.key, { fingerprint: entry.fingerprint, result: entry.result });
  const e = entry.event;
  const actor = entry.actor;
  switch (e.type) {
    case 'document-registered': {
      const doc = sourceDocument({ path: e.path, format: e.format, text: e.text });
      if (doc.sha256 !== e.sha256) throw new Error(`log seq ${seq}: document ${e.path} text does not match its recorded sha256`);
      return { ...r, results, documents: [...r.documents, { doc, reading: e.reading ?? null }] };
    }
    case 'site-reset':
      return { ...EMPTY, results };
    case 'proposal-submitted': {
      if (actor.kind === 'system') throw new Error(`log seq ${seq}: system actor cannot submit`);
      const p: Proposal = {
        id: e.id,
        plan: e.plan,
        rationale: e.rationale,
        submittedBy: actor,
        submittedAt: at,
        state: { status: 'pending' },
        history: [{ status: 'pending', by: actor, at, note: e.rationale }],
      };
      return { ...r, results, proposals: new Map(r.proposals).set(e.id, p) };
    }
    case 'proposal-applied':
    case 'proposal-rejected':
    case 'proposal-stale':
    case 'proposal-completed': {
      if (actor.kind !== 'human') throw new Error(`log seq ${seq}: only a human can decide a proposal`);
      const p = r.proposals.get(e.id);
      if (!p) throw new Error(`log seq ${seq}: unknown proposal ${e.id}`);
      const next = applyEvent(p, e, at, { kind: 'human', name: actor.name });
      if (next === p) return { ...r, results };
      return {
        ...r,
        results,
        proposals: new Map(r.proposals).set(e.id, next),
        applied: next.state.status === 'applied' ? [...r.applied, e.id] : r.applied,
        completed: next.state.status === 'completed' ? [...r.completed, e.id] : r.completed,
      };
    }
    case 'message-sent': {
      if (actor.kind !== 'human') throw new Error(`log seq ${seq}: only a human can approve sending a message`);
      const { type: _t, text: _text, ...m } = e;
      return { ...r, results, messages: new Map(r.messages).set(e.id, { ...m, approvedBy: { kind: 'human', name: actor.name }, at }) };
    }
  }
}

function derive(site: string, records: Records): State {
  const completed: CompletedChange[] = records.completed.map((id) => {
    const p = records.proposals.get(id)!;
    const s = p.state as Extract<Proposal['state'], { status: 'completed' }>;
    return { proposalId: id, ops: p.plan.patch.ops, at: s.at };
  });
  const { facility: documented, issues } = assemble({ site: siteId(site), statements: currentDocuments(records.documents).flatMap(parsedStatements), completed });
  let planned = documented;
  const derivedStale = new Map<ProposalId, string>();
  for (const id of records.applied) {
    const p = records.proposals.get(id)!;
    if (p.state.status !== 'applied') continue;
    const r = applyPatch(planned, p.plan.patch, id);
    if (r.ok) planned = r.facility;
    else derivedStale.set(id, `patch no longer applies to the planned model: ${r.conflicts.map((c) => `${c.op.op} ${c.kind === 'precondition' ? `${c.ref} ${c.reason}` : c.reason}`).join('; ')}`);
  }
  const docs = records.documents.map((d) => d.doc);
  return { records, documented, planned, issues, workOrders: workOrdersOf(docs, documented), history: historyOf(docs, documented), derivedStale, analyses: new Map() };
}

type CommandStep<T> =
  | { readonly result: CommandResult<T> }
  | {
      readonly event: DomainEvent;
      readonly result: (next: State) => CommandResult<T>;
    };

// ───────────────────────────── the module ─────────────────────────────

export class Workspace {
  private state: State;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(e: WorkspaceEvent) => void>();

  private constructor(
    private readonly site: string,
    private readonly log: EventLog<LogEntry>,
    private readonly mailer: Mailer,
  ) {
    let records = EMPTY;
    for (const rec of log.initial) records = reduce(records, rec.seq, rec.at, rec.payload);
    this.state = derive(site, records);
  }

  /**
   * Folds the log, then (unless `syncDocs` is false) registers every document under `<siteDir>/docs`
   * whose current bytes are not the latest registered version of its path (first boot: all of them;
   * later: changed files). With `syncDocs: false` the site holds only what the log holds.
   */
  static async open(opts: { readonly site: string; readonly siteDir: string; readonly log: EventLog<LogEntry>; readonly mailer: Mailer; readonly syncDocs?: boolean }): Promise<Workspace> {
    const ws = new Workspace(opts.site, opts.log, opts.mailer);
    if (opts.syncDocs === false) return ws;
    const docsDir = path.join(opts.siteDir, 'docs');
    const sync: SystemActor = { kind: 'system', name: 'docs-sync' };
    for (const rel of await walk(docsDir)) {
      const format = FORMATS[path.extname(rel)];
      if (!format) continue;
      const text = await readFile(path.join(docsDir, rel), 'utf8');
      const sha = sourceDocument({ path: rel, format, text }).sha256;
      if (ws.latest(rel)?.sha256 === sha) continue;
      const r = await ws.register({ path: rel, format, text, reading: null }, sync, `docs-sync:${rel}:${sha}:${ws.log.nextSeq()}`);
      if (!r.ok) throw new Error(`boot: could not register ${rel}: ${r.message}`);
    }
    return ws;
  }

  // ───────────── reads ─────────────

  get siteId(): string {
    return this.site;
  }

  analysis(view: ModelView = 'planned'): Analysis {
    let an = this.state.analyses.get(view);
    if (!an) {
      an = analyze(view === 'planned' ? this.state.planned : this.state.documented);
      this.state.analyses.set(view, an);
    }
    return an;
  }

  issues(): readonly AssemblyIssue[] {
    return this.state.issues;
  }

  /** Every work order in the current CMMS exports, in schedule order. */
  workOrders(): readonly WorkOrder[] {
    return this.state.workOrders;
  }

  /** Every BMS and power monitoring event and trend series, joined to the documented model. */
  siteHistory(): SiteHistory {
    return this.state.history;
  }

  /** One documented entity's operating history in a window: events, work orders and trends. */
  history(entity: AnyId, window: HistoryWindow): EntityHistory {
    return entityHistory(this.state.history, this.state.workOrders, this.state.documented, entity, window);
  }

  /** Notices for one work order, one per customer, issued `asOf`. null when no work order has that number. */
  notices(wonum: string, asOf: LocalDateTime): NoticeSet | null {
    const all = this.state.workOrders;
    const order = all.find((o) => o.wonum === wonum);
    if (!order) return null;
    const an = this.analysis('documented');
    return maintenanceNotices(an, assessWorkOrders(an, [order], all)[0]!, all, asOf);
  }

  /** The shift handoff brief at one site-local time, on the as-built (documented) model. */
  handoff(at: LocalDateTime): HandoffBrief {
    return shiftHandoff(this.analysis('documented'), { workOrders: this.state.workOrders, history: this.state.history, at });
  }

  /** Every approved message, oldest first. */
  messages(): readonly SentMessage[] {
    return [...this.state.records.messages.values()];
  }

  /** Proposals with derived staleness applied: an applied patch that no longer applies reads as stale. */
  proposals(): readonly Proposal[] {
    return [...this.state.records.proposals.values()].map((p) => this.effective(p));
  }

  proposal(id: string): Proposal | null {
    const p = this.state.records.proposals.get(id as ProposalId);
    return p ? this.effective(p) : null;
  }

  /** The current model revision (planned view). */
  revision(): Revision {
    return this.state.planned.revision;
  }

  /** How many documents the site holds (the current version of each path). */
  documentCount(): number {
    return currentDocuments(this.state.records.documents).length;
  }

  // ───────────── commands ─────────────

  /**
   * Registers a document. The same path, text and reading as the latest version returns the existing
   * report; anything new registers a new version that replaces the old one.
   */
  async register(input: DocumentInput, by: Actor | SystemActor, key: string): Promise<CommandResult<IngestReport>> {
    const doc = sourceDocument({ path: input.path, format: input.format, text: input.text });
    const reading = input.reading && Object.keys(input.reading).length > 0 ? input.reading : null;
    return this.command(key, fingerprintOf('register', { path: doc.path, sha256: doc.sha256, reading }), by, (s) => {
      const latest = this.latestRegistered(doc.path, s);
      if (latest?.doc.sha256 === doc.sha256 && canonicalJson(latest.reading) === canonicalJson(reading)) return { result: ok(this.report(s, latest)) };
      return {
        event: { type: 'document-registered', path: doc.path, format: doc.format, sha256: doc.sha256, text: doc.text, ...(reading ? { reading } : {}) },
        result: (next) => ok(this.report(next, next.records.documents.at(-1)!)),
      };
    });
  }

  /** Empties the site. Already empty: no event, the current revision. */
  async reset(by: Actor, key: string): Promise<CommandResult<{ revision: Revision }>> {
    return this.command(key, fingerprintOf('reset', {}), by, (s) => {
      const r = s.records;
      if (r.documents.length === 0 && r.proposals.size === 0 && r.messages.size === 0) return { result: ok({ revision: s.planned.revision }) };
      return { event: { type: 'site-reset' }, result: (next) => ok({ revision: next.planned.revision }) };
    });
  }

  /**
   * Submits a planner plan for human approval. Re-verifies against the CURRENT planned model and
   * stores the re-verified delta, never the caller's. Refuses a plan that no longer applies or
   * introduces findings. Re-submitting the ops of a pending/applied proposal returns it.
   */
  async submit(plan: FixPlan, rationale: string, by: Actor, key: string): Promise<CommandResult<Proposal>> {
    return this.command(key, fingerprintOf('submit', { ops: plan.patch.ops, base: plan.patch.base, rationale }), by, (s) => {
      const same = [...s.records.proposals.values()].find((p) => opsKey(p.plan) === opsKey(plan) && (p.state.status === 'pending' || p.state.status === 'applied'));
      if (same) return { result: ok(this.effective(same, s)) };
      const id = `P-${this.log.nextSeq()}` as ProposalId;
      const v = this.analysis('planned').verify(plan.patch, id);
      if (!v.ok) return { result: fail('stale', `plan no longer applies: ${v.conflicts.join('; ')}`) };
      const delta = v.delta!;
      if (delta.introduced.length > 0) return { result: fail('introduces-findings', `plan introduces findings: ${delta.introduced.join(', ')}`) };
      const verified: FixPlan = { ...plan, cleared: delta.cleared, introduced: delta.introduced, untouched: delta.persisted };
      return { event: { type: 'proposal-submitted', id, plan: verified, rationale }, result: (next) => ok(next.records.proposals.get(id)!) };
    });
  }

  /** Human-only. The pure gate decides; approval re-verifies against the planned model without this proposal. */
  async decide(id: ProposalId, cmd: ProposalCommand, by: HumanActor, key: string): Promise<CommandResult<Proposal>> {
    if (!isMintedHuman(by)) return fail('forbidden', 'only a human can decide a proposal');
    return this.command(key, fingerprintOf('decide', { id, cmd }), nameOf(by), (s) => {
      const stored = s.records.proposals.get(id);
      if (!stored) return { result: fail('not-found', `no such proposal: ${id}`) };
      const p = this.effective(stored, s);
      const g = gate(p, cmd, () => this.analysis('planned').verify(p.plan.patch, p.id));
      switch (g.kind) {
        case 'noop':
          return { result: ok(p) };
        case 'refuse':
          return { result: fail(g.refuse.code, g.refuse.message) };
        case 'append': {
          const refusal = g.refuse;
          return {
            event: g.event,
            result: (next) => (refusal ? fail(refusal.code, refusal.message) : ok(this.effective(next.records.proposals.get(id)!, next))),
          };
        }
      }
    });
  }

  /**
   * Human-only. Sends a message the caller computed from the current records, once: the same words for
   * the same ref that already went out (or, with no email key, already sit in the outbox) return the
   * earlier record instead of sending again. Delivery runs inside the command queue, so two approvals
   * of one message cannot both send.
   */
  async send(draft: MessageDraft, by: HumanActor, key: string): Promise<CommandResult<SentMessage>> {
    if (!isMintedHuman(by)) return fail('forbidden', 'only a human can approve sending a message');
    return this.command(key, fingerprintOf('send', { ref: draft.ref, contentHash: draft.contentHash }), nameOf(by), async (s) => {
      if (draft.blocked) return { result: fail('blocked', draft.blocked) };
      const done = [...s.records.messages.values()].find(
        (m) => m.ref === draft.ref && m.contentHash === draft.contentHash && (m.delivery.status === 'sent' || (m.delivery.status === 'not-sent' && this.mailer.kind === 'outbox')),
      );
      if (done) return { result: ok(done) };
      const id = `M-${this.log.nextSeq()}` as MessageId;
      const delivery = await this.mailer.send({ id, subject: draft.subject, text: draft.text, intendedFor: draft.intendedFor, idempotencyKey: `${draft.ref}:${draft.contentHash}` });
      const { blocked: _b, ...m } = draft;
      return { event: { type: 'message-sent', id, ...m, delivery }, result: (next) => ok(next.records.messages.get(id)!) };
    });
  }

  subscribe(listener: (e: WorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    await this.queue;
    await this.log.close();
  }

  // ───────────── internals ─────────────

  private replayed<T>(key: string, fingerprint: string): CommandResult<T> | null {
    const prior = this.state.records.results.get(key);
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint) return fail('idempotency-key-reused', `idempotency key ${key} was already used for a different request`);
    return prior.result as CommandResult<T>;
  }

  /**
   * The one write path. `plan` inspects the current state and either answers directly (no event:
   * noops and refusals, remembered in memory only) or names one event plus how to read the result
   * from the state that event produces.
   */
  private command<T>(
    key: string,
    fingerprint: string,
    actor: Actor | SystemActor | HumanName,
    plan: (s: State) => CommandStep<T> | Promise<CommandStep<T>>,
  ): Promise<CommandResult<T>> {
    const run = async (): Promise<CommandResult<T>> => {
      const replay = this.replayed<T>(key, fingerprint);
      if (replay) return replay;
      const s = this.state;
      const step = await plan(s);
      const remember = (result: CommandResult<T>) => {
        this.state = { ...s, records: { ...s.records, results: new Map(s.records.results).set(key, { fingerprint, result }) } };
        return result;
      };
      if (!('event' in step)) return remember(step.result);
      const seq = this.log.nextSeq();
      const at = new Date().toISOString();
      const pending: LogEntry = { actor, key, fingerprint, event: step.event, result: ok(null) };
      const draft = derive(this.site, reduce(s.records, seq, at, pending));
      const result = step.result(draft);
      const entry: LogEntry = { ...pending, result };
      await this.log.append(at, entry);
      const next: State = { ...draft, records: { ...draft.records, results: new Map(draft.records.results).set(key, { fingerprint, result }) } };
      this.state = next;
      this.emitChanges(s, next, step.event);
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private emitChanges(prev: State, next: State, e: DomainEvent): void {
    const out: WorkspaceEvent[] = [];
    // Work orders and monitoring history are records, not facts: a new export changes them without a new revision.
    const recordsChanged = e.type === 'document-registered' || e.type === 'site-reset';
    if (recordsChanged || prev.planned.revision !== next.planned.revision || prev.documented.revision !== next.documented.revision) {
      out.push({ type: 'model-changed', revision: next.planned.revision });
    }
    if ('id' in e && e.type.startsWith('proposal-')) out.push({ type: 'proposal-changed', id: e.id as ProposalId });
    for (const x of out) for (const l of this.listeners) l(x);
  }

  private effective(p: Proposal, s: State = this.state): Proposal {
    const reason = s.derivedStale.get(p.id);
    if (!reason || p.state.status !== 'applied') return p;
    return { ...p, state: { status: 'stale', at: p.state.at, reason } };
  }

  private latestRegistered(rel: string, s: State = this.state): Registered | undefined {
    return s.records.documents.findLast((d) => d.doc.path === rel);
  }

  private latest(rel: string, s: State = this.state): SourceDocument | undefined {
    return this.latestRegistered(rel, s)?.doc;
  }

  private report(s: State, r: Registered): IngestReport {
    const mine = new Set(parsedStatements(r));
    const rejected = s.issues.filter((i) => i.kind !== 'stale-change' && mine.has(i.statement)).length;
    return { doc: r.doc.id, via: parserFor(r.doc) ? 'parser' : 'unparsed', valuesRead: mine.size - rejected, valuesRejected: rejected, revision: s.planned.revision };
  }
}

async function walk(dir: string, prefix = ''): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(path.join(dir, prefix))).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: string[] = [];
  for (const name of names) {
    const rel = path.join(prefix, name);
    if ((await stat(path.join(dir, rel))).isDirectory()) out.push(...(await walk(dir, rel)));
    else out.push(rel);
  }
  return out;
}
