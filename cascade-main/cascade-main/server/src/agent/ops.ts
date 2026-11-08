// The companion's operations. Each is one call into the engine the HTTP routes use, shaped for a
// sentence and for the view. Both front ends call these (the model's tools and the no-key intent
// table), so every name and number in a reply is computed here, never by a model.

import {
  addDays, assessWorkOrders, cabinetRange, displayFact, kindOf, normalizeTag, tagOf, toWire, upcomingWorkOrders,
  type Analysis, type AnyId, type Facility, type FindingId, type FixPlan, type Id, type LocalDateTime, type PatchOp,
} from '@cascade/core';
import { ENTITY_KINDS, RISK_GRADES, type CompanionAction, type EntityKind, type RiskGrade, type WorkAssessmentDto, type WorkReasonKind } from '@cascade/core/contract';
import type { Actor } from '../actors.js';
import type { Workspace } from '../workspace.js';

/** One request to the companion: the workspace, the clock, what the view shows, and who acts. */
export interface Turn {
  readonly ws: Workspace;
  readonly asOf: LocalDateTime;
  readonly selected: AnyId | null;
  /** Equipment switched off in the view. */
  readonly off: readonly AnyId[];
  readonly actor: Actor;
  /** The request's Idempotency-Key; every command this turn issues derives its key from it. */
  readonly key: string;
}

export interface Done<T> {
  readonly value: T;
  readonly actions: readonly CompanionAction[];
}

/** Some of one customer's cabinets: "Halcyon Health Partners E01–E05". */
export interface Who {
  readonly name: string;
  readonly cabinets: readonly string[];
  readonly label: string;
}

const done = <T>(value: T, actions: readonly CompanionAction[] = []): Done<T> => ({ value, actions });
const highlight = (ids: readonly string[]): CompanionAction[] => (ids.length > 0 ? [{ kind: 'highlight', ids: [...new Set(ids)] }] : []);
const switchOff = (ids: readonly string[]): CompanionAction[] => ids.map((id) => ({ kind: 'switch-off', id }));
export const cabinetsOf = (who: readonly Who[]) => who.flatMap((w) => w.cabinets);

