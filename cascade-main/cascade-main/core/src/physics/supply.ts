// The ONE physics engine. Every question about "is X powered/cooled, and when does that change?"
// — what-if, SPOF/convergence analysis, failover headroom, planner verification — is answered by
// `propagate` over a SupplyGraph. There is no second evaluator to drift from this one.
//
// Private to core (not re-exported from index.ts). Analysis owns the compiled graph.

import type { Side, SupplyState } from '../contract.js';
import { BREAKER_TRIP_DELAY_MIN, GENERATOR_START_MIN_DEFAULT, POWER_FACTOR, RIDE_THROUGH_MIN_AT_FULL_LOSS } from '../constants.js';
import type { Rating } from '../facility/entities.js';
import type { Facility } from '../facility/facility.js';
import type { Fact } from '../facility/fact.js';
import type { AnyId, FactRef, Id } from '../facility/ids.js';
import { kindOf } from '../facility/ids.js';

// ───────────────────────────── Compiled graph ─────────────────────────────

/**
 * One reference. `to` holds the target, or nothing when the fact is missing. `refs` are the facts
 * that established the edge; an outcome that hinges on a missing one lists it in `contingentOn`.
 */
export interface SupplyEdge {
  readonly to: readonly AnyId[];
  readonly refs: readonly FactRef[];
}

/** Rated capacity after unit conversion (no derate: devices trip at nameplate). */
export interface Capacity {
  readonly kw: number;
  readonly refs: readonly FactRef[];
}

/** Supply semantics per kind, fixed by the entity type. */
export type SupplyRule =
  | { readonly rule: 'source'; readonly startDelayMin: number }
  | { readonly rule: 'series'; readonly input: SupplyEdge }
  | { readonly rule: 'transfer'; readonly normal: SupplyEdge; readonly alternate: SupplyEdge }
  | { readonly rule: 'ups'; readonly input: SupplyEdge; readonly bypass: SupplyEdge | null; readonly batteryMin: number }
  /** Cabinet: ANY cord (load re-shared to survivors) AND its zone's cooling balance. */
  | { readonly rule: 'any-cord'; readonly cords: readonly Id<'cord'>[]; readonly zone: SupplyEdge }
  /** Cooling member: powered AND (chillers) its header up. Contributes capacity to its pool. */
  | {
      readonly rule: 'cooling-member';
      readonly role: 'chiller' | 'pump' | 'crah';
      readonly power: SupplyEdge;
      readonly via: SupplyEdge | null;
      /** Loop (chiller, pump) or hall (CRAH) whose capacity this member adds to. */
      readonly pool: SupplyEdge;
      /** CRAH only: the chilled-water loop it draws from. */
      readonly loop: SupplyEdge | null;
      readonly capacityKw: Capacity;
    }
  /** Loop / hall: capacity pool, evaluated by the cooling balance, not by `evaluate`. */
  | { readonly rule: 'pool'; readonly pool: 'loop' | 'hall' };

export type EdgeRole = 'input' | 'normal' | 'alternate' | 'bypass' | 'cord' | 'zone' | 'power' | 'via' | 'loop' | 'member';

export interface SupplyNode {
  readonly id: AnyId;
  readonly supply: SupplyRule;
  /** null = not capacity-limited (cords, headers, sources without a documented rating). */
  readonly capacity: Capacity | null;
  /** Every edge this node depends on, by role (power roles first). Pools list their members. */
  readonly upstream: readonly { readonly role: EdgeRole; readonly edge: SupplyEdge }[];
}

export interface PoolMember {
  readonly id: AnyId;
}

export interface CrahMember extends PoolMember {
  /** Empty when the CRAH's loop is missing. */
  readonly loops: readonly AnyId[];
}

export interface SupplyGraph {
  readonly nodes: ReadonlyMap<AnyId, SupplyNode>;
  readonly dependents: ReadonlyMap<AnyId, readonly AnyId[]>;
  /** Normal-operation load per node (kW), from measured cabinet loads shared equally over cords. */
  readonly normalLoadKw: ReadonlyMap<AnyId, number>;
  /** Load each node would carry if every cabinet behind it lost its other cords (opposite side lost). */
  readonly failoverLoadKw: ReadonlyMap<AnyId, number>;
  /** Heat demand per pool (hall/loop) in normal operation. */
  readonly normalDemandKw: ReadonlyMap<AnyId, number>;
  readonly cabinetLoadKw: ReadonlyMap<AnyId, { readonly kw: number; readonly refs: readonly FactRef[] }>;
  readonly cordShareKw: ReadonlyMap<AnyId, number>;
  readonly cabinetOfCord: ReadonlyMap<AnyId, Id<'cabinet'>>;
  readonly loops: ReadonlyMap<AnyId, { readonly chillers: readonly PoolMember[]; readonly pumps: readonly PoolMember[] }>;
  readonly halls: ReadonlyMap<AnyId, { readonly crahs: readonly CrahMember[]; readonly cabinets: readonly PoolMember[] }>;
  /** Nodes whose supply is already `unknown` in normal operation (a missing fact upstream). */
  readonly baseline: ReadonlyMap<AnyId, { readonly contingentOn: readonly FactRef[] }>;
  /** Documented side labels of UPS / switchgear / panels (display and derived-side only, never independence). */
  readonly sideLabel: ReadonlyMap<AnyId, Side>;
  readonly cordLabel: ReadonlyMap<AnyId, Side>;
}

