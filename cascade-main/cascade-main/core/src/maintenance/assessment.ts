// Planned-work assessment: for each work order, what its text says goes out of service, what the
// engine says that does to customers, and the records behind it. Every grade comes from
// `propagate` over the analysis's compiled graph; nothing here decides physics.
//
// Each reason the engine finds forces a risk grade (REASON_GRADE); the work's grade is the worst of
// its reasons, low with none. Reasons come from the work's scenario with timing off (a work window
// lasts hours, so battery and thermal ride-through only delay the outcome).

import { RISK_GRADES, WORK_REASON_KINDS, type Certainty, type CoolingUnits, type RiskGrade, type Side, type WorkReasonKind } from '../contract.js';
import type { Analysis } from '../analysis/analysis.js';
import { internalsOf } from '../analysis/analysis.js';
import type { Usd } from '../analysis/money.js';
import type { AnyId, FactRef, Id } from '../facility/ids.js';
import { kindOf, tagOf } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import { isPowerRole, propagate, type Initiator, type Propagation, type SupplyGraph, type Transition } from '../physics/supply.js';
import type { WorkOrder } from './work-orders.js';

// ───────────────────────────── What the work takes out ─────────────────────────────

interface WorkEffectRule {
  readonly words: RegExp;
  readonly how: Initiator['how'];
  /** How the operator would say it: "PDU-3A shut down". */
  readonly says: string;
}

/**
 * The one table from a work order's description to the scenario the engine runs. First match wins.
 * `fails` means the asset carries nothing for the window; `maintenance` on a UPS with a bypass moves
 * its output to the bypass. A generator under test is treated as out of automatic standby.
 */
export const WORK_EFFECTS: readonly WorkEffectRule[] = [
  { words: /\bMAINT(?:ENANCE)?\.? BYPASS\b/, how: 'maintenance', says: 'on maintenance bypass' },
  { words: /\bSHUTDOWN\b|\bSHUT DOWN\b|\bDE-?ENERGI[SZ]/, how: 'fails', says: 'shut down' },
  { words: /\bOFFLINE\b|\bOUT OF SERVICE\b|\bLOCKOUT\b|\bLOTO\b/, how: 'fails', says: 'offline' },
  { words: /\bLOAD RUN\b|\bLOAD BANK\b|\bTRANSFER TEST\b/, how: 'fails', says: 'out of automatic standby for the test' },
  { words: /\bFILTER CHANGE\b/, how: 'fails', says: 'stopped for the filter change' },
];

// ───────────────────────────── Result types ─────────────────────────────

/** The grade each kind of reason forces. */
export const REASON_GRADE: { readonly [K in WorkReasonKind]: Exclude<RiskGrade, 'low'> } = {
  /** No path left, or the records cannot show one. */
  'loses-power': 'highest',
  'loses-cooling': 'highest',
  /** A customer's last cord, or the last source upstream of both cords: one more fault is an outage. */
  'one-cord-left': 'high',
  'new-single-fault': 'high',
  /** Customers keep both power paths; one more cooling trip leaves the hall short. */
  'cooling-margin': 'medium',
};

const GRADES_WORST_FIRST = Object.keys(RISK_GRADES) as RiskGrade[];

const gradeOf = (reasons: readonly { readonly kind: WorkReasonKind }[]): RiskGrade =>
  GRADES_WORST_FIRST.find((g) => reasons.some((r) => REASON_GRADE[r.kind] === g)) ?? 'low';

/** Spare units in a pool: N+`spare`. -1 = short (the pool cannot meet its load). */
export interface PoolLevel {
  readonly pool: AnyId;
  readonly units: CoolingUnits;
  readonly before: number;
  readonly after: number;
}

export type Redundancy =
  /** Power: the labelled sides of the cords still carrying the cabinet. [] = none. */
  | { readonly kind: 'cords'; readonly sides: readonly Side[] }
  | { readonly kind: 'cooling'; readonly units: CoolingUnits; readonly spare: number };

