// Customer maintenance notices: one per customer for one assessed work order, written from the
// assessment's reasons, never from labels. Every customer gets one, and its first line says whether
// they are affected (a notice that leaves this unclear is how a tenant ends up surprised). A notice
// is blocked when the records show a cabinet losing all power or cooling: no honest notice can say a
// feed remains, so the work or the records have to change first.

import { WORK_ORDER_STATUS_WORDS, type Certainty, type Side } from '../contract.js';
import { sha256Hex } from '../hash.js';
import type { Analysis } from '../analysis/analysis.js';
import type { AnyId, FactRef, Id } from '../facility/ids.js';
import { tagOf } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import { cabinetRange, renderSpare, type Contradiction, type PoolLevel, type WorkAssessment, type WorkReason } from './assessment.js';
import { addBusinessDays, businessDaysBetween, isOpen, siteDay, type LocalDateTime, type WorkOrder } from './work-orders.js';

/** What the work does to some of one customer's cabinets, with the sentence the notice uses for it. */
export type NoticeEffect = Effect & { readonly line: string };

type Effect =
  | { readonly kind: 'loses-power'; readonly cabinets: readonly Id<'cabinet'>[]; readonly before: readonly Side[]; readonly certainty: Certainty; readonly contradictions: readonly Contradiction[] }
  | { readonly kind: 'loses-cooling'; readonly cabinets: readonly Id<'cabinet'>[]; readonly certainty: Certainty }
  | { readonly kind: 'loses-feed'; readonly cabinets: readonly Id<'cabinet'>[]; readonly lost: readonly Side[]; readonly remaining: readonly Side[]; readonly certainty: Certainty }
  | { readonly kind: 'second-fault'; readonly cabinets: readonly Id<'cabinet'>[]; readonly faults: readonly AnyId[]; readonly certainty: Certainty }
  | { readonly kind: 'cooling-margin'; readonly cabinets: readonly Id<'cabinet'>[]; readonly pools: readonly PoolLevel[]; readonly faults: readonly AnyId[] };

export interface NoticeBlock {
  readonly reason: string;
  /** Work orders that bear on the fix (the cancelled re-feed, the waiting whip). */
  readonly workOrders: readonly WorkOrder[];
}

export interface NoticePeriod {
  readonly requiredBusinessDays: number;
  readonly clause: FactRef;
  /** Business days from the issue date to the work's start, both days excluded. */
  readonly givenBusinessDays: number;
}

export interface MaintenanceNotice {
  /** `<wonum>/<customer tag>`: one notice per customer per work order. */
  readonly id: string;
  readonly workOrder: WorkOrder;
  readonly customer: Id<'customer'>;
  readonly customerName: string;
  readonly cabinets: readonly Id<'cabinet'>[];
  /** Empty: the customer is not affected, and the notice says so. */
  readonly effects: readonly NoticeEffect[];
  readonly blocked: NoticeBlock | null;
  /** The contract's notice clause, against the issue date. null when the contract states none. */
  readonly period: NoticePeriod | null;
  readonly issuedOn: LocalDateTime;
  readonly subject: string;
  readonly body: string;
  /** Identifies the exact words: sending requires the hash of the text the human approved. */
  readonly contentHash: string;
}

export type NoticeSet =
  | { readonly assessed: false; readonly why: string }
  | { readonly assessed: true; readonly notices: readonly MaintenanceNotice[] };

export const contentHash = (subject: string, body: string): string => sha256Hex(`${subject}\n\n${body}`).slice(0, 16);

/** The customer's contracted notice period for scheduled maintenance, with the clause that states it. */
export function noticeTermOf(an: Analysis, customer: Id<'customer'>): { readonly days: number; readonly ref: FactRef } | null {
  for (const k of an.facility.list('contract')) {
    if (k.customer.kind !== 'known' || k.customer.value !== customer) continue;
    for (const t of k.terms) if (t.kind === 'known' && t.value.term === 'maintenance-notice') return { days: t.value.businessDays, ref: t.ref };
  }
  return null;
}

/**
 * The last date a notice can go out and still give `days` business days before work starting `start`,
 * counted the way `NoticePeriod.givenBusinessDays` counts them: issue day and start day both excluded.
 */