const POWER_ROLES: ReadonlySet<EdgeRole> = new Set(['input', 'normal', 'alternate', 'bypass']);
export const isPowerRole = (r: EdgeRole) => POWER_ROLES.has(r);

const sortIds = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();
const union = (...lists: readonly (readonly FactRef[])[]): FactRef[] => sortIds(lists.flat());

/** null for a documented "none" (no bypass, no alternate). */
function edgeOf(fact: Fact<AnyId | null>): SupplyEdge | null {
  if (fact.kind === 'missing') return { to: [], refs: [fact.ref] };
  return fact.value === null ? null : { to: [fact.value], refs: [fact.ref] };
}

/** Follows an edge through a second reference on its target (cabinet → row → hall). */
function compose(first: SupplyEdge | null, step: (target: AnyId) => SupplyEdge | null): SupplyEdge {
  if (!first) return { to: [], refs: [] };
  const next = first.to.length === 1 ? step(first.to[0]!) : null;
  return { to: next?.to ?? [], refs: union(first.refs, next?.refs ?? []) };
}

export function ratingKw(r: Rating): number {
  switch (r.unit) {
    case 'kw':
      return r.kw;
    case 'kva':
      return r.kva * POWER_FACTOR;
    case 'amps':
      return (r.amps * r.volts * (r.phases === 3 ? Math.sqrt(3) : 1) * POWER_FACTOR) / 1000;
  }
}

function capacityOf(fact: Fact<Rating>): Capacity | null {
  return fact.kind === 'known' ? { kw: ratingKw(fact.value), refs: [fact.ref] } : null;
}

const quantityCapacity = (fact: Fact<number>): Capacity => ({ kw: fact.kind === 'known' ? fact.value : 0, refs: [fact.ref] });

const synthetic = (id: AnyId): SupplyEdge => ({ to: [id], refs: [] });