export interface AffectedCustomer {
  readonly customer: Id<'customer'>;
  readonly cabinets: readonly Id<'cabinet'>[];
  /** null when the change is upstream of the cabinet and its cords look the same before and after. */
  readonly before: Redundancy | null;
  readonly after: Redundancy | null;
  readonly certainty: Certainty;
  readonly revenueExposed: Usd;
  /** The contract clause that promises the redundancy this reason is about. */
  readonly promise: FactRef | null;
}

export interface SharedFeed {
  readonly unit: AnyId;
  readonly feed: AnyId;
  /** The two power facts: the asset's feed and the unit's. */
  readonly refs: readonly FactRef[];
}

/** A panel or cord documented as one side that traces, through its feeds, to the other. */
export interface Contradiction {
  readonly entity: AnyId;
  readonly labelledSide: Side;
  readonly tracedSide: Side;
  /** The fact that labels it (e.g. the register's side column). */
  readonly label: FactRef;
  /** What it is actually fed from. */
  readonly fedFrom: AnyId;
  /** Feed facts from the entity up to the side-labelled UPS or switchgear it reaches, then that label. */
  readonly trace: readonly FactRef[];
  /** Work orders on that entity, oldest first. */
  readonly workOrders: readonly WorkOrder[];
}

export interface WorkReason {
  readonly kind: WorkReasonKind;
  readonly certainty: Certainty;
  readonly customers: readonly AffectedCustomer[];
  readonly revenueExposed: Usd;
  /** Single further faults that would cause this outage during the work and do not today. */
  readonly secondFaults: readonly AnyId[];
  /** Single faults that already cause it today and still do. */
  readonly standingFaults: readonly AnyId[];
  readonly pools: readonly PoolLevel[];
  /** Cooling: units of the same pool on the same feed as the asset under work. */
  readonly sharedFeeds: readonly SharedFeed[];
  readonly contradictions: readonly Contradiction[];
  readonly text: string;
}

export interface PlannedWork {
  readonly asset: AnyId;
  readonly says: string;
  readonly events: readonly Initiator[];
}

export type WorkAssessment =
  | { readonly workOrder: WorkOrder; readonly assessed: false; readonly why: string }
  | {
      readonly workOrder: WorkOrder;
      readonly assessed: true;
      readonly grade: RiskGrade;
      readonly work: PlannedWork;
      readonly reasons: readonly WorkReason[];
      /** Pools whose spare count changes, or that the asset belongs to. */
      readonly pools: readonly PoolLevel[];
      /** Plant that changes mode without costing a customer anything: a UPS on bypass, an ATS on its alternate. */
      readonly plant: readonly AnyId[];
      readonly headline: string;
    };

// ───────────────────────────── Assessment ─────────────────────────────

const RANK = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;
type State = Transition['state'];

export function plannedWork(o: WorkOrder): PlannedWork | { readonly why: string } {
  if (!o.asset) return { why: `${o.wonum} names no asset, only location ${o.location}` };
  if (!o.asset.resolved) return { why: o.asset.why };
  const rule = WORK_EFFECTS.find((r) => r.words.test(o.description.toUpperCase()));
  if (!rule) return { why: `the description does not say ${tagOf(o.asset.entity)} goes out of service` };
  return { asset: o.asset.entity, says: rule.says, events: [{ target: o.asset.entity, how: rule.how, atMin: 0 }] };
}

