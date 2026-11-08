// Boundary parsers shared by the HTTP routes and the agent tools. Untrusted input in, domain types
// or `{ error }` out. Ids go through facility.parseId so a wrong-kind or unknown id never gets in.

import type { Analysis, AnyId, Facility, FixGoal, FindingId, HistoryWindow, LocalDateTime, PatchOp, Scenario } from '@cascade/core';
import type { CompanionMessage, ModelView, SendMessageBody } from '@cascade/core/contract';

export type Parsed<T> = T | { readonly error: string };

export const isError = <T>(v: Parsed<T>): v is { readonly error: string } =>
  typeof v === 'object' && v !== null && 'error' in v && typeof (v as { error: unknown }).error === 'string' && Object.keys(v).length === 1;

export function parseView(raw: unknown): Parsed<ModelView> {
  if (raw === undefined || raw === '') return 'planned';
  return raw === 'planned' || raw === 'documented' ? raw : { error: "view must be 'planned' or 'documented'" };
}

/**
 * Site-local wall time for work-order queries: "YYYY-MM-DD" (midnight) or "YYYY-MM-DDTHH:mm".
 * Absent, it is `now` on the server's clock, which runs at the site.
 */
export function parseAsOf(raw: unknown, now: Date): Parsed<LocalDateTime> {
  if (raw === undefined || raw === '') return localNow(now);
  return readLocalTime(raw) ?? { error: 'asOf must be a site-local time YYYY-MM-DD or YYYY-MM-DDTHH:mm' };
}

/** `now` on the server's clock, which runs at the site, as site-local wall time. */
export function localNow(now: Date): LocalDateTime {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}:${p2(now.getMinutes())}`;
}

const MAX_MESSAGES = 20;
const MAX_CONTENT = 4000;

/** POST /companion: the conversation (last message the user's) and the view's ids, each a known entity. */
export function parseCompanionBody(raw: unknown, f: Facility): Parsed<{ messages: CompanionMessage[]; selected: AnyId | null; off: AnyId[] }> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const ms = o['messages'];
  if (!Array.isArray(ms) || ms.length === 0) return { error: 'messages must be a non-empty array of { role, content }' };
  const messages: CompanionMessage[] = [];
  for (const m of ms.slice(-MAX_MESSAGES) as unknown[]) {
    const x = (m ?? {}) as Record<string, unknown>;
    if ((x['role'] !== 'user' && x['role'] !== 'assistant') || typeof x['content'] !== 'string') return { error: "each message needs role 'user' or 'assistant' and string content" };
    messages.push({ role: x['role'], content: x['content'].slice(0, MAX_CONTENT) });
  }
  if (messages.at(-1)!.role !== 'user' || messages.at(-1)!.content.trim() === '') return { error: "the last message must be the user's and not empty" };
  const ctx = (o['context'] ?? {}) as Record<string, unknown>;
  const sel = ctx['selected'] ?? null;
  const selected = sel === null ? null : typeof sel === 'string' ? f.parseId(sel) : null;
  if (sel !== null && !selected) return { error: `context.selected is not a known id: ${JSON.stringify(sel)}` };
  const offRaw = ctx['off'] ?? [];
  if (!Array.isArray(offRaw) || offRaw.length > 50) return { error: 'context.off must be an array of at most 50 ids' };
  const off: AnyId[] = [];
  for (const x of offRaw as unknown[]) {
    const id = typeof x === 'string' ? f.parseId(x) : null;
    if (!id) return { error: `context.off has an unknown id: ${JSON.stringify(x)}` };
    off.push(id);
  }
  return { messages, selected, off };
}

function readLocalTime(raw: unknown): LocalDateTime | null {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(raw) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31 || Number(m[4] ?? 0) > 23 || Number(m[5] ?? 0) > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}`;
}