/** Compiles the graph from every topology, rating and load fact. Ratings are converted with POWER_FACTOR. */
export function compileSupply(f: Facility): SupplyGraph {
  const nodes = new Map<AnyId, SupplyNode>();
  const sideLabel = new Map<AnyId, Side>();
  const cordLabel = new Map<AnyId, Side>();
  const add = (id: AnyId, supply: SupplyRule, capacity: Capacity | null, upstream: SupplyNode['upstream']) =>
    nodes.set(id, { id, supply, capacity, upstream });
  const none: SupplyEdge = { to: [], refs: [] };
  const series = (id: AnyId, e: SupplyEdge | null, cap: Capacity | null) => {
    const input = e ?? none;
    add(id, { rule: 'series', input }, cap, [{ role: 'input', edge: input }]);
  };
  const label = (id: AnyId, fact: Fact<Side | null>) => {
    if (fact.kind === 'known' && fact.value !== null) sideLabel.set(id, fact.value);
  };

  for (const u of f.list('utility')) add(u.id, { rule: 'source', startDelayMin: 0 }, capacityOf(u.rating), []);
  for (const g of f.list('generator')) {
    const delay = g.startDelaySec.kind === 'known' ? g.startDelaySec.value / 60 : GENERATOR_START_MIN_DEFAULT;
    add(g.id, { rule: 'source', startDelayMin: delay }, capacityOf(g.rating), []);
  }
  for (const x of f.list('ats')) {
    const normal = edgeOf(x.normal) ?? none;
    const alternate = edgeOf(x.alternate) ?? none;
    add(x.id, { rule: 'transfer', normal, alternate }, capacityOf(x.rating), [
      { role: 'normal', edge: normal },
      { role: 'alternate', edge: alternate },
    ]);
  }
  for (const s of f.list('switchgear')) {
    series(s.id, edgeOf(s.input), capacityOf(s.rating));
    label(s.id, s.labelledSide);
  }
  for (const b of f.list('breaker')) series(b.id, edgeOf(b.bus), capacityOf(b.rating));
  for (const u of f.list('ups')) {
    const input = edgeOf(u.input) ?? none;
    const bypass = edgeOf(u.bypass);
    const batteryMin = u.batteryMin.kind === 'known' ? u.batteryMin.value : 0;
    add(u.id, { rule: 'ups', input, bypass, batteryMin }, capacityOf(u.rating), [
      { role: 'input', edge: input },
      ...(bypass ? [{ role: 'bypass' as const, edge: bypass }] : []),
    ]);
    label(u.id, u.labelledSide);
  }
  for (const p of [...f.list('pdu'), ...f.list('rpp')]) {
    series(p.id, edgeOf(p.input), capacityOf(p.rating));
    label(p.id, p.labelledSide);
  }
  for (const c of f.list('circuit')) series(c.id, edgeOf(c.panel), capacityOf(c.rating));
  for (const c of f.list('cord')) {
    series(c.id, edgeOf(c.circuit), null);
    if (c.labelledSide.kind === 'known') cordLabel.set(c.id, c.labelledSide.value);
  }

  const cabinetOfCord = new Map<AnyId, Id<'cabinet'>>();
  const cabinetLoadKw = new Map<AnyId, { kw: number; refs: FactRef[] }>();
  const zoneOf = new Map<AnyId, SupplyEdge>();
  for (const cab of f.list('cabinet')) {
    const cords = f.cordsOf(cab.id).map((c) => c.id);
    for (const c of cords) cabinetOfCord.set(c, cab.id);
    const zone = compose(edgeOf(cab.row), (row) => edgeOf(f.get(row as Id<'row'>).hall));
    zoneOf.set(cab.id, zone);
    cabinetLoadKw.set(cab.id, { kw: cab.measuredKw.kind === 'known' ? cab.measuredKw.value : 0, refs: [cab.measuredKw.ref] });
    add(cab.id, { rule: 'any-cord', cords, zone }, null, [...cords.map((c) => ({ role: 'cord' as const, edge: synthetic(c) })), { role: 'zone', edge: zone }]);
  }

  for (const h of f.list('header')) add(h.id, { rule: 'source', startDelayMin: 0 }, null, []);
  const memberEdges = new Map<AnyId, { member: AnyId; edge: SupplyEdge }[]>();
  const addMember = (pool: SupplyEdge, member: AnyId) => {
    for (const p of pool.to) {
      let list = memberEdges.get(p);
      if (!list) memberEdges.set(p, (list = []));
      list.push({ member, edge: { to: [member], refs: pool.refs } });
    }
  };
  for (const c of f.list('chiller')) {
    const power = edgeOf(c.power) ?? none;
    const via = edgeOf(c.header) ?? none;
    const pool = compose(edgeOf(c.header), (h) => edgeOf(f.get(h as Id<'header'>).loop));
    add(c.id, { rule: 'cooling-member', role: 'chiller', power, via, pool, loop: null, capacityKw: quantityCapacity(c.capacityKw) }, null, [
      { role: 'power', edge: power },
      { role: 'via', edge: via },
    ]);
    addMember(pool, c.id);
  }
  for (const p of f.list('pump')) {
    const power = edgeOf(p.power) ?? none;
    const pool = edgeOf(p.loop) ?? none;
    add(p.id, { rule: 'cooling-member', role: 'pump', power, via: null, pool, loop: null, capacityKw: quantityCapacity(p.capacityKw) }, null, [{ role: 'power', edge: power }]);
    addMember(pool, p.id);
  }
  for (const c of f.list('crah')) {
    const power = edgeOf(c.power) ?? none;
    const pool = edgeOf(c.hall) ?? none;
    const loop = edgeOf(c.loop) ?? none;
    add(c.id, { rule: 'cooling-member', role: 'crah', power, via: null, pool, loop, capacityKw: quantityCapacity(c.capacityKw) }, null, [
      { role: 'power', edge: power },
      { role: 'loop', edge: loop },
    ]);
    addMember(pool, c.id);
  }
  for (const l of f.list('loop')) {
    add(l.id, { rule: 'pool', pool: 'loop' }, null, (memberEdges.get(l.id) ?? []).map((m) => ({ role: 'member' as const, edge: m.edge })));
  }
  for (const h of f.list('hall')) {
    add(h.id, { rule: 'pool', pool: 'hall' }, null, (memberEdges.get(h.id) ?? []).map((m) => ({ role: 'member' as const, edge: m.edge })));
  }

  // Reverse adjacency.
  const deps = new Map<AnyId, Set<AnyId>>();
  for (const n of nodes.values()) {
    for (const { edge } of n.upstream) {
      for (const t of edge.to) {
        let s = deps.get(t);
        if (!s) deps.set(t, (s = new Set()));
        s.add(n.id);
      }
    }
  }
  const dependents = new Map<AnyId, readonly AnyId[]>([...deps].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, sortIds(v)]));

  // Pools.
  const loops = new Map<AnyId, { chillers: PoolMember[]; pumps: PoolMember[] }>();
  for (const l of f.list('loop')) loops.set(l.id, { chillers: [], pumps: [] });
  const halls = new Map<AnyId, { crahs: CrahMember[]; cabinets: PoolMember[] }>();
  for (const h of f.list('hall')) halls.set(h.id, { crahs: [], cabinets: [] });
  for (const n of nodes.values()) {
    const s = n.supply;
    if (s.rule === 'cooling-member') {
      for (const p of s.pool.to) {
        if (s.role === 'crah') halls.get(p)?.crahs.push({ id: n.id, loops: s.loop?.to ?? [] });
        else loops.get(p)?.[s.role === 'chiller' ? 'chillers' : 'pumps'].push({ id: n.id });
      }
    } else if (s.rule === 'any-cord') {
      for (const h of s.zone.to) halls.get(h)?.cabinets.push({ id: n.id });
    }
  }

  // Normal-operation loads: each cabinet's load split equally over its cords, walked up the normal paths.
  const normalLoadKw = new Map<AnyId, number>();
  const failover = new Map<AnyId, number>();
  const cordShareKw = new Map<AnyId, number>();
  const normalParents = (id: AnyId): readonly AnyId[] => {
    const s = nodes.get(id)?.supply;
    if (!s) return [];
    if (s.rule === 'series') return s.input.to;
    if (s.rule === 'transfer') return s.normal.to;
    if (s.rule === 'ups') return s.input.to;
    return [];
  };
  const walk = (start: AnyId, visit: (n: AnyId) => void) => {
    const seen = new Set<AnyId>();
    const stack: AnyId[] = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      visit(n);
      for (const p of normalParents(n)) stack.push(p);
    }
    return seen;
  };
  for (const cab of f.list('cabinet')) {
    const s = nodes.get(cab.id)!.supply as Extract<SupplyRule, { rule: 'any-cord' }>;
    const load = cabinetLoadKw.get(cab.id)!;
    if (s.cords.length === 0) continue;
    const reached = new Set<AnyId>();
    for (const c of s.cords) {
      cordShareKw.set(c, load.kw / s.cords.length);
      for (const n of walk(c, (n) => normalLoadKw.set(n, (normalLoadKw.get(n) ?? 0) + load.kw / s.cords.length))) reached.add(n);
    }
    for (const n of reached) failover.set(n, (failover.get(n) ?? 0) + load.kw);
  }

  // Normal heat demand per pool.
  const normalDemandKw = new Map<AnyId, number>();
  for (const [h, pool] of halls) normalDemandKw.set(h, pool.cabinets.reduce((s, c) => s + (cabinetLoadKw.get(c.id)?.kw ?? 0), 0));
  for (const [h, pool] of halls) {
    const caps = new Map<AnyId, number>();
    for (const c of pool.crahs) {
      if (c.loops.length === 0) continue;
      const cap = (nodes.get(c.id)!.supply as Extract<SupplyRule, { rule: 'cooling-member' }>).capacityKw.kw;
      caps.set(c.loops[0]!, (caps.get(c.loops[0]!) ?? 0) + cap);
    }
    const total = [...caps.values()].reduce((s, v) => s + v, 0);
    for (const [l, cap] of caps) if (total > 0) normalDemandKw.set(l, (normalDemandKw.get(l) ?? 0) + ((normalDemandKw.get(h) ?? 0) * cap) / total);
  }
  for (const l of loops.keys()) if (!normalDemandKw.has(l)) normalDemandKw.set(l, 0);

  const graphWithoutBaseline = {
    nodes,
    dependents,
    normalLoadKw: new Map([...normalLoadKw].sort(([x], [y]) => (x < y ? -1 : 1))),
    failoverLoadKw: failover,
    normalDemandKw,
    cabinetLoadKw,
    cordShareKw,
    cabinetOfCord,
    loops,
    halls,
    baseline: new Map(),
    sideLabel,
    cordLabel,
  } satisfies SupplyGraph;
  return { ...graphWithoutBaseline, baseline: computeBaseline(graphWithoutBaseline) };
}