/** Assesses each work order against one analysis. `history` is every work order, for the record trail. */
export function assessWorkOrders(an: Analysis, orders: readonly WorkOrder[], history: readonly WorkOrder[]): readonly WorkAssessment[] {
  const { graph: g, book, spofs } = internalsOf(an);
  const f = an.facility;
  const run = (events: readonly Initiator[]) => propagate(g, events, { timed: false });
  const baseState = (id: AnyId): State => (g.baseline.has(id) ? 'unknown' : 'up');
  const stateIn = (p: Propagation | ReadonlyMap<AnyId, Transition>, id: AnyId): State => {
    const final = 'final' in p ? p.final : p;
    return final.get(id)?.state ?? baseState(id);
  };
  const failing = (s: State) => RANK[s] >= RANK.unknown;
  const cabinets = [...g.nodes.values()].filter((n) => n.supply.rule === 'any-cord').map((n) => n.id as Id<'cabinet'>);
  const today = spofs().runs;
  const levelsToday = poolLevels(g, run, []);

  const customerOf = (cab: Id<'cabinet'>): Id<'customer'> | null => {
    const owner = f.get(cab).customer;
    return owner.kind === 'known' ? owner.value : null;
  };
  const promiseOf = (customer: Id<'customer'>, term: 'power-redundancy' | 'cooling-redundancy'): FactRef | null => {
    for (const c of f.list('contract')) {
      if (c.customer.kind !== 'known' || c.customer.value !== customer) continue;
      for (const t of c.terms) if (t.kind === 'known' && t.value.term === term) return t.ref;
    }
    return null;
  };
  const cordSides = (cab: Id<'cabinet'>, p: Propagation | null): Side[] => {
    const s = g.nodes.get(cab)?.supply;
    if (s?.rule !== 'any-cord') return [];
    const live = s.cords.filter((c) => (p ? stateIn(p, c) : baseState(c)) === 'up');
    return [...new Set(live.map((c) => g.cordLabel.get(c)).filter((x): x is Side => !!x))].sort();
  };

  const promiseFor = (cooling: boolean) => (c: Id<'customer'>) => promiseOf(c, cooling ? 'cooling-redundancy' : 'power-redundancy');

  /** Groups cabinets by customer, by their before → after redundancy, and by certainty. */
  const affected = (
    cabs: readonly Id<'cabinet'>[],
    change: (cab: Id<'cabinet'>) => { before: Redundancy | null; after: Redundancy | null },
    certainty: (cab: Id<'cabinet'>) => Certainty,
    promise: (c: Id<'customer'>) => FactRef | null,
  ): AffectedCustomer[] => {
    const groups = new Map<string, Omit<AffectedCustomer, 'revenueExposed' | 'promise'> & { cabinets: Id<'cabinet'>[] }>();
    for (const cab of [...cabs].sort()) {
      const customer = customerOf(cab);
      if (!customer) continue;
      const c = { ...change(cab), certainty: certainty(cab) };
      const key = JSON.stringify([customer, c]);
      const cur = groups.get(key);
      if (cur) cur.cabinets.push(cab);
      else groups.set(key, { customer, cabinets: [cab], ...c });
    }
    return [...groups.values()].map((x) => ({ ...x, revenueExposed: book.exposed(x.cabinets), promise: promise(x.customer) }));
  };

  const contradictionsFor = (cabs: readonly Id<'cabinet'>[], wonum: string): Contradiction[] => {
    const out = new Map<AnyId, Contradiction>();
    for (const cab of cabs) {
      for (const cord of an.paths(cab).cords) {
        if (!cord.labelledSide || !cord.derivedSide || cord.labelledSide === cord.derivedSide) continue;
        const c = crossover(g, cord.cord, cord.labelledSide, cord.derivedSide, f);
        if (!c || out.has(c.entity)) continue;
        const workOrders = history.filter((o) => o.wonum !== wonum && o.asset?.resolved && o.asset.entity === c.entity);
        out.set(c.entity, { ...c, workOrders: [...workOrders].sort((x, y) => x.reported.localeCompare(y.reported)) });
      }
    }
    return [...out.values()];
  };

  const standingFor = (cabs: readonly Id<'cabinet'>[], cooling: boolean, targets: ReadonlySet<AnyId>) =>
    sortedIds(cabs.flatMap((c) => (spofs().byCabinet.get(c) ?? []).filter((e) => (e.cause === 'thermal') === cooling && !targets.has(e.component)).map((e) => e.component)));

  return orders.map((o): WorkAssessment => {
    const work = plannedWork(o);
    if ('why' in work) return { workOrder: o, assessed: false, why: work.why };
    const targets = new Set(work.events.map((e) => e.target));
    const pw = run(work.events);
    const levelsAfter = poolLevels(g, run, work.events);
    const reasons: Omit<WorkReason, 'text'>[] = [];
    const certaintyIn = (p: ReadonlyMap<AnyId, Transition>) => (cab: Id<'cabinet'>) => certaintyOf([p.get(cab)!]);
    const cords = (cab: Id<'cabinet'>) => ({ before: { kind: 'cords', sides: cordSides(cab, null) }, after: { kind: 'cords', sides: cordSides(cab, pw) } }) as const;

    // Highest: cabinets that lose all supply during the work. One reason per customer and change.
    const lost = cabinets.filter((c) => RANK[stateIn(pw, c)] > RANK[baseState(c)] && failing(stateIn(pw, c)));
    const thermal = (c: Id<'cabinet'>) => pw.final.get(c)?.cause.kind === 'thermal';
    for (const cooling of [false, true]) {
      const cabs = lost.filter((c) => thermal(c) === cooling);
      const change = (c: Id<'cabinet'>) => {
        const level = levelsToday.find((l) => l.pool === hallOf(g, c) && l.units === 'crahs')?.spare ?? 0;
        return cooling ? { before: { kind: 'cooling', units: 'crahs', spare: level } as const, after: { kind: 'cooling', units: 'crahs', spare: -1 } as const } : cords(c);
      };
      for (const group of affected(cabs, change, certaintyIn(pw.final), promiseFor(cooling))) {
        reasons.push({
          kind: cooling ? 'loses-cooling' : 'loses-power',
          certainty: group.certainty,
          customers: [group],
          revenueExposed: group.revenueExposed,
          secondFaults: [],
          standingFaults: [],
          pools: [],
          sharedFeeds: [],
          contradictions: cooling ? [] : contradictionsFor(group.cabinets, o.wonum),
        });
      }
    }

    // One further fault away. Every component whose failure can take a cabinet down is failed
    // on top of the work; a (fault, cabinet) pair counts when the cabinet survives the work alone
    // and survives the same fault today.
    const pairs: { fault: AnyId; cabinet: Id<'cabinet'>; tr: Transition; final: ReadonlyMap<AnyId, Transition> }[] = [];
    for (const [fault, todayRun] of [...today].sort(([x], [y]) => (x < y ? -1 : 1))) {
      if (targets.has(fault) || failing(stateIn(pw, fault))) continue;
      const p = run([...work.events, { target: fault, how: 'fails', atMin: 0 }]);
      for (const cab of cabinets) {
        if (!failing(stateIn(p, cab)) || failing(stateIn(pw, cab)) || failing(stateIn(todayRun.final, cab))) continue;
        pairs.push({ fault, cabinet: cab, tr: p.final.get(cab)!, final: p.final });
      }
    }
    const coolingPairs = pairs.filter((x) => x.tr.cause.kind === 'thermal');
    const powerPairs = pairs.filter((x) => x.tr.cause.kind !== 'thermal');

    const lastCord = cabinets.filter((c) => stateIn(pw, c) === 'exposed');
    for (const group of affected(lastCord, cords, certaintyIn(pw.final), promiseFor(false))) {
      reasons.push({
        kind: 'one-cord-left',
        certainty: group.certainty,
        customers: [group],
        revenueExposed: group.revenueExposed,
        secondFaults: sortedIds(powerPairs.filter((x) => group.cabinets.includes(x.cabinet)).map((x) => x.fault)),
        standingFaults: standingFor(group.cabinets, false, targets),
        pools: [],
        sharedFeeds: [],
        contradictions: contradictionsFor(group.cabinets, o.wonum),
      });
    }

    if (coolingPairs.length > 0) {
      const cabs = sortedIds(coolingPairs.map((x) => x.cabinet));
      const worst = new Map(coolingPairs.map((x) => [x.cabinet, x.tr]));
      const pools = changedLevels(levelsToday, levelsAfter, null);
      const members = new Set(levelsToday.flatMap((l) => l.members));
      reasons.push({
        kind: 'cooling-margin',
        certainty: certaintyOf([...worst.values()]),
        customers: affected(cabs, () => ({ before: null, after: null }), certaintyIn(worst), promiseFor(true)),
        revenueExposed: book.exposed(cabs),
        secondFaults: sortedIds(coolingPairs.map((x) => x.fault)).sort((x, y) => Number(members.has(y)) - Number(members.has(x))),
        standingFaults: standingFor(cabs, true, targets),
        pools,
        sharedFeeds: sharedFeeds(g, work.asset),
        contradictions: [],
      });
    }

    // Faults upstream of cabinets that keep both cords: grouped by the set of faults, the way an
    // operator reads it ("a SWGR-A-CB-2 trip drops these customers").
    const upstream = powerPairs.filter((x) => !lastCord.includes(x.cabinet));
    const faultsOf = new Map<Id<'cabinet'>, AnyId[]>();
    for (const x of upstream) (faultsOf.get(x.cabinet) ?? faultsOf.set(x.cabinet, []).get(x.cabinet)!).push(x.fault);
    const byFaults = new Map<string, Id<'cabinet'>[]>();
    for (const [cab, faults] of faultsOf) {
      const key = sortedIds(faults).join(' ');
      (byFaults.get(key) ?? byFaults.set(key, []).get(key)!).push(cab);
    }
    for (const [key, cabs] of byFaults) {
      const worst = new Map(upstream.filter((x) => cabs.includes(x.cabinet)).map((x) => [x.cabinet, x.tr]));
      reasons.push({
        kind: 'new-single-fault',
        certainty: certaintyOf([...worst.values()]),
        customers: affected(cabs, () => ({ before: null, after: null }), certaintyIn(worst), promiseFor(false)).sort((x, y) => y.revenueExposed - x.revenueExposed),
        revenueExposed: book.exposed(cabs),
        secondFaults: key.split(' ') as AnyId[],
        standingFaults: standingFor(cabs, false, targets),
        pools: [],
        sharedFeeds: [],
        contradictions: contradictionsFor(cabs, o.wonum),
      });
    }

    const ordered = reasons.sort(
      (x, y) => WORK_REASON_KINDS.indexOf(x.kind) - WORK_REASON_KINDS.indexOf(y.kind) || Number(x.certainty !== 'definite') - Number(y.certainty !== 'definite') || y.revenueExposed - x.revenueExposed,
    );
    const written = ordered.map((r): WorkReason => ({ ...r, text: reasonText(r, an, work) }));
    const pools = changedLevels(levelsToday, levelsAfter, work.asset);
    const plant = sortedIds([...pw.final.values()].filter((t) => t.state === 'exposed' && kindOf(t.id) !== 'cabinet').map((t) => t.id));
    return { workOrder: o, assessed: true, grade: gradeOf(written), work, reasons: written, pools, plant, headline: written[0]?.text ?? lowText(work, pools, plant) };
  });
}

