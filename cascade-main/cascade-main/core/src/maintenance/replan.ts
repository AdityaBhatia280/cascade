// Mid-job replan: a second fault during a work order's window. `propagate` says what the plant loses;
// for a hall left short of cooling, the lumped heat model (physics/heat.ts) turns the engine's deficit
// into minutes until the cold aisle crosses the hall's maximum inlet temperature. The immediate actions
// are the engine's own what-ifs: start a standby unit, return the asset under work, shed the deficit.

import type { Analysis } from '../analysis/analysis.js';
import { internalsOf } from '../analysis/analysis.js';
import type { AnyId, Id } from '../facility/ids.js';
import { kindOf, tagOf } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import type { SiteHistory } from '../history/history.js';
import { cToF, HEAT_MODEL_PARAMETERS, minutesToLimit, type Countdown } from '../physics/heat.js';
import { coolingBalance, propagate, type Initiator, type Propagation, type SupplyGraph } from '../physics/supply.js';
import { assessWorkOrders, cabinetRange, sharedFeeds, type WorkAssessment } from './assessment.js';
import { contingenciesOf } from './mop.js';
import type { LocalDateTime, WorkOrder } from './work-orders.js';

export interface ThermalPhase {
  /** "CH-3 not yet carrying load", "CH-3 carrying load", or the hall as the engine leaves it. */
  readonly label: string;
  readonly coolingKw: number;
  readonly deficitKw: number;
  readonly countdown: Countdown;
}

export interface ThermalCountdown {
  readonly hall: AnyId;
  readonly heatKw: number;
  readonly limitF: number;
  readonly startF: number;
  /** Where the start reading comes from: the warmest cold aisle at the last trend sample. */
  readonly startLabel: string;
  readonly startAt: LocalDateTime;
  readonly phases: readonly ThermalPhase[];
}

export interface ModelParameter {
  readonly name: string;
  readonly value: string;
  readonly basis: 'record' | 'engine' | 'modeled';
  readonly source: string;
}

export interface Replan {
  readonly workOrder: WorkOrder;
  readonly fault: AnyId;
  readonly events: readonly Initiator[];
  readonly headline: string;
  readonly countdown: ThermalCountdown | null;
  readonly affected: readonly string[];
  readonly actions: readonly string[];
  readonly parameters: readonly ModelParameter[];
}

export interface ReplanInput {
  readonly an: Analysis;
  readonly order: WorkOrder;
  readonly history: readonly WorkOrder[];
  readonly site: SiteHistory;
  readonly asOf: LocalDateTime;
  readonly fault: AnyId;
}