// ───────────────────────────── Kleene evaluation ─────────────────────────────

type S3 = 'up' | 'unknown' | 'down';
interface Ev {
  readonly state: S3;
  readonly contingentOn: readonly FactRef[];
  readonly lost: readonly AnyId[];
}
const UP: Ev = { state: 'up', contingentOn: [], lost: [] };
const DOWN_EV: Ev = { state: 'down', contingentOn: [], lost: [] };
type Look = (id: AnyId) => Ev;

function edgeEv(e: SupplyEdge, look: Look): Ev {
  if (e.to.length === 0) return { state: 'unknown', contingentOn: e.refs, lost: [] };
  const target = look(e.to[0]!);
  return target.state === 'up' ? UP : { state: target.state, contingentOn: target.contingentOn, lost: e.to };
}

function kleeneOr(evs: readonly Ev[]): Ev {
  if (evs.some((e) => e.state === 'up')) return UP;
  const state: S3 = evs.every((e) => e.state === 'down') ? 'down' : 'unknown';
  return { state, contingentOn: union(...evs.map((e) => e.contingentOn)), lost: sortIds(evs.flatMap((e) => e.lost)) };
}

function kleeneAnd(evs: readonly Ev[]): Ev {
  const down = evs.find((e) => e.state === 'down');
  if (down) return down;
  const unk = evs.filter((e) => e.state === 'unknown');
  if (unk.length === 0) return UP;
  return { state: 'unknown', contingentOn: union(...unk.map((e) => e.contingentOn)), lost: sortIds(unk.flatMap((e) => e.lost)) };
}

/** Structural evaluation (no timing, no maintenance): used for the normal-operation baseline. */
function structural(n: SupplyNode, look: Look): Ev {
  const s = n.supply;
  switch (s.rule) {
    case 'source':
    case 'pool':
      return UP;
    case 'series':
      return edgeEv(s.input, look);
    case 'transfer':
      return kleeneOr([edgeEv(s.normal, look), edgeEv(s.alternate, look)]);
    case 'ups':
      return kleeneOr([edgeEv(s.input, look), s.bypass ? edgeEv(s.bypass, look) : DOWN_EV]);
    case 'any-cord':
      return s.cords.length === 0 ? DOWN_EV : kleeneOr(s.cords.map(look));
    case 'cooling-member':
      return kleeneAnd([edgeEv(s.power, look), ...(s.via ? [edgeEv(s.via, look)] : [])]);
  }
}