// ───────────────────────────── Pools ─────────────────────────────

const POOL_UNITS: readonly { readonly units: CoolingUnits; readonly members: (g: SupplyGraph) => [AnyId, readonly AnyId[]][] }[] = [
  { units: 'chillers', members: (g) => [...g.loops].map(([id, p]) => [id, p.chillers.map((m) => m.id)]) },
  { units: 'pumps', members: (g) => [...g.loops].map(([id, p]) => [id, p.pumps.map((m) => m.id)]) },
  { units: 'crahs', members: (g) => [...g.halls].map(([id, p]) => [id, p.crahs.map((m) => m.id)]) },
];

/** Spare units per pool under `events`: the most members that can fail at once, in any combination, before the pool runs short. */
export function poolLevels(g: SupplyGraph, run: (e: readonly Initiator[]) => Propagation, events: readonly Initiator[]): { pool: AnyId; units: CoolingUnits; spare: number; members: readonly AnyId[] }[] {
  const base = run(events);
  const short = (p: Propagation, pool: AnyId) => RANK[p.final.get(pool)?.state ?? 'up'] >= RANK.unknown;
  return POOL_UNITS.flatMap(({ units, members }) =>
    members(g).map(([pool, all]) => {
      if (short(base, pool)) return { pool, units, spare: -1, members: all };
      const live = all.filter((m) => !base.final.has(m));
      let spare = 0;
      for (let k = 1; k <= live.length; k++) {
        const holds = combinations(live, k).every((set) => !short(run([...events, ...set.map((m) => ({ target: m, how: 'fails' as const, atMin: 0 }))]), pool));
        if (!holds) break;
        spare = k;
      }
      return { pool, units, spare, members: all };
    }),
  );
}