/** Merges cabinets per customer, first-seen order. */
function whoOf(rows: readonly { readonly name: string; readonly cabinets: readonly string[] }[]): Who[] {
  const by = new Map<string, Set<string>>();
  for (const r of rows) for (const c of r.cabinets) (by.get(r.name) ?? by.set(r.name, new Set()).get(r.name)!).add(c);
  return [...by].map(([name, cabs]) => ({ name, cabinets: [...cabs], label: cabinetRange([...cabs] as AnyId[]) }));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "2026-11-10T14:00" → "Tue 14:00". */
export function dayTime(t: string): string {
  const [y, m, d] = t.slice(0, 10).split('-').map(Number);
  return `${DAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]} ${t.slice(11, 16)}`;
}

// ───────────── names in text ─────────────

/** Kinds a facilities manager names by tag in a sentence. Cords and circuits are named through their cabinet or panel. */
const NAMED: readonly EntityKind[] = ENTITY_KINDS.filter((k) => !['cord', 'circuit', 'contract', 'customer', 'hall', 'row'].includes(k));

export interface Names {
  /** An entity id ("pdu:PDU-3A") or a tag ("PDU-3A"). */
  entity(raw: string): AnyId | null;
  /** Equipment tags mentioned in free text, in order. */
  equipmentIn(text: string): AnyId[];
  customerIn(text: string): { readonly id: AnyId; readonly name: string } | null;
  wonumIn(text: string): string | null;
}

export function names(f: Facility): Names {
  const byTag = new Map<string, AnyId>();
  for (const k of NAMED) for (const e of f.list(k)) if (!byTag.has(normalizeTag(tagOf(e.id)))) byTag.set(normalizeTag(tagOf(e.id)), e.id);
  const customers = f.list('customer').map((c) => ({ id: c.id as AnyId, name: displayFact(c.name) ?? tagOf(c.id) }));
  return {
    entity: (raw) => f.parseId(raw.trim()) ?? byTag.get(normalizeTag(raw)) ?? null,
    equipmentIn: (text) => [...new Set((text.match(/[A-Za-z0-9][A-Za-z0-9/-]*[A-Za-z0-9]/g) ?? []).flatMap((t) => byTag.get(normalizeTag(t)) ?? []))],
    customerIn: (text) => {
      const low = text.toLowerCase();
      return customers.find((c) => low.includes(c.name.toLowerCase()) || low.includes(c.name.split(' ')[0]!.toLowerCase()) || low.includes(tagOf(c.id).toLowerCase())) ?? null;
    },
    wonumIn: (text) => /\bWO-\d{2}-\d{3,}\b/i.exec(text)?.[0].toUpperCase() ?? null,
  };
}

// ───────────── this week's work ─────────────

const RANK = Object.keys(RISK_GRADES) as RiskGrade[];

export interface Job {
  readonly wonum: string;
  readonly what: string;
  readonly when: string | null;
  readonly equipment: string | null;
  /** null: the engine cannot tell what the work takes out. */
  readonly grade: RiskGrade | null;
  readonly headline: string;
  readonly says: string | null;
  /** The reasons that set the grade, merged. */
  readonly worst: { readonly kind: WorkReasonKind; readonly who: readonly Who[] } | null;
  /** Entity ids the work takes out. */
  readonly takesOut: readonly string[];
  readonly revenueUsd: number;
}

function jobOf(a: WorkAssessmentDto): Job {
  const o = a.workOrder;
  const base = { wonum: o.wonum, what: o.description, when: o.scheduledStart && dayTime(o.scheduledStart), equipment: o.asset?.resolved ? o.asset.tag : null };
  if (!a.assessed) return { ...base, grade: null, headline: a.why, says: null, worst: null, takesOut: [], revenueUsd: 0 };
  const top = a.reasons.filter((r) => r.grade === a.grade);
  const kind = top[0]?.kind;
  return {
    ...base,
    grade: a.grade,
    headline: a.headline,
    says: a.says,
    worst: kind ? { kind, who: whoOf(top.filter((r) => r.kind === kind).flatMap((r) => r.customers.map((c) => ({ name: c.customerName, cabinets: c.cabinets })))) } : null,
    takesOut: [...new Set(a.scenario.map((e) => e.slice(e.indexOf(':') + 1, e.lastIndexOf('@'))))],
    revenueUsd: a.reasons.reduce((s, r) => s + r.revenueExposedUsd, 0),
  };
}

/** Open work in the 7 days from the turn's clock, in schedule order, graded on the as-built model. */
export function week(t: Turn): Job[] {
  const an = t.ws.analysis('documented');
  const all = t.ws.workOrders();
  return assessWorkOrders(an, upcomingWorkOrders(all, t.asOf, addDays(t.asOf, 7)), all).map((x) => jobOf(toWire.assessment(x, an.facility)));
}

/** Worst grade first, then most revenue at stake; the sort is stable, so ties keep schedule order. */
const riskOrder = (a: Job, b: Job) => RANK.indexOf(a.grade!) - RANK.indexOf(b.grade!) || b.revenueUsd - a.revenueUsd;

export function riskiest(jobs: readonly Job[]): Job | null {
  return jobs.filter((j) => j.grade !== null).sort(riskOrder)[0] ?? null;
}

/** The riskiest job, with its equipment switched off in the view. */
export function weekCheck(t: Turn): Done<{ readonly jobs: readonly Job[]; readonly riskiest: Job | null }> {
  const jobs = week(t);
  const top = riskiest(jobs);
  return done({ jobs, riskiest: top }, top ? [...switchOff(top.takesOut), ...highlight(cabinetsOf(top.worst?.who ?? []))] : []);
}

// ───────────── what if ─────────────

export interface Sim {
  readonly off: readonly string[];
  readonly down: readonly Who[];
  /** Still powered, on their last path. */
  readonly exposed: readonly Who[];
  /** The records cannot say. */
  readonly unknown: readonly Who[];
  /** Monthly revenue of each group's cabinets, so a dark dollar is never counted as a backup one. */
  readonly revenueUsd: { readonly down: number; readonly exposed: number; readonly unknown: number };
}

function simulateOn(an: Analysis, off: readonly AnyId[]): Sim {
  const f = an.facility;
  const r = an.whatIf({ events: off.map((target) => ({ target, how: 'fails' as const, atMin: 0 })) });
  const last = new Map<Id<'cabinet'>, string>();
  for (const x of r.timeline) if (kindOf(x.id) === 'cabinet') last.set(x.id as Id<'cabinet'>, x.state);
  const group = (state: string) =>
    whoOf(
      [...last].flatMap(([cab, s]) => {
        if (s !== state) return [];
        const owner = f.get(cab).customer;
        return [{ name: owner.kind === 'known' ? (displayFact(f.get(owner.value).name) ?? tagOf(owner.value)) : 'no customer on record', cabinets: [cab] }];
      }),
    );
  const end = r.moments.at(-1)?.customers ?? [];
  const usd = (state: string) => Math.round(end.filter((c) => c.state === state).reduce((s, c) => s + c.revenueExposed, 0) * 100) / 100;
  return { off: off.map(tagOf), down: group('down'), exposed: group('exposed'), unknown: group('unknown'), revenueUsd: { down: usd('down'), exposed: usd('exposed'), unknown: usd('unknown') } };
}

/** `ids` fail together with what the view already has off. */
export function whatIf(t: Turn, ids: readonly AnyId[]): Done<Sim> {
  const sim = simulateOn(t.ws.analysis('planned'), [...new Set([...t.off, ...ids])]);
  return done(sim, [...switchOff(ids), ...highlight(cabinetsOf(sim.down))]);
}

// ───────────── audit ─────────────

export interface AuditTop {
  readonly total: number;
  readonly top: readonly { readonly title: string; readonly who: readonly Who[]; readonly revenueUsd: number }[];
}

export function auditTop(t: Turn, n = 8): Done<AuditTop> {
  const an = t.ws.analysis('planned');
  const findings = toWire.audit(an.audit(), an.facility).findings;
  const top = [...findings].sort((a, b) => b.revenueExposedUsd - a.revenueExposedUsd).slice(0, n);
  return done({ total: findings.length, top: top.map((x) => ({ title: x.title, who: whoOf(x.affected.map((c) => ({ name: c.customerName, cabinets: c.cabinets }))), revenueUsd: x.revenueExposedUsd })) });
}

// ───────────── fix ─────────────

/** A circuit "RPP-3B/13" or sub-feed "PDU-3B-SF-2" named by the panel or PDU a technician walks to. */
const unitOf = (tag: string) => tag.split('/')[0]!.replace(/-SF-\d+$/, '');

/** "feed RPP-4B from PDU-3B", "move D03's B cord to RPP-3B", "add a B cord to D06 from RPP-3B". */
export function moveText(op: PatchOp): string {
  switch (op.op) {
    case 'refeed':
      return `feed ${tagOf(op.device)} from ${unitOf(tagOf(op.to))}`;
    case 'rehome-cord': {
      const [cabinet, side] = tagOf(op.cord).split('/');
      return `move ${cabinet}'s ${side} cord to ${unitOf(tagOf(op.to))}`;
    }
    case 'add-cord':
      return `add a ${op.side} cord to ${tagOf(op.cabinet)} from ${unitOf(tagOf(op.circuit))}`;
  }
}

const touchedBy = (op: PatchOp): string => (op.op === 'refeed' ? op.device : op.op === 'rehome-cord' ? op.cord : op.cabinet);

export type FixDraft =
  /** Nothing loses power with the equipment off. */
  | { readonly kind: 'clear'; readonly equipment: string }
  | { readonly kind: 'no-plan'; readonly equipment: string; readonly down: readonly Who[] }
  | {
      readonly kind: 'plan';
      readonly equipment: string;
      readonly plan: FixPlan;
      readonly down: readonly Who[];
      readonly moves: readonly string[];
      readonly clears: readonly string[];
      /** Entities the moves change: the re-fed panel, the moved cord, the cabinet that gains a cord. */
      readonly touched: readonly string[];
      /** Cabinets that still lose power with the equipment off once the moves are made. */
      readonly stillDown: readonly Who[];
    };

/**
 * The planner's fix for every definite finding behind a cabinet that loses power with `equipment`
 * off, on the planned model: the same targets a MOP's prerequisite moves clear.
 */
export function planFix(t: Turn, equipment: AnyId): Done<FixDraft> {
  const an = t.ws.analysis('planned');
  const tag = tagOf(equipment);
  const before = simulateOn(an, [equipment]);
  const lost = new Set(cabinetsOf(before.down));
  if (lost.size === 0) return done({ kind: 'clear', equipment: tag });
  const targets = an.audit().findings.filter((x) => x.certainty === 'definite' && x.affected.some((i) => i.cabinets.some((c) => lost.has(c)))).map((x) => x.id);
  const plan = targets.length > 0 ? an.planOutcome({ clear: targets, maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'], alternatives: 1 }).plans[0] : undefined;
  if (!plan) return done({ kind: 'no-plan', equipment: tag, down: before.down });
  const after = an.verify(plan.patch, plan.id).after;
  const titles = new Map(toWire.audit(an.audit(), an.facility).findings.map((x) => [x.id, x.title]));
  const touched = plan.patch.ops.map(touchedBy);
  return done(
    {
      kind: 'plan',
      equipment: tag,
      plan,
      down: before.down,
      moves: plan.patch.ops.map(moveText),
      clears: plan.cleared.map((id: FindingId) => titles.get(id) ?? tagOf(id as never)),
      touched,
      stillDown: after ? simulateOn(after, [equipment]).down : before.down,
    },
    highlight(touched),
  );
}

export type FixResult = { readonly draft: FixDraft } & ({ readonly proposalId: string; readonly status: string } | { readonly proposalId: null; readonly error: string | null });

/** Plans the fix and submits it for human approval through the same gate as the UI. Never approves. */
export async function submitFix(t: Turn, equipment: AnyId): Promise<Done<FixResult>> {
  const { value: draft, actions } = planFix(t, equipment);
  if (draft.kind !== 'plan') return done({ draft, proposalId: null, error: null }, switchOff([equipment]));
  const rationale = `Keeps ${whoText(draft.down)} powered with ${draft.equipment} off: ${draft.moves.join('; ')}.`;
  const r = await t.ws.submit(draft.plan, rationale, t.actor, `${t.key}:fix:${equipment}`);
  if (!r.ok) return done({ draft, proposalId: null, error: r.message }, actions);
  return done({ draft, proposalId: r.value.id, status: r.value.state.status }, [{ kind: 'proposal', proposalId: r.value.id }, ...switchOff([equipment]), ...actions]);
}

// ───────────── customer notices ─────────────

export interface NoticeLine {
  readonly name: string;
  readonly cabinets: readonly string[];
  readonly label: string;
  readonly effects: readonly string[];
  /** Why it cannot be sent yet; null when it is ready for the manager's review. */
  readonly blocked: string | null;
}

export type Drafted =
  | { readonly kind: 'drafted'; readonly job: Job; readonly notices: readonly NoticeLine[]; readonly focus: string | null }
  | { readonly kind: 'none'; readonly why: string };

export type NoticeTarget = { readonly wonum: string } | { readonly customer: { readonly id: AnyId; readonly name: string } } | { readonly equipment: AnyId } | null;

/**
 * Drafts the notices for one work order: the one named, this week's riskiest job on the equipment or
 * affecting the customer, or this week's riskiest job. Drafting only: sending is a human's call.
 */
export function draftNotices(t: Turn, target: NoticeTarget): Done<Drafted> {
  const f = t.ws.analysis('documented').facility;
  const affected = (wonum: string): NoticeLine[] | null => {
    const set = t.ws.notices(wonum, t.asOf);
    const dto = set && toWire.notices(wonum, set, f);
    if (!dto?.assessed) return null;
    return dto.notices
      .filter((n) => n.effects.length > 0)
      .map((n) => {
        const cabinets = n.effects.flatMap((e) => e.cabinets);
        return { name: n.customerName, cabinets, label: cabinetRange(cabinets as AnyId[]), effects: n.effects.map((e) => e.line), blocked: n.blocked?.reason ?? null };
      });
  };
  const jobs = week(t);
  const byRisk = [...jobs].filter((j) => j.grade !== null).sort(riskOrder);
  let job: Job | null = null;
  let focus: string | null = null;
  if (target && 'wonum' in target) {
    const o = t.ws.workOrders().find((x) => x.wonum === target.wonum);
    if (!o) return done({ kind: 'none', why: `There is no work order ${target.wonum}.` });
    const an = t.ws.analysis('documented');
    job = jobs.find((j) => j.wonum === o.wonum) ?? jobOf(toWire.assessment(assessWorkOrders(an, [o], t.ws.workOrders())[0]!, an.facility));
  } else if (target && 'equipment' in target) {
    job = byRisk.find((j) => j.equipment === tagOf(target.equipment)) ?? null;
    if (!job) return done({ kind: 'none', why: `No work on ${tagOf(target.equipment)} is scheduled this week.` });
  } else if (target && 'customer' in target) {
    focus = target.customer.name;
    job = byRisk.find((j) => affected(j.wonum)?.some((n) => n.name === focus)) ?? null;
    if (!job) return done({ kind: 'none', why: `No work this week affects ${focus}.` });
  } else {
    job = riskiest(jobs);
    if (!job) return done({ kind: 'none', why: 'No maintenance is scheduled in the next 7 days.' });
  }
  const lines = affected(job.wonum);
  if (!lines) return done({ kind: 'none', why: `Cascade cannot tell who ${job.wonum} affects: ${job.headline}` });
  const shown = focus ? lines.filter((n) => n.name === focus) : lines;
  return done({ kind: 'drafted', job, notices: shown, focus }, highlight(shown.flatMap((n) => n.cabinets)));
}

// ───────────── shift handoff ─────────────

export interface Handoff {
  readonly at: string;
  readonly work: readonly { readonly wonum: string; readonly what: string; readonly when: 'in-progress' | 'due'; readonly headline: string }[];
  readonly lost: readonly string[];
  readonly waiting: readonly { readonly wonum: string; readonly what: string; readonly status: string }[];
  readonly standingAlarms: readonly string[];
}

export function handoff(t: Turn): Done<Handoff> {
  const b = toWire.handoff(t.ws.handoff(t.asOf), t.ws.analysis('documented').facility);
  return done({
    at: dayTime(b.at),
    work: b.work.map((w) => ({ wonum: w.assessment.workOrder.wonum, what: w.assessment.workOrder.description, when: w.when, headline: w.assessment.assessed ? w.assessment.headline : w.assessment.why })),
    lost: b.lostRedundancy.map((x) => x.finding.title),
    waiting: b.waiting.map((o) => ({ wonum: o.wonum, what: o.description, status: o.status })),
    standingAlarms: b.alarms.standing.map((e) => `${e.text} (${tagOf(e.entity as AnyId)})`),
  });
}

// ───────────── one entity ─────────────

export interface Inspected {
  readonly tag: string;
  readonly kind: string;
  readonly facts: readonly { readonly field: string; readonly value: string | null }[];
  readonly feeds: readonly string[];
}

export function inspect(t: Turn, id: AnyId): Done<Inspected> {
  const an = t.ws.analysis('planned');
  const e = toWire.entity(an.explain(id), an.facility);
  return done({ tag: e.tag, kind: e.kind, facts: e.facts.map((x) => ({ field: x.field, value: x.display })), feeds: e.dependents.slice(0, 20).map((d) => tagOf(d as AnyId)) }, [{ kind: 'select', id }]);
}

// ───────────── words ─────────────

/** "Halcyon Health Partners E01–E05 and Trinity Logistics Group D03, D06". */
export function whoText(who: readonly Who[], max = 3): string {
  const parts = who.slice(0, max).map((w) => `${w.name} ${w.label}`);
  if (who.length > max) parts.push(`${who.length - max} more customer${who.length - max === 1 ? '' : 's'}`);
  return parts.length <= 1 ? (parts[0] ?? 'no one') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