function computeBaseline(g: SupplyGraph): Map<AnyId, { contingentOn: readonly FactRef[] }> {
  const base = new Map<AnyId, Ev>();
  const look: Look = (id) => base.get(id) ?? UP;
  const queue = [...g.nodes.keys()].sort();
  const queued = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    queued.delete(id);
    if (base.has(id)) continue;
    const ev = structural(g.nodes.get(id)!, look);
    if (ev.state === 'up') continue;
    base.set(id, { ...ev, state: 'unknown' });
    for (const d of g.dependents.get(id) ?? []) {
      if (!queued.has(d) && !base.has(d)) {
        queue.push(d);
        queued.add(d);
      }
    }
  }
  return new Map([...base].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, { contingentOn: v.contingentOn }]));
}

// ───────────────────────────── Cooling balance ─────────────────────────────

export interface PoolBalance {
  readonly state: S3;
  /** Pessimistic deficit (kW): demand not met with only certainly-live members. */
  readonly deficitKw: number;
  readonly demandKw: number;
}

const EPS = 1e-6;

/**
 * Capacity pools against heat demand. Loop capacity = min(Σ live chillers, Σ live pumps); each
 * hall gets Σ live CRAH capacity, and each loop's demand is the share of hall demand its CRAHs
 * carry. Evaluated twice: pessimistic (members up) and optimistic (members not down);
 * deficit in both → down, only pessimistic → unknown.
 */
export function coolingBalance(
  g: SupplyGraph,
  stateOf: (id: AnyId) => S3,
  demand: ReadonlyMap<AnyId, number>,
): { readonly halls: ReadonlyMap<AnyId, PoolBalance>; readonly loops: ReadonlyMap<AnyId, PoolBalance> } {
  const cap = (id: AnyId) => (g.nodes.get(id)!.supply as Extract<SupplyRule, { rule: 'cooling-member' }>).capacityKw;
  const scenario = (optimistic: boolean) => {
    const live = (m: PoolMember) => (optimistic ? stateOf(m.id) !== 'down' : stateOf(m.id) === 'up');
    const value = (m: PoolMember) => (live(m) ? cap(m.id).kw : 0);
    const L = new Map<AnyId, number>();
    for (const [l, pool] of g.loops) {
      const ch = pool.chillers.reduce((s, m) => s + value(m), 0);
      const pu = pool.pumps.length === 0 ? Infinity : pool.pumps.reduce((s, m) => s + value(m), 0);
      L.set(l, Math.min(ch, pu));
    }
    const contrib = new Map<AnyId, Map<string, number>>();
    const lambda = new Map<string, number>();
    for (const [h, pool] of g.halls) {
      const c = new Map<string, number>();
      for (const m of pool.crahs) {
        const v = value(m);
        if (v <= 0) continue;
        const key = m.loops.length === 1 ? m.loops[0]! : optimistic ? '' : null;
        if (key === null) continue;
        c.set(key, (c.get(key) ?? 0) + v);
      }
      contrib.set(h, c);
      const total = [...c.values()].reduce((s, v) => s + v, 0);
      const D = demand.get(h) ?? 0;
      if (total > 0) for (const [l, v] of c) if (l !== '') lambda.set(l, (lambda.get(l) ?? 0) + (D * v) / total);
    }
    const frac = (l: string) => {
      const lam = lambda.get(l) ?? 0;
      if (l === '' || lam <= EPS) return 1;
      return Math.min(1, (L.get(l as AnyId) ?? 0) / lam);
    };
    const hallDef = new Map<AnyId, number>();
    for (const [h, c] of contrib) {
      const D = demand.get(h) ?? 0;
      const total = [...c.values()].reduce((s, v) => s + v, 0);
      if (D <= EPS) hallDef.set(h, 0);
      else if (total <= EPS) hallDef.set(h, D);
      else {
        let water = 0;
        for (const [l, v] of c) water += ((D * v) / total) * (1 - frac(l));
        hallDef.set(h, Math.max(D - total, water, 0));
      }
    }
    const loopDef = new Map<AnyId, number>();
    for (const l of g.loops.keys()) loopDef.set(l, Math.max(0, (lambda.get(l) ?? 0) - (L.get(l) ?? 0)));
    return { hallDef, loopDef, lambda };
  };
  const pess = scenario(false);
  const opt = scenario(true);
  const bal = (p: number, o: number, d: number): PoolBalance => ({ state: o > EPS ? 'down' : p > EPS ? 'unknown' : 'up', deficitKw: p, demandKw: d });
  return {
    halls: new Map([...g.halls.keys()].map((h) => [h, bal(pess.hallDef.get(h)!, opt.hallDef.get(h)!, demand.get(h) ?? 0)])),
    loops: new Map([...g.loops.keys()].map((l) => [l, bal(pess.loopDef.get(l)!, opt.loopDef.get(l)!, pess.lambda.get(l) ?? 0)])),
  };
}

// ───────────────────────────── Propagation ─────────────────────────────

export interface Initiator {
  readonly target: AnyId;
  /** maintenance on a UPS with a bypass = output moves to bypass (unprotected), not lost. */
  readonly how: 'fails' | 'maintenance';
  readonly atMin: number;
}

export type Cause =
  | { readonly kind: 'initiating'; readonly how: Initiator['how'] }
  | { readonly kind: 'no-supply'; readonly lost: readonly AnyId[] }
  | { readonly kind: 'overload'; readonly loadKw: number; readonly ratedKw: number }
  | { readonly kind: 'battery-exhausted'; readonly runtimeMin: number }
  | { readonly kind: 'thermal'; readonly deficitKw: number }
  | { readonly kind: 'lost-redundancy'; readonly remaining: readonly AnyId[] };