export function changedLevels(
  before: ReturnType<typeof poolLevels>,
  after: ReturnType<typeof poolLevels>,
  asset: AnyId | null,
): PoolLevel[] {
  return before.flatMap((b) => {
    const x = after.find((y) => y.pool === b.pool && y.units === b.units)!;
    return x.spare !== b.spare || (asset !== null && b.members.includes(asset)) ? [{ pool: b.pool, units: b.units, before: b.spare, after: x.spare }] : [];
  });
}

function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return xs.flatMap((x, i) => combinations(xs.slice(i + 1), k - 1).map((rest) => [x, ...rest]));
}

export function hallOf(g: SupplyGraph, cab: AnyId): AnyId | null {
  const s = g.nodes.get(cab)?.supply;
  return s?.rule === 'any-cord' ? (s.zone.to[0] ?? null) : null;
}

export function sharedFeeds(g: SupplyGraph, asset: AnyId): SharedFeed[] {
  const powerOf = (id: AnyId) => {
    const s = g.nodes.get(id)?.supply;
    return s?.rule === 'cooling-member' && s.power.to.length === 1 ? { feed: s.power.to[0]!, refs: s.power.refs } : null;
  };
  const mine = powerOf(asset);
  if (!mine) return [];
  const peers = [...g.loops.values()].flatMap((p) => [p.chillers, p.pumps]).concat([...g.halls.values()].map((h) => h.crahs));
  const pool = peers.find((ms) => ms.some((m) => m.id === asset)) ?? [];
  return pool.flatMap((m) => {
    const theirs = m.id === asset ? null : powerOf(m.id);
    return theirs && theirs.feed === mine.feed ? [{ unit: m.id, feed: mine.feed, refs: sortedRefs([...mine.refs, ...theirs.refs]) }] : [];
  });
}

