// Shift handoff brief: what the incoming shift needs at one moment, computed from the records and
// the engine. Work in progress or due in the next 24 hours
// with its assessment, what runs without redundancy now, what the BMS and power monitoring logged in
// the last 12 hours and what is still in alarm, work waiting on materials or plant conditions, the
// thresholds to watch, and whom to call per open job. Rendered both as data and as one plain page.

import { RISK_GRADES, WORK_ORDER_STATUS_WORDS, type RuleId } from '../contract.js';
import type { Analysis } from '../analysis/analysis.js';
import { findingTitle, type Finding } from '../analysis/audit.js';
import type { AnyId, Id } from '../facility/ids.js';
import { tagOf } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import type { AlarmLimit, EventRecord, HistorySystem, SiteHistory } from '../history/history.js';
import { assessWorkOrders, cabinetRange, type WorkAssessment } from '../maintenance/assessment.js';
import { contentHash, faultList } from '../maintenance/notices.js';
import { addHours, isOpen, siteDay, type LocalDateTime, type WorkOrder } from '../maintenance/work-orders.js';

export const HANDOFF_AHEAD_HOURS = 24;
export const HANDOFF_BACK_HOURS = 12;

/** Audit rules that mean redundancy is missing today, as opposed to contract, capacity or data findings. */
const LOST_REDUNDANCY: ReadonlySet<RuleId> = new Set(['single-corded', 'ab-convergence', 'failover-overload', 'cooling-common-cause', 'cooling-capacity']);

/** Maximo statuses that mean the job is parked until something arrives. */
const WAITING = new Set(['WMATL', 'WPCOND']);

export interface HandoffWork {
  /** in-progress: started (or its window has begun) and not finished; due: starts within the next 24 h. */
  readonly when: 'in-progress' | 'due';
  readonly assessment: WorkAssessment;
}

export interface LostRedundancy {
  readonly finding: Finding;
  /** Open work orders on the finding's subject, or naming one of its cabinets. */
  readonly openWork: readonly WorkOrder[];
}

export type SiteEvent = EventRecord & { readonly entity: AnyId };

export interface HandoffAlarms {
  /** Every event logged in the last 12 hours, oldest first. */
  readonly recent: readonly SiteEvent[];
  /** Conditions that went active and have not returned to normal by the brief's time, oldest first. */
  readonly standing: readonly SiteEvent[];
  /** The newest record each system's exports hold: the edge of what the brief can see. */
  readonly coverage: readonly { readonly system: HistorySystem; readonly latest: LocalDateTime | null }[];
}

export type WatchItem =
  | { readonly kind: 'limit'; readonly limit: AlarmLimit & { readonly entity: AnyId } }
  | { readonly kind: 'during-work'; readonly workOrder: WorkOrder; readonly text: string; readonly faults: readonly AnyId[] };

export interface CallItem {
  readonly workOrder: WorkOrder;
  readonly vendor: string | null;
  readonly lead: string | null;
  readonly ownerGroup: string | null;
}

export interface HandoffBrief {
  readonly at: LocalDateTime;
  readonly since: LocalDateTime;
  readonly until: LocalDateTime;
  readonly work: readonly HandoffWork[];
  readonly lostRedundancy: readonly LostRedundancy[];
  readonly alarms: HandoffAlarms;
  readonly waiting: readonly WorkOrder[];
  readonly watch: readonly WatchItem[];
  readonly calls: readonly CallItem[];
  /** The brief as one plain-text page. */
  readonly subject: string;
  readonly text: string;
  readonly contentHash: string;
}