export interface Transition {
  readonly tMin: number;
  readonly id: AnyId;
  readonly state: SupplyState | 'exposed';
  readonly cause: Cause;
  /** The missing facts an `unknown` state hinges on. */
  readonly contingentOn: readonly FactRef[];
}

export interface Propagation {
  readonly timeline: readonly Transition[];
  /** Final state per node that changed; absent = its normal-operation state (up, or baseline unknown). */
  readonly final: ReadonlyMap<AnyId, Transition>;
  readonly peakLoadKw: ReadonlyMap<AnyId, number>;
}

export interface PropagateOptions {
  /** SPOF analysis runs with timing off: battery and ride-through only delay, they don't save. */
  readonly timed: boolean;
}

const RANK = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

type HeapItem = { readonly t: number; readonly id: AnyId; readonly seq: number } & ({ readonly kind: 'transition'; readonly tr: Transition } | { readonly kind: 'recheck' });

class MinHeap {
  private readonly items: HeapItem[] = [];
  get size() {
    return this.items.length;
  }
  private less(a: HeapItem, b: HeapItem) {
    return a.t !== b.t ? a.t < b.t : a.id !== b.id ? a.id < b.id : a.seq < b.seq;
  }
  push(x: HeapItem) {
    const h = this.items;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): HeapItem {
    const h = this.items;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Event-driven, capacity-aware, three-valued propagation. Pure, deterministic, terminates on cycles.
 *
 * State lattice per node: up < exposed < unknown < down. A node only moves up the lattice, so each
 * node changes at most three times; loads on SURVIVING nodes only increase (a lost cord's share
 * moves onto live cords; a transferred ATS / bypassed UPS adds its load to the new path), so each
 * node is overloaded at most once per level; pool deficits re-trigger only when they strictly grow.
 * Hence the queue drains and cycles (cooling ↔ power) cannot loop. `exposed` (lost redundancy,
 * on battery, on bypass, on generator) is an annotation: it never propagates to dependents.
 */
export function propagate(g: SupplyGraph, initiators: readonly Initiator[], opts: PropagateOptions): Propagation {
  const state = new Map<AnyId, Transition>();
  const timeline: Transition[] = [];
  const load = new Map<AnyId, number>(g.normalLoadKw);
  const cordLoad = new Map(g.cordShareKw);
  const onBypass = new Set<AnyId>();
  const inputLostAt = new Map<AnyId, number>();
  const routed = new Set<AnyId>();
  const heap = new MinHeap();
  let seq = 0;

  const rankOf = (id: AnyId) => (state.has(id) ? RANK[state.get(id)!.state] : g.baseline.has(id) ? RANK.unknown : RANK.up);
  const eff = (id: AnyId): S3 => {
    const r = rankOf(id);
    return r >= RANK.down ? 'down' : r >= RANK.unknown ? 'unknown' : 'up';
  };
  const look: Look = (id) => {
    const s = eff(id);
    if (s === 'up') return UP;
    const tr = state.get(id);
    const src = tr && RANK[tr.state] >= RANK.unknown ? tr : g.baseline.get(id);
    return { state: s, contingentOn: src?.contingentOn ?? [], lost: [id] };
  };
  const schedule = (tr: Transition | null) => {
    if (tr && RANK[tr.state] > rankOf(tr.id)) heap.push({ kind: 'transition', t: tr.tMin, id: tr.id, seq: seq++, tr });
  };
  const fromEv = (id: AnyId, t: number, ev: Ev, cause?: Cause): Transition | null => {
    if (ev.state === 'up') return null;
    return {
      tMin: t,
      id,
      state: ev.state,
      cause: cause ?? { kind: 'no-supply', lost: ev.lost },
      contingentOn: ev.contingentOn,
    };
  };
  const exposed = (id: AnyId, t: number, remaining: readonly AnyId[], ev: Ev): Transition | null =>
    rankOf(id) >= RANK.exposed ? null : { tMin: t, id, state: 'exposed', cause: { kind: 'lost-redundancy', remaining }, contingentOn: ev.contingentOn };

  function evaluate(id: AnyId, t: number): Transition | null {
    const node = g.nodes.get(id);
    if (!node) return null;
    const s = node.supply;
    switch (s.rule) {
      case 'source':
      case 'pool':
        return null;
      case 'series':
        return fromEv(id, t, edgeEv(s.input, look));
      case 'cooling-member':
        return fromEv(id, t, kleeneAnd([edgeEv(s.power, look), ...(s.via ? [edgeEv(s.via, look)] : [])]));
      case 'transfer': {
        const n = edgeEv(s.normal, look);
        const alt = edgeEv(s.alternate, look);
        const o = kleeneOr([n, alt]);
        if (o.state === 'up') return n.state === 'up' ? null : exposed(id, t, s.alternate.to, n);
        return fromEv(id, t, o);
      }
      case 'ups': {
        const by = s.bypass ? edgeEv(s.bypass, look) : DOWN_EV;
        if (onBypass.has(id)) return by.state === 'up' ? null : fromEv(id, t, by);
        const input = edgeEv(s.input, look);
        if (input.state === 'up') return null;
        if (!inputLostAt.has(id)) {
          inputLostAt.set(id, t);
          if (opts.timed && s.batteryMin > 0) heap.push({ kind: 'recheck', t: t + s.batteryMin, id, seq: seq++ });
        }
        if (opts.timed && s.batteryMin > 0 && t < inputLostAt.get(id)! + s.batteryMin - EPS) return exposed(id, t, [], input);
        const o = kleeneOr([input, by]);
        if (o.state === 'up') return exposed(id, t, s.bypass?.to ?? [], input);
        return fromEv(id, t, o, opts.timed && s.batteryMin > 0 ? { kind: 'battery-exhausted', runtimeMin: s.batteryMin } : undefined);
      }
      case 'any-cord': {
        if (s.cords.length === 0) return null;
        const evs = s.cords.map(look);
        const o = kleeneOr(evs);
        if (o.state !== 'up') return fromEv(id, t, o);
        const live = s.cords.filter((_, i) => evs[i]!.state === 'up');
        const allOthersDown = evs.every((e) => e.state !== 'unknown');
        if (s.cords.length >= 2 && live.length === 1 && allOthersDown) return exposed(id, t, live, kleeneOr(evs.filter((e) => e.state === 'down')));
        return null;
      }
    }
  }

  /** Where a node's load is drawn from right now. Unknown paths keep their load AND add to the alternative (pessimistic). */
  function activeParents(id: AnyId): readonly AnyId[] {
    const s = g.nodes.get(id)?.supply;
    if (!s) return [];
    const live = (e: SupplyEdge) => e.to.filter((x) => eff(x) !== 'down');
    switch (s.rule) {
      case 'series':
        return live(s.input);
      case 'transfer': {
        const n = edgeEv(s.normal, look).state;
        return n === 'up' ? live(s.normal) : n === 'down' ? live(s.alternate) : [...live(s.normal), ...live(s.alternate)];
      }
      case 'ups': {
        if (onBypass.has(id)) return s.bypass ? live(s.bypass) : [];
        const n = edgeEv(s.input, look).state;
        if (n === 'up') return live(s.input);
        const onBy = routed.has(id) && s.bypass ? live(s.bypass) : [];
        return n === 'unknown' ? [...live(s.input), ...onBy] : onBy;
      }
      default:
        return [];
    }
  }

  function addLoad(starts: readonly AnyId[], delta: number, t: number, contingentOn: readonly FactRef[]) {
    if (delta <= EPS) return;
    const seen = new Set<AnyId>();
    const stack = [...starts];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      const total = (load.get(n) ?? 0) + delta;
      load.set(n, total);
      const cap = g.nodes.get(n)?.capacity;
      if (cap && eff(n) !== 'down' && total > cap.kw + EPS) {
        schedule({ tMin: t + BREAKER_TRIP_DELAY_MIN, id: n, state: 'down', cause: { kind: 'overload', loadKw: round2(total), ratedKw: round2(cap.kw) }, contingentOn: [...contingentOn] });
      }
      for (const p of activeParents(n)) stack.push(p);
    }
  }

  function reshare(cab: AnyId, t: number, trigger: Transition) {
    const s = g.nodes.get(cab)?.supply;
    if (!s || s.rule !== 'any-cord') return;
    const live = s.cords.filter((c) => eff(c) === 'up');
    if (live.length === 0) return;
    const cl = g.cabinetLoadKw.get(cab)!;
    const share = cl.kw / live.length;
    for (const c of live) {
      const delta = share - (cordLoad.get(c) ?? 0);
      if (delta <= EPS) continue;
      cordLoad.set(c, share);
      addLoad([c], delta, t, trigger.contingentOn);
    }
  }

  // Cooling: demand only falls (cabinets die), capacity only falls (members die), so deficits are monotone.
  const demand = new Map<AnyId, number>();
  for (const [h, pool] of g.halls) demand.set(h, pool.cabinets.reduce((s, c) => s + (g.cabinetLoadKw.get(c.id)?.kw ?? 0), 0));
  const seen = new Map<AnyId, { rank: number; deficit: number }>();
  {
    const b = coolingBalance(g, eff, demand);
    for (const [id, x] of [...b.halls, ...b.loops]) seen.set(id, { rank: RANK[x.state], deficit: x.deficitKw });
  }
  const poolContingentOn = (members: readonly AnyId[]): FactRef[] =>
    union(...members.filter((m) => eff(m) !== 'up').map((m) => (state.get(m) ?? g.baseline.get(m))?.contingentOn ?? []));
  function rebalance(t: number) {
    const b = coolingBalance(g, eff, demand);
    for (const [l, x] of b.loops) {
      const prev = seen.get(l)!;
      if (RANK[x.state] <= prev.rank && x.deficitKw <= prev.deficit + EPS) continue;
      seen.set(l, { rank: Math.max(prev.rank, RANK[x.state]), deficit: Math.max(prev.deficit, x.deficitKw) });
      const pool = g.loops.get(l)!;
      const contingentOn = poolContingentOn([...pool.chillers, ...pool.pumps].map((m) => m.id));
      if (x.state !== 'up') schedule({ tMin: t, id: l, state: x.state, cause: { kind: 'thermal', deficitKw: round2(x.deficitKw) }, contingentOn });
    }
    for (const [h, x] of b.halls) {
      const prev = seen.get(h)!;
      if (RANK[x.state] <= prev.rank && x.deficitKw <= prev.deficit + EPS) continue;
      seen.set(h, { rank: Math.max(prev.rank, RANK[x.state]), deficit: Math.max(prev.deficit, x.deficitKw) });
      if (x.state === 'up') continue;
      const pool = g.halls.get(h)!;
      const loopIds = sortIds(pool.crahs.flatMap((m) => m.loops));
      const members = [...pool.crahs.map((m) => m.id), ...loopIds.flatMap((l) => [...(g.loops.get(l)?.chillers ?? []), ...(g.loops.get(l)?.pumps ?? [])].map((m) => m.id))];
      const contingentOn = poolContingentOn(members);
      const cause: Cause = { kind: 'thermal', deficitKw: round2(x.deficitKw) };
      schedule({ tMin: t, id: h, state: x.state, cause, contingentOn });
      const ride = opts.timed && x.deficitKw > EPS ? (RIDE_THROUGH_MIN_AT_FULL_LOSS * x.demandKw) / x.deficitKw : 0;
      for (const cab of pool.cabinets) {
        if (eff(cab.id) !== 'down') schedule({ tMin: round2(t + ride), id: cab.id, state: x.state, cause, contingentOn });
      }
    }
  }

  for (const i of initiators) {
    const s = g.nodes.get(i.target)?.supply;
    if (i.how === 'maintenance' && s?.rule === 'ups' && s.bypass) {
      onBypass.add(i.target);
      schedule({ tMin: i.atMin, id: i.target, state: 'exposed', cause: { kind: 'initiating', how: 'maintenance' }, contingentOn: [] });
    } else {
      schedule({ tMin: i.atMin, id: i.target, state: 'down', cause: { kind: 'initiating', how: i.how }, contingentOn: [] });
    }
  }

  while (heap.size > 0) {
    const item = heap.pop();
    if (item.kind === 'recheck') {
      const s = g.nodes.get(item.id)?.supply;
      if (s?.rule === 'ups' && s.bypass && !routed.has(item.id) && edgeEv(s.input, look).state !== 'up' && edgeEv(s.bypass, look).state === 'up') {
        routed.add(item.id);
        const cause = state.get(item.id);
        addLoad(s.bypass.to.filter((x) => eff(x) !== 'down'), load.get(item.id) ?? 0, item.t, cause?.contingentOn ?? []);
      }
      schedule(evaluate(item.id, item.t));
      continue;
    }
    const queued = item.tr;
    if (RANK[queued.state] <= rankOf(queued.id)) continue;
    const tr: Transition =
      queued.cause.kind === 'overload' ? { ...queued, cause: { ...queued.cause, loadKw: round2(Math.max(queued.cause.loadKw, load.get(queued.id) ?? 0)) } } : queued;
    const before = eff(tr.id);
    state.set(tr.id, tr);
    timeline.push(tr);
    const after = eff(tr.id);
    const t = tr.tMin;
    const node = g.nodes.get(tr.id);
    if (!node) continue;
    const s = node.supply;

    // A UPS that just went onto bypass (maintenance, or battery exhausted with bypass alive), or an
    // ATS now drawing from its alternate, moves its whole load onto the new path.
    if (tr.state === 'exposed' && !routed.has(tr.id)) {
      if (s.rule === 'transfer') {
        routed.add(tr.id);
        addLoad(s.alternate.to.filter((x) => eff(x) !== 'down'), load.get(tr.id) ?? 0, t, tr.contingentOn);
      } else if (s.rule === 'ups' && s.bypass && (onBypass.has(tr.id) || tr.cause.kind === 'lost-redundancy' && tr.cause.remaining.length > 0)) {
        routed.add(tr.id);
        addLoad(s.bypass.to.filter((x) => eff(x) !== 'down'), load.get(tr.id) ?? 0, t, tr.contingentOn);
      }
    }
    if (s.rule === 'ups' && onBypass.has(tr.id) && tr.cause.kind === 'initiating') schedule(evaluate(tr.id, t));

    if (after !== before) {
      for (const d of g.dependents.get(tr.id) ?? []) schedule(evaluate(d, t));
      const cab = g.cabinetOfCord.get(tr.id);
      if (cab) reshare(cab, t, tr);
      const kind = kindOf(tr.id);
      if (after === 'down' && s.rule === 'any-cord') {
        const heat = g.cabinetLoadKw.get(tr.id)?.kw ?? 0;
        for (const h of s.zone.to) demand.set(h, Math.max(0, (demand.get(h) ?? 0) - heat));
      }
      if (kind === 'chiller' || kind === 'pump' || kind === 'crah' || (after === 'down' && s.rule === 'any-cord')) rebalance(t);
    }
  }

  const peakLoadKw = new Map<AnyId, number>();
  for (const [k, v] of [...load].sort(([x], [y]) => (x < y ? -1 : 1))) if (v > (g.normalLoadKw.get(k) ?? 0) + EPS) peakLoadKw.set(k, round2(v));
  return { timeline, final: state, peakLoadKw };
}