// ───────────────────────────── Contradictions ─────────────────────────────

/**
 * Walks a cord's feed upward. The crossover is the last entity still labelled the cord's side before
 * the walk reaches a UPS or switchgear labelled the other side.
 */
function crossover(g: SupplyGraph, cord: Id<'cord'>, labelled: Side, traced: Side, f: Analysis['facility']): Omit<Contradiction, 'workOrders'> | null {
  let at: AnyId = cord;
  let cross: AnyId = cord;
  const seen = new Set<AnyId>();
  const walk: { to: AnyId; refs: readonly FactRef[] }[] = [];
  while (!seen.has(at)) {
    seen.add(at);
    const side = kindOf(at) === 'cord' ? g.cordLabel.get(at) : g.sideLabel.get(at);
    if (side === labelled) {
      cross = at;
      walk.length = 0;
    }
    if (side === traced && (kindOf(at) === 'ups' || kindOf(at) === 'switchgear')) {
      const label = labelRef(f, cross);
      const sourceLabel = labelRef(f, at);
      if (!label || !sourceLabel) return null;
      const from = walk[0]?.to;
      if (!from) return null;
      return { entity: cross, labelledSide: labelled, tracedSide: traced, label, fedFrom: from, trace: [...walk.flatMap((w) => w.refs), sourceLabel] };
    }
    const next = g.nodes.get(at)?.upstream.find((u) => isPowerRole(u.role) && u.edge.to.length === 1);
    if (!next) return null;
    walk.push({ to: next.edge.to[0]!, refs: next.edge.refs });
    at = next.edge.to[0]!;
  }
  return null;
}

function labelRef(f: Analysis['facility'], id: AnyId): FactRef | null {
  const e = f.get(id) as { readonly labelledSide?: { readonly ref: FactRef } };
  return e.labelledSide?.ref ?? null;
}

// ───────────────────────────── Words ─────────────────────────────

const UNIT_WORDS: { readonly [U in CoolingUnits]: string } = { chillers: 'Chillers', pumps: 'Chilled water pumps', crahs: 'CRAHs' };

export function renderRedundancy(r: Redundancy): string {
  if (r.kind === 'cords') return r.sides.length === 0 ? 'none' : r.sides.join('+');
  return renderSpare(r.spare);
}

export const renderSpare = (spare: number) => (spare < 0 ? 'short' : spare === 0 ? 'N' : `N+${spare}`);