type Assessed = Extract<WorkAssessment, { assessed: true }>;
const RANK = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function replan({ an, order, history, site, asOf, fault }: ReplanInput): Replan | { readonly why: string } {
  const assessed = assessWorkOrders(an, [order], history)[0]!;
  if (!assessed.assessed) return { why: assessed.why };
  const choices = contingenciesOf(assessed);
  if (!choices.includes(fault)) return { why: `${tagOf(fault)} is not one of the engine's second faults for ${order.wonum} (${choices.map(tagOf).join(', ') || 'none'})` };

  const { graph: g } = internalsOf(an);
  const f = an.facility;
  const run = (events: readonly Initiator[], timed = false) => propagate(g, events, { timed });
  const fails = (target: AnyId): Initiator => ({ target, how: 'fails', atMin: 0 });
  const work = assessed.work;
  const events = [...work.events, fails(fault)];
  const p = run(events);
  const pw = run(work.events);
  const failing = (x: Propagation, id: AnyId) => RANK[x.final.get(id)?.state ?? (g.baseline.has(id) ? 'unknown' : 'up')] >= RANK.unknown;
  const customerName = (c: Id<'customer'>) => displayFact(f.get(c).name) ?? tagOf(c);
  const customerOf = (cab: AnyId): Id<'customer'> | null => {
    const owner = f.get(cab as Id<'cabinet'>).customer;
    return owner.kind === 'known' ? owner.value : null;
  };
  const byCustomer = (cabs: readonly AnyId[]) => {
    const m = new Map<Id<'customer'>, AnyId[]>();
    for (const c of [...cabs].sort()) {
      const k = customerOf(c);
      if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return [...m];
  };

  // Who loses power: cabinets the fault drops that the work alone does not, timed by batteries.
  const timed = run(events, true);
  const cabinets = [...g.nodes.values()].filter((n) => n.supply.rule === 'any-cord').map((n) => n.id);
  const powerLost = cabinets.filter((c) => failing(p, c) && !failing(pw, c) && p.final.get(c)?.cause.kind !== 'thermal');
  const affected: string[] = byCustomer(powerLost).map(([customer, cabs]) => {
    const at = Math.min(...cabs.map((c) => timed.final.get(c)?.tMin ?? 0));
    return `${customerName(customer)} ${cabinetRange(cabs)} lose${cabs.length === 1 ? 's' : ''} power ${at > 0 ? `after ${round1(at)} min on battery` : 'immediately'}.`;
  });

  // Halls short of cooling, and the countdown.
  const countdowns: ThermalCountdown[] = [];
  const parameters: ModelParameter[] = [];
  const actions: string[] = [];
  for (const [hall, pool] of g.halls) {
    const deficit = hallDeficit(g, p, hall);
    if (deficit === null) continue;
    const hallEntity = f.get(hall as Id<'hall'>);
    const limitRead = hallEntity.maxInletC;
    const start = warmestAisle(site, hall, asOf);
    const live = pool.cabinets.map((c) => c.id).filter((c) => !failing(p, c) || p.final.get(c)?.cause.kind === 'thermal');
    const heatKw = round1(live.reduce((s, c) => s + (g.cabinetLoadKw.get(c)?.kw ?? 0), 0));
    const standby = standbyChillers(an, g, hall).filter((id) => !events.some((e) => e.target === id) && !failing(p, id));
    const cold = standby.length > 0 ? hallDeficit(g, run([...events, ...standby.map(fails)]), hall) : null;
    const limitF = limitRead.kind === 'known' ? round1(cToF(limitRead.value)) : null;
    const headroomK = limitF !== null && start ? ((limitF - start.value) * 5) / 9 : null;
    const phase = (label: string, d: number): ThermalPhase => ({
      label,
      coolingKw: round1(Math.max(0, heatKw - d)),
      deficitKw: round1(d),
      countdown: headroomK === null ? { minutes: null, low: null, high: null } : minutesToLimit(headroomK, heatKw, d),
    });
    const names = standby.map(tagOf).join(' and ');
    const phases = cold !== null && cold > deficit + 1e-6 ? [phase(`${names} not yet carrying load`, cold), phase(`${names} carrying load`, deficit)] : [phase(`${tagOf(hall)} as the engine leaves it`, deficit)];
    if (limitF !== null && start) countdowns.push({ hall, heatKw, limitF, startF: start.value, startLabel: start.label, startAt: start.at, phases });

    parameters.push(
      { name: `IT heat in ${tagOf(hall)}`, value: `${heatKw} kW`, basis: 'record', source: `sum of measured load on ${live.length} cabinets` },
      { name: 'Cooling left', value: phases.map((x) => `${x.coolingKw} kW (${x.label})`).join('; '), basis: 'engine', source: 'propagate: live chillers, pumps and CRAHs at their rated capacity' },
      ...(start ? [{ name: 'Starting cold-aisle temperature', value: `${start.value} °F`, basis: 'record' as const, source: `${start.label}, ${start.at} (warmest aisle at the last sample)` }] : []),
      ...(limitF !== null ? [{ name: 'Limit', value: `${limitF} °F`, basis: 'record' as const, source: `${tagOf(hall)} maximum inlet (ASHRAE recommended upper bound, 27 °C)` }] : []),
      ...HEAT_MODEL_PARAMETERS.map((x) => ({ ...x, basis: 'modeled' as const })),
    );

    // Immediate actions, each checked by running the engine with the action taken.
    const fmt = (c: Countdown) => (c.minutes === null ? 'no countdown' : `${c.minutes} min (${c.low}–${c.high})`);
    if (phases.length === 2) {
      actions.push(`Start ${names} now (standby). Deficit ${phases[0]!.deficitKw} → ${phases[1]!.deficitKw} kW; ${fmt(phases[0]!.countdown)} → ${fmt(phases[1]!.countdown)} to ${limitF} °F.`);
    }
    const back = hallDeficit(g, run([fails(fault)]), hall);
    actions.push(back === null
          ? `Stop the work and return ${tagOf(work.asset)} to service: with it running, ${tagOf(hall)} has no cooling deficit.`
          : `Return ${tagOf(work.asset)} to service: the deficit falls to ${round1(back)} kW.`);
    for (const s of sharedFeeds(g, work.asset)) {
      const reliedOn = standby.includes(s.unit) || !failing(p, s.unit);
      if (!reliedOn) continue;
      const without = hallDeficit(g, run([...events, fails(s.feed)]), hall);
      actions.push(`Restore ${tagOf(work.asset)} without opening ${tagOf(s.feed)}: ${tagOf(s.unit)} is on the same feed${without !== null ? `, and a ${tagOf(s.feed)} trip now leaves ${tagOf(hall)} ${round1(without)} kW short` : ''}.`);
    }
    const remaining = phases.at(-1)!;
    if (remaining.deficitKw > 0) {
      actions.push(`If ${tagOf(work.asset)} cannot carry load ${remaining.countdown.minutes !== null ? `within ${remaining.countdown.low} min` : 'soon'}, shed at least ${remaining.deficitKw} kW of IT load in ${tagOf(hall)}.`);
    }
    affected.push(
      ...byCustomer(live).map(([customer, cabs]) => `${customerName(customer)} ${cabinetRange(cabs)} lose${cabs.length === 1 ? 's' : ''} cooling margin: ${tagOf(hall)} ${remaining.deficitKw} kW short${remaining.countdown.minutes !== null ? `, ${limitF} °F in about ${remaining.countdown.minutes} min (modeled)` : ''}.`),
    );
  }

  if (powerLost.length > 0) {
    const restored = cabinets.filter((c) => failing(p, c) && !failing(run([fails(fault)]), c));
    actions.push(restored.length
        ? `Back out the work: return ${tagOf(work.asset)} to service; ${restored.length} of the ${powerLost.length} cabinets get power back.`
        : `Returning ${tagOf(work.asset)} does not restore them: ${tagOf(fault)} alone drops them. Restore ${tagOf(fault)}.`);
  }

  const c = countdowns[0];
  const lead = `If ${tagOf(fault)} ${kindOf(fault) === 'chiller' || kindOf(fault) === 'pump' || kindOf(fault) === 'crah' ? 'trips' : 'fails'} while ${tagOf(work.asset)} is ${work.says}`;
  const headline = c
    ? `${lead}: ${tagOf(c.hall)} reaches ${c.limitF} °F in about ${c.phases.map((x) => `${x.countdown.minutes ?? '∞'} min (${x.label})`).join(', ')}. Modeled.`
    : powerLost.length
      ? `${lead}: ${byCustomer(powerLost).map(([k, cabs]) => `${customerName(k)} ${cabinetRange(cabs)}`).join(', ')} lose power.`
      : `${lead}: the engine finds no customer loses power or cooling.`;
  return { workOrder: order, fault, events, headline, countdown: c ?? null, affected, actions, parameters };
}

/**
 * The hall's cooling deficit the moment the scenario lands: the engine's cooling balance over the units
 * the scenario leaves running, against the heat of every cabinet that still has power. (A propagation's
 * final hall transition records the first deficit that took the hall down, not the largest.)
 */
function hallDeficit(g: SupplyGraph, p: Propagation, hall: AnyId): number | null {
  const stateOf = (id: AnyId) => {
    const s = p.final.get(id)?.state ?? (g.baseline.has(id) ? 'unknown' : 'up');
    return s === 'down' ? 'down' : s === 'unknown' ? 'unknown' : 'up';
  };
  const powered = (cab: AnyId) => stateOf(cab) === 'up' || p.final.get(cab)?.cause.kind === 'thermal';
  const demand = new Map([...g.halls].map(([h, pool]) => [h, pool.cabinets.filter((c) => powered(c.id)).reduce((s, c) => s + (g.cabinetLoadKw.get(c.id)?.kw ?? 0), 0)]));
  const d = coolingBalance(g, stateOf, demand).halls.get(hall)?.deficitKw ?? 0;
  return d > 1e-6 ? d : null;
}

/** Chillers documented as standby in the loops that serve a hall's CRAHs. */
function standbyChillers(an: Analysis, g: SupplyGraph, hall: AnyId): AnyId[] {
  const loops = new Set(g.halls.get(hall)?.crahs.flatMap((m) => m.loops) ?? []);
  return [...loops].flatMap((l) =>
    (g.loops.get(l)?.chillers ?? [])
      .map((m) => m.id)
      .filter((id) => {
        const role = an.facility.get(id as Id<'chiller'>).role;
        return role.kind === 'known' && role.value === 'standby';
      }),
  );
}

/** The warmest of a hall's temperature series at their last sample at or before `asOf`. */
function warmestAisle(site: SiteHistory, hall: AnyId, asOf: LocalDateTime) {
  let best: { value: number; at: LocalDateTime; label: string } | null = null;
  for (const s of site.trends) {
    if (s.entity !== hall || !/F$/.test(s.unit)) continue;
    const last = [...s.samples].reverse().find((x) => x.value !== null && x.at <= asOf);
    if (!last || last.value === null) continue;
    if (!best || last.at > best.at || (last.at === best.at && last.value > best.value)) best = { value: last.value, at: last.at, label: s.label };
  }
  return best;
}