export const noticeDueBy = (start: LocalDateTime, days: number): string => addBusinessDays(start, -(days + 1));

/** The first date work can start when notice of `days` business days goes out on `issuedOn`. */
export const earliestStartAfterNotice = (issuedOn: LocalDateTime, days: number): string => addBusinessDays(issuedOn, days + 1);


/** Notices for one assessed work order, one per customer of the site, in customer order. */
export function maintenanceNotices(an: Analysis, x: WorkAssessment, history: readonly WorkOrder[], issuedOn: LocalDateTime): NoticeSet {
  if (!x.assessed) return { assessed: false, why: x.why };
  const f = an.facility;
  const cabinetsOf = new Map<Id<'customer'>, Id<'cabinet'>[]>();
  for (const cab of f.list('cabinet')) {
    const owner = cab.customer;
    if (owner.kind === 'known') (cabinetsOf.get(owner.value) ?? cabinetsOf.set(owner.value, []).get(owner.value)!).push(cab.id);
  }
  const contractOf = (c: Id<'customer'>) => f.list('contract').find((k) => k.customer.kind === 'known' && k.customer.value === c) ?? null;

  const notices = f
    .list('customer')
    .map((c) => c.id)
    .sort()
    .map((customer): MaintenanceNotice => {
      const name = displayFact(f.get(customer).name) ?? tagOf(customer);
      const effects = x.reasons.flatMap((r) => effectsFor(r, customer)).map((e) => ({ ...e, line: effectLine(e, tagOf(x.work.asset)) }));
      const term = noticeTermOf(an, customer);
      const start = x.workOrder.scheduledStart;
      const period = term && start ? { requiredBusinessDays: term.days, clause: term.ref, givenBusinessDays: businessDaysBetween(issuedOn, start) } : null;
      const notice = { workOrder: x.workOrder, asset: x.work.asset, says: x.work.says, customer, name, cabinets: (cabinetsOf.get(customer) ?? []).sort(), effects };
      const subject = subjectOf(notice);
      const body = bodyOf(notice, contractOf(customer), issuedOn);
      return {
        id: `${x.workOrder.wonum}/${tagOf(customer)}`,
        workOrder: x.workOrder,
        customer,
        customerName: name,
        cabinets: notice.cabinets,
        effects,
        blocked: blockFor(notice, history),
        period,
        issuedOn,
        subject,
        body,
        contentHash: contentHash(subject, body),
      };
    });
  return { assessed: true, notices };
}

function effectsFor(r: WorkReason, customer: Id<'customer'>): Effect[] {
  return r.customers
    .filter((c) => c.customer === customer)
    .map((c): Effect => {
      const before = c.before?.kind === 'cords' ? c.before.sides : [];
      const after = c.after?.kind === 'cords' ? c.after.sides : [];
      switch (r.kind) {
        case 'loses-power':
          return { kind: 'loses-power', cabinets: c.cabinets, before, certainty: c.certainty, contradictions: r.contradictions };
        case 'loses-cooling':
          return { kind: 'loses-cooling', cabinets: c.cabinets, certainty: c.certainty };
        case 'one-cord-left':
          return { kind: 'loses-feed', cabinets: c.cabinets, lost: before.filter((s) => !after.includes(s)), remaining: after, certainty: c.certainty };
        case 'new-single-fault':
          return { kind: 'second-fault', cabinets: c.cabinets, faults: r.secondFaults, certainty: c.certainty };
        case 'cooling-margin':
          return { kind: 'cooling-margin', cabinets: c.cabinets, pools: r.pools, faults: r.secondFaults };
      }
    });
}

interface Draft {
  readonly workOrder: WorkOrder;
  readonly asset: AnyId;
  readonly says: string;
  readonly customer: Id<'customer'>;
  readonly name: string;
  readonly cabinets: readonly Id<'cabinet'>[];
  readonly effects: readonly NoticeEffect[];
}

const feeds = (sides: readonly Side[], cabs: readonly Id<'cabinet'>[]) => {
  const their = cabs.length === 1 ? 'its' : 'their';
  return sides.length === 2 ? `both ${their} A and B feeds` : sides.length === 1 ? `${their} ${sides[0]} feed` : `${their} feeds`;
};
const has = (cabs: readonly Id<'cabinet'>[], one: string, many: string) => (cabs.length === 1 ? one : many);