/** "E01–E05", "D01–D05, D07–D10". */
export function cabinetRange(cabs: readonly AnyId[]): string {
  const tags = cabs.map(tagOf).sort();
  const runs: string[][] = [];
  for (const t of tags) {
    const last = runs.at(-1)?.at(-1);
    const m = /^(.*?)(\d+)$/.exec(t);
    const lm = last ? /^(.*?)(\d+)$/.exec(last) : null;
    if (m && lm && m[1] === lm[1] && Number(m[2]) === Number(lm[2]) + 1) runs.at(-1)!.push(t);
    else runs.push([t]);
  }
  return runs.map((r) => (r.length > 2 ? `${r[0]}–${r.at(-1)}` : r.join(', '))).join(', ');
}

const list = (ids: readonly AnyId[], max = 3) => {
  const tags = ids.map(tagOf);
  if (tags.length <= max) return tags.length > 1 ? `${tags.slice(0, -1).join(', ')} or ${tags.at(-1)}` : (tags[0] ?? '');
  return `${tags.slice(0, max).join(', ')} or ${tags.length - max} more`;
};

function customerName(an: Analysis, id: Id<'customer'>): string {
  return displayFact(an.facility.get(id).name) ?? tagOf(id);
}

function reasonText(r: Omit<WorkReason, 'text'>, an: Analysis, work: PlannedWork): string {
  const c = r.customers[0]!;
  const who = `${customerName(an, c.customer)} ${cabinetRange(c.cabinets)}`;
  const verb = (one: string, many: string) => (c.cabinets.length === 1 ? one : many);
  const change = c.before && c.after ? ` (${renderRedundancy(c.before)} → ${renderRedundancy(c.after)})` : '';
  const x = r.contradictions[0];
  const why = x ? ` ${tagOf(x.entity)}, labelled ${x.labelledSide}, is fed from ${tagOf(x.fedFrom)}.` : '';
  const lose = r.certainty === 'definite' ? verb('loses', 'lose') : 'may lose';
  const n = new Set(r.customers.map((x) => x.customer)).size;
  const customers = `${n} customer${n === 1 ? '' : 's'}`;
  switch (r.kind) {
    case 'loses-power':
      return `${who} ${lose} power${change}.${why}${r.certainty === 'definite' ? '' : ' A record it depends on is missing.'}`;
    case 'loses-cooling':
      return `${who} ${lose} cooling${change}.`;
    case 'one-cord-left':
      return `${who} ${verb('runs', 'run')} on one cord${change}.${why}`;
    case 'cooling-margin': {
      const p = r.pools.find((l) => l.after < l.before);
      const level = p ? `${UNIT_WORDS[p.units]} ${renderSpare(p.before)} → ${renderSpare(p.after)}. ` : '';
      return `${level}One more trip (${list(r.secondFaults)}) leaves ${customers} short of cooling.`;
    }
    case 'new-single-fault':
      return `With ${tagOf(work.asset)} ${work.says}, a ${list(r.secondFaults)} failure drops ${n === 1 ? who : `cabinets of ${customers}`}.`;
  }
}

function lowText(work: PlannedWork, pools: readonly PoolLevel[], plant: readonly AnyId[]): string {
  const p = pools[0];
  if (p) return `${UNIT_WORDS[p.units]} ${renderSpare(p.before)} → ${renderSpare(p.after)} with ${tagOf(work.asset)} ${work.says}. No customer loses redundancy.`;
  if (plant.length > 0) return `${list(plant)} ${plant.includes(work.asset) ? work.says : 'changes mode'}. No customer loses redundancy.`;
  return 'No customer loses power, cooling or redundancy.';
}

// ───────────────────────────── Small helpers ─────────────────────────────

const certaintyOf = (trs: readonly Transition[]): Certainty =>
  trs.every((t) => t.state !== 'unknown' && t.contingentOn.length === 0) ? 'definite' : 'contingent';

const sortedIds = <T extends string>(xs: readonly T[]): T[] => [...new Set(xs)].sort();
const sortedRefs = (xs: readonly FactRef[]): FactRef[] => [...new Set(xs)].sort();