/** POST /messages: which notice or brief to send, and the hash of the words the human approved. */
export function parseSendBody(raw: unknown): Parsed<SendMessageBody> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const hash = o['contentHash'];
  if (typeof hash !== 'string' || !/^[0-9a-f]{16}$/.test(hash)) return { error: 'contentHash is required: the contentHash of the notice or brief you approved' };
  if (o['kind'] === 'customer-notice') {
    const asOf = readLocalTime(o['asOf']);
    if (typeof o['wonum'] !== 'string' || typeof o['customer'] !== 'string' || !asOf) return { error: 'a customer notice needs wonum, customer and asOf (the time it was prepared for)' };
    return { kind: 'customer-notice', wonum: o['wonum'], customer: o['customer'], asOf, contentHash: hash };
  }
  if (o['kind'] === 'handoff-brief') {
    const at = readLocalTime(o['at']);
    if (!at) return { error: 'a handoff brief needs at (the site-local time it was prepared for)' };
    return { kind: 'handoff-brief', at, contentHash: hash };
  }
  return { error: "kind must be 'customer-notice' or 'handoff-brief'" };
}

/** A history window [from, to): each side a site-local time, or absent for open. */
export function parseWindow(fromRaw: unknown, toRaw: unknown): Parsed<HistoryWindow> {
  const side = (raw: unknown) => (raw === undefined || raw === '' ? null : readLocalTime(raw));
  const [from, to] = [side(fromRaw), side(toRaw)];
  if ((from === null && fromRaw !== undefined && fromRaw !== '') || (to === null && toRaw !== undefined && toRaw !== '')) {
    return { error: 'from and to must be site-local times YYYY-MM-DD or YYYY-MM-DDTHH:mm' };
  }
  if (from !== null && to !== null && from >= to) return { error: 'from must be before to' };
  return { from, to };
}

const EVENT = /^(fails|maintenance):(.+)@(\d+(?:\.\d+)?)$/;

/** Scenario events as `how:entity-id@minutes`, e.g. `fails:ups:UPS-A@0`. */
export function parseScenario(raw: unknown, f: Facility): Parsed<Scenario> {
  const items = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (items.length === 0) return { error: 'at least one event is required (e=fails:<entity-id>@<minutes>)' };
  if (items.length > 20) return { error: 'at most 20 events' };
  const events: Scenario['events'][number][] = [];
  for (const item of items) {
    const m = typeof item === 'string' ? EVENT.exec(item) : null;
    if (!m) return { error: `bad event ${JSON.stringify(item)}: expected how:entity-id@minutes` };
    const target = f.parseId(m[2]!);
    if (!target) return { error: `unknown entity ${m[2]}` };
    events.push({ target, how: m[1] as 'fails' | 'maintenance', atMin: Number(m[3]) });
  }
  return { events };
}

const ALL_MOVES: readonly PatchOp['op'][] = ['rehome-cord', 'add-cord', 'refeed'];

const intIn = (v: unknown, name: string, min: number, max: number, dflt: number): Parsed<number> => {
  if (v === undefined) return dflt;
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : { error: `${name} must be an integer in [${min}, ${max}]` };
};

/** Fix goal; finding ids are checked against the current audit. */
export function parseGoal(raw: unknown, an: Analysis): Parsed<FixGoal> {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || Array.isArray(o)) return { error: 'goal must be an object' };
  const maxMoves = intIn(o['maxMoves'], 'maxMoves', 1, 12, 6);
  if (isError(maxMoves)) return maxMoves;
  const alternatives = intIn(o['alternatives'], 'alternatives', 1, 10, 3);
  if (isError(alternatives)) return alternatives;
  const clearRaw = o['clear'] ?? 'all-fixable';
  let clear: FixGoal['clear'];
  if (clearRaw === 'all-fixable') clear = 'all-fixable';
  else if (Array.isArray(clearRaw) && clearRaw.length > 0 && clearRaw.every((x) => typeof x === 'string')) {
    const known = new Set<string>(an.audit().findings.map((x) => x.id));
    const unknown = clearRaw.filter((x) => !known.has(x));
    if (unknown.length > 0) return { error: `unknown finding ids: ${unknown.join(', ')}` };
    clear = clearRaw as FindingId[];
  } else return { error: "clear must be 'all-fixable' or a non-empty array of finding ids" };
  return { clear, maxMoves, alternatives, allow: ALL_MOVES };
}