function blockFor(n: Draft, history: readonly WorkOrder[]): NoticeBlock | null {
  const dark = n.effects.filter((e) => e.kind === 'loses-power' || e.kind === 'loses-cooling');
  if (dark.length === 0) return null;
  const parts: string[] = [];
  const workOrders: WorkOrder[] = [];
  const asset = tagOf(n.asset);
  for (const e of dark) {
    const cabs = cabinetRange(e.cabinets);
    if (e.kind === 'loses-cooling') {
      parts.push(`${cabs} ${has(e.cabinets, 'loses', 'lose')} cooling while ${asset} is ${n.says}.`);
      continue;
    }
    const x = e.contradictions[0];
    if (x) {
      const fix = [...x.workOrders].reverse().find((o) => o.status === 'CAN');
      parts.push(
        `${cabs}: with ${asset} ${n.says}, ${feeds(e.before, e.cabinets)} go dark. The ${x.labelledSide} feed lands on ${tagOf(x.entity)}, which is labelled ${x.labelledSide} but fed from ${tagOf(x.fedFrom)} on the ${x.tracedSide} side. ` +
          `A notice saying the ${x.labelledSide} feed remains would be false. Re-feed ${tagOf(x.entity)} from the ${x.labelledSide} side before this work.` +
          (fix ? ` Maximo shows the return, ${fix.wonum} ${fix.description}, was cancelled.` : ''),
      );
      if (fix) workOrders.push(fix);
    } else if (e.certainty === 'contingent') {
      parts.push(`${cabs}: no document says how ${has(e.cabinets, 'this cabinet is', 'these cabinets are')} fed, so Cascade cannot say ${has(e.cabinets, 'it keeps', 'they keep')} power. Find that record first.`);
    } else {
      const related = history.filter((o) => isOpen(o) && e.cabinets.some((c) => new RegExp(`\\b${tagOf(c)}\\b`).test(o.description)));
      parts.push(
        `${cabs} ${has(e.cabinets, 'has', 'have')} power only through ${feeds(e.before, e.cabinets)}, so with ${asset} ${n.says} ${has(e.cabinets, 'it goes', 'they go')} dark.` +
          related.map((o) => ` Open: ${o.wonum} ${o.description} (${WORK_ORDER_STATUS_WORDS[o.status]}).`).join(''),
      );
      workOrders.push(...related);
    }
  }
  return {
    reason: `Cannot send: no honest notice to ${n.name} can say a feed remains. ${parts.join(' ')}`,
    workOrders,
  };
}

function window(o: WorkOrder): string {
  const s = o.scheduledStart;
  if (!s) return 'not yet scheduled';
  const f = o.scheduledFinish;
  if (!f) return `${siteDay(s)} from ${s.slice(11, 16)} site time`;
  return f.slice(0, 10) === s.slice(0, 10)
    ? `${siteDay(s)}, ${s.slice(11, 16)} to ${f.slice(11, 16)} site time`
    : `${siteDay(s)} ${s.slice(11, 16)} to ${siteDay(f)} ${f.slice(11, 16)} site time`;
}

function summary(n: Draft): string {
  const kinds = new Set(n.effects.map((e) => e.kind));
  const cabsOf = (k: NoticeEffect['kind']) => cabinetRange(n.effects.filter((e) => e.kind === k).flatMap((e) => e.cabinets));
  if (kinds.has('loses-power')) return `Yes. ${cabsOf('loses-power')} would lose power.`;
  if (kinds.has('loses-cooling')) return `Yes. ${cabsOf('loses-cooling')} would lose cooling.`;
  if (kinds.has('loses-feed')) return `Yes. ${cabsOf('loses-feed')} will run on one power feed.`;
  if (kinds.size > 0) return 'Yes, with reduced redundancy. Your power feeds stay energized.';
  return `No. None of your cabinets${n.cabinets.length ? ` (${cabinetRange(n.cabinets)})` : ''} loses power, a power feed or cooling redundancy during this work. No action is needed.`;
}