export function shiftHandoff(
  an: Analysis,
  input: { readonly workOrders: readonly WorkOrder[]; readonly history: SiteHistory; readonly at: LocalDateTime },
): HandoffBrief {
  const { workOrders: all, history, at } = input;
  const since = addHours(at, -HANDOFF_BACK_HOURS);
  const until = addHours(at, HANDOFF_AHEAD_HOURS);

  const inProgress = (o: WorkOrder) =>
    o.status === 'INPRG' || (o.scheduledStart !== null && o.scheduledStart <= at && (o.scheduledFinish ?? o.scheduledStart) > at);
  const open = all.filter(isOpen);
  const current = open.filter((o) => !WAITING.has(o.status) && (inProgress(o) || (o.scheduledStart !== null && o.scheduledStart >= at && o.scheduledStart < until)));
  const assessed = assessWorkOrders(an, current, all);
  const work = assessed.map((assessment): HandoffWork => ({ when: inProgress(assessment.workOrder) ? 'in-progress' : 'due', assessment }));

  const mentions = (o: WorkOrder, ids: readonly AnyId[]) => ids.some((id) => new RegExp(`\\b${tagOf(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(o.description));
  const lostRedundancy = an
    .audit()
    .findings.filter((x) => LOST_REDUNDANCY.has(x.rule))
    .sort((a, b) => Number(a.certainty !== 'definite') - Number(b.certainty !== 'definite') || b.revenueExposed - a.revenueExposed)
    .map((finding): LostRedundancy => {
      const cabs = finding.affected.flatMap((i) => i.cabinets);
      return { finding, openWork: open.filter((o) => (o.asset?.resolved && o.asset.entity === finding.subject) || (cabs.length <= 2 && mentions(o, cabs))) };
    });

  const before = history.events.filter((e) => e.at < at);
  const recent = before.filter((e) => e.at >= since);
  const lastPhase = new Map<string, SiteEvent>();
  for (const e of before) if (e.phase !== 'instant') lastPhase.set(`${e.system}|${e.source}`, e);
  const standing = [...lastPhase.values()].filter((e) => e.phase === 'active').sort((a, b) => (a.at < b.at ? -1 : 1));
  const coverage = (['bms', 'epms'] as const).map((system) => ({
    system,
    latest: history.events.filter((e) => e.system === system).reduce<LocalDateTime | null>((m, e) => (m === null || e.at > m ? e.at : m), null),
  }));

  const waiting = open.filter((o) => WAITING.has(o.status));

  const watch: WatchItem[] = [
    ...work.flatMap(({ assessment: x }) =>
      x.assessed
        ? x.reasons
            .filter((r) => r.secondFaults.length > 0)
            .map((r): WatchItem => ({
              kind: 'during-work',
              workOrder: x.workOrder,
              text: r.kind === 'one-cord-left' ? `${r.text} A failure of ${faultList(r.secondFaults)} in that window drops them.` : r.text,
              faults: r.secondFaults,
            }))
        : [],
    ),
    ...history.limits.map((limit): WatchItem => ({ kind: 'limit', limit })),
  ];

  const calls = [...work.map((w) => w.assessment.workOrder), ...waiting].map((o): CallItem => ({ workOrder: o, vendor: o.vendor, lead: o.lead, ownerGroup: o.ownerGroup }));

  const brief = { at, since, until, work, lostRedundancy, alarms: { recent, standing, coverage }, waiting, watch, calls };
  const subject = `DFW1 shift handoff, ${when(at)} site time`;
  const text = renderHandoff(brief, an);
  return { ...brief, subject, text, contentHash: contentHash(subject, text) };
}

// ───────────────────────────── The page ─────────────────────────────

const hhmm = (t: LocalDateTime) => t.slice(11, 16);
const when = (t: LocalDateTime) => `${siteDay(t)} ${hhmm(t)}`;
const span = (o: WorkOrder) => {
  const s = o.actualStart ?? o.scheduledStart;
  const f = o.scheduledFinish;
  if (!s) return 'unscheduled';
  return f && f.slice(0, 10) === s.slice(0, 10) ? `${when(s)}-${hhmm(f)}` : f ? `${when(s)} to ${when(f)}` : `from ${when(s)}`;
};

function renderHandoff(b: Omit<HandoffBrief, 'subject' | 'text' | 'contentHash'>, an: Analysis): string {
  const name = (c: Id<'customer'>) => displayFact(an.facility.get(c).name) ?? tagOf(c);
  const wo = (o: WorkOrder) => `${o.wonum} ${o.description}`;
  const out: string[] = [
    `DFW1 SHIFT HANDOFF, ${when(b.at)} site time`,
    `Work through ${when(b.until)}. Alarms since ${when(b.since)}.`,
    '',
    `1. WORK IN PROGRESS AND DUE IN THE NEXT ${HANDOFF_AHEAD_HOURS} H`,
  ];
  if (b.work.length === 0) out.push('- None.');
  for (const { when: w, assessment: x } of b.work) {
    const o = x.workOrder;
    const head = `- ${w === 'in-progress' ? 'IN PROGRESS' : 'DUE'} ${span(o)}  ${wo(o)}`;
    out.push(head, x.assessed ? `  ${RISK_GRADES[x.grade].toUpperCase()}: ${x.headline}` : `  Not assessed: ${x.why}.`);
  }

  out.push('', '2. REDUNDANCY LOST RIGHT NOW');
  if (b.lostRedundancy.length === 0) out.push('- None found in the records.');
  for (const { finding: x, openWork } of b.lostRedundancy) {
    const who = x.affected.map((i) => `${name(i.customer)} ${cabinetRange(i.cabinets)}`).join('; ');
    out.push(`- ${findingTitle(x, an.facility)}${x.certainty === 'contingent' ? ' (a record is missing)' : ''}. Affects ${who}.`);
    for (const o of openWork) out.push(`  Open: ${wo(o)} (${WORK_ORDER_STATUS_WORDS[o.status]}).`);
  }

  out.push('', `3. ALARMS AND EVENTS, LAST ${HANDOFF_BACK_HOURS} H`);
  if (b.alarms.recent.length === 0) out.push('- None logged.');
  for (const e of b.alarms.recent) out.push(`- ${when(e.at)} ${e.system.toUpperCase()} ${e.source}: ${e.text}${e.detail ? ` (${e.detail})` : ''}`);
  for (const c of b.alarms.coverage) {
    if (c.latest === null || c.latest < b.since) out.push(`  Note: the ${c.system.toUpperCase()} export ${c.latest ? `ends ${when(c.latest)}` : 'holds no events'}, so this window is not covered by it.`);
  }
  if (b.alarms.standing.length > 0) out.push('  Still active (no return to normal logged):');
  for (const e of b.alarms.standing) out.push(`  - ${e.source}: ${e.text}, since ${when(e.at)}`);

  out.push('', '4. WAITING ON MATERIALS OR PLANT CONDITIONS');
  if (b.waiting.length === 0) out.push('- None.');
  for (const o of b.waiting) out.push(`- ${wo(o)}: ${WORK_ORDER_STATUS_WORDS[o.status]}${o.statusDate ? ` since ${o.statusDate.slice(0, 10)}` : ''}.`);

  out.push('', '5. WATCH');
  for (const w of b.watch) {
    if (w.kind === 'limit') out.push(`- ${w.limit.source} ${w.limit.bound === 'high' ? 'above' : 'below'} ${w.limit.value} ${w.limit.unit}: BMS ${w.limit.bound} alarm.`);
    else out.push(`- During ${w.workOrder.wonum} (${span(w.workOrder)}): ${w.text}`);
  }

  out.push('', '6. WHO TO CALL');
  if (b.calls.length === 0) out.push('- No open jobs in this brief.');
  for (const c of b.calls) {
    out.push(`- ${c.workOrder.wonum}: ${c.vendor ? `vendor ${c.vendor}` : 'in-house'}${c.lead ? `, lead ${c.lead}` : ''}${c.ownerGroup ? `, ${c.ownerGroup}` : ''}.`);
  }
  out.push('', 'Prepared by Cascade from the site records.');
  return out.join('\n');
}