function subjectOf(n: Draft): string {
  const o = n.workOrder;
  const when = o.scheduledStart ? `${siteDay(o.scheduledStart)} ${o.scheduledStart.slice(11, 16)}` : 'unscheduled';
  const verdict = n.effects.length === 0 ? 'no impact to your cabinets' : `affects ${cabinetRange([...new Set(n.effects.flatMap((e) => e.cabinets))])}`;
  return `DFW1 scheduled maintenance ${when} (${o.wonum}): ${verdict}`;
}

function effectLine(e: Effect, asset: string): string {
  const cabs = cabinetRange(e.cabinets);
  const may = (definite: string, contingent: string) => ('certainty' in e && e.certainty === 'contingent' ? contingent : definite);
  switch (e.kind) {
    case 'loses-power':
      return `${cabs}: ${e.before.length === 2 ? 'your A and B feeds would both be de-energized' : e.before.length === 1 ? `your ${e.before[0]} feed would be de-energized, and ${has(e.cabinets, 'this cabinet has', 'these cabinets have')} no other feed` : 'your feeds would be de-energized'}. ${has(e.cabinets, 'It', 'They')} ${may('would be', 'may be')} without power for the window.`;
    case 'loses-cooling':
      return `${cabs}: cooling ${may('would be', 'may be')} lost for the window.`;
    case 'loses-feed':
      return `${cabs}: your ${e.lost.join(' and ')} feed will be de-energized. Your ${e.remaining.join(' and ')} feed remains. Please confirm every device in ${has(e.cabinets, 'this cabinet', 'these cabinets')} is powered from its ${e.remaining.join(' and ')} feed before the window starts.`;
    case 'second-fault':
      return `${cabs}: both feeds stay energized. During the window, a failure of ${faultList(e.faults)} ${may('would', 'could')} interrupt power to ${has(e.cabinets, 'this cabinet', 'these cabinets')}.`;
    case 'cooling-margin': {
      const p = e.pools.find((l) => l.after < l.before);
      const level = p ? `spare ${UNITS[p.units]} drop from ${renderSpare(p.before)} to ${renderSpare(p.after)} while ${asset} is out` : `cooling margin is reduced while ${asset} is out`;
      return `Cooling for ${cabs}: ${level}. Your power feeds are not affected. A failure of ${faultList(e.faults)} during the window would leave the hall short of cooling.`;
    }
  }
}

const UNITS = { chillers: 'chillers', pumps: 'chilled water pumps', crahs: 'CRAHs' } as const;

/** "SWGR-A-CB-2", "CH-1, CH-3 or ATS-A", "CH-1, CH-3, ATS-A or 3 other components". */
export function faultList(ids: readonly AnyId[]): string {
  const tags = ids.map(tagOf);
  if (tags.length <= 3) return tags.length > 1 ? `${tags.slice(0, -1).join(', ')} or ${tags.at(-1)}` : (tags[0] ?? 'another component');
  return `${tags.slice(0, 3).join(', ')} or ${tags.length - 3} other components`;
}

function bodyOf(n: Draft, contract: { readonly id: AnyId } | null, issuedOn: LocalDateTime): string {
  const o = n.workOrder;
  const asset = tagOf(n.asset);
  const lines = [
    `Scheduled maintenance notice: DFW1, Data Hall DH-1`,
    `Customer: ${n.name} (account ${tagOf(n.customer)})`,
    '',
    `Are you affected? ${summary(n)}`,
    '',
    `Work: ${o.wonum}, ${o.description}`,
    `What happens: ${asset} ${n.says}`,
    `When: ${window(o)}`,
  ];
  if (n.effects.length > 0) {
    lines.push('', 'Your cabinets during the work:', ...n.effects.map((e) => `- ${e.line}`));
    if (n.effects.some((e) => 'certainty' in e && e.certainty === 'contingent')) {
      lines.push('', 'Some of this depends on records we do not have yet. We will confirm before the window.');
    }
  }
  lines.push(
    '',
    `Issued ${siteDay(issuedOn)} by DFW1 site operations${contract ? ` under ${tagOf(contract.id)}, section 9 (Scheduled Maintenance)` : ''}.`,
    'Questions or concerns: reply to this message.',
  );
  return lines.join('\n');
}
