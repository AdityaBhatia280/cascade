// Fix planner: deterministic search for the fewest physical moves that clear the target findings
// while respecting circuit/panel/UPS headroom INCLUDING failover load. Every returned plan has been
// re-verified through Analysis.verify (full re-audit): it clears what it claims and introduces nothing.

import { canonical, sha256Hex } from '../hash.js';
import type { Side } from '../contract.js';
import { CONTINUOUS_DERATE, MOVE_COST, PLANNER_SEARCH_NODE_LIMIT } from '../constants.js';
import { displayFact } from '../facility/kinds.js';
import type { AnyId, FactRef, Id } from '../facility/ids.js';
import { kindOf, tagOf } from '../facility/ids.js';
import { cordIdFor, describeOp, type Patch, type PatchOp } from '../facility/patch.js';
import type { SupplyEdge, SupplyGraph, SupplyRule } from '../physics/supply.js';
import { derivedSideOf, internalsOf, powerChain, type Analysis } from './analysis.js';
import type { Finding, FindingId } from './audit.js';

export interface FixGoal {
  /** Findings to clear; 'all-fixable' = every definite power finding the move set can address. */
  readonly clear: readonly FindingId[] | 'all-fixable';
  readonly maxMoves: number;
  readonly allow: readonly PatchOp['op'][];
  /** Return up to this many distinct plans (alternatives for the human). */
  readonly alternatives: number;
}

declare const PID: unique symbol;
export type PlanId = string & { readonly [PID]: true };

export interface FixPlan {
  /** Hash of (base revision, ops): the same plan computed twice has the same id. */
  readonly id: PlanId;
  readonly patch: Patch;
  readonly moves: number;
  readonly cost: number;
  readonly cleared: readonly FindingId[];
  readonly introduced: readonly FindingId[];
  readonly untouched: readonly FindingId[];
  /** Smallest remaining headroom (kW) on any touched circuit/panel/UPS if the opposite side is lost. */
  readonly minHeadroomKw: number;
  /** false when the node limit was hit and the best-found plans are returned. */
  readonly optimal: boolean;
  /** Code-generated sentences. Never LLM. */
  readonly explanation: readonly string[];
  /** Facts no document states that keep some target findings from being planned. */
  readonly missingFacts: readonly FactRef[];
}

/**
 * Why a requested finding is cleared by none of the returned plans.
 * - record-missing: it hinges on a fact no document states.
 * - not-fixable: its rule is not one a cord or feeder move addresses.
 * - no-move: no physically valid move exists given the documented spares, headroom and allowed ops.
 * - not-in-plan: moves exist, but none fits a verified plan alongside the other targets (shared spares,
 *   move budget) or the full re-audit rejected them.
 */
export interface Unplanned {
  readonly finding: FindingId;
  readonly reason: 'record-missing' | 'not-fixable' | 'no-move' | 'not-in-plan';
  /** Code-generated sentence. Never LLM. */
  readonly detail: string;
}

export interface FixOutcome {
  /** Ranked: most requested findings cleared, then fewest moves, then cost. May clear a subset of the request. */
  readonly plans: readonly FixPlan[];
  /** Every requested finding no returned plan clears, with the reason. */
  readonly unplanned: readonly Unplanned[];
}

const FIXABLE = new Set(['single-corded', 'ab-convergence', 'failover-overload']);
const EPS = 1e-6;

interface Overrides {
  readonly parent: ReadonlyMap<AnyId, AnyId>;
  readonly extra: ReadonlyMap<AnyId, readonly AnyId[]>;
}
const NO_OVERRIDES: Overrides = { parent: new Map(), extra: new Map() };

interface Candidate {
  readonly key: string;
  readonly ops: readonly PatchOp[];
  readonly cost: number;
  readonly covers: ReadonlySet<string>;
  /** Δ normal load and Δ failover load per node. */
  readonly deltas: ReadonlyMap<AnyId, { readonly n: number; readonly f: number }>;
  /** Physical resources the moves consume (spare circuits/breakers, moved cords, re-fed panels). */
  readonly uses: ReadonlySet<string>;
  /** Moves that leave a cord or panel fed from the side opposite its documented label (ranked after equal plans). */
  readonly labelPenalty: number;
  readonly why: string;
}

/** Nodes every supply path of `id` must pass (dominators over the power AND/OR graph), under overrides. */
function mustPassOf(g: SupplyGraph, ov: Overrides) {
  const memo = new Map<AnyId, ReadonlySet<AnyId>>();
  const onStack = new Set<AnyId>();
  const viaEdge = (e: SupplyEdge): Set<AnyId> => {
    const out = new Set<AnyId>();
    for (const t of e.to) for (const x of mp(t)) out.add(x);
    return out;
  };
  const inter = (x: ReadonlySet<AnyId>, y: ReadonlySet<AnyId>) => new Set([...x].filter((v) => y.has(v)));
  function mp(id: AnyId): ReadonlySet<AnyId> {
    const hit = memo.get(id);
    if (hit) return hit;
    if (onStack.has(id)) return new Set();
    onStack.add(id);
    const out = new Set<AnyId>([id]);
    const forced = ov.parent.get(id);
    const s = g.nodes.get(id)?.supply;
    if (forced) for (const x of mp(forced)) out.add(x);
    else if (s?.rule === 'series') for (const x of viaEdge(s.input)) out.add(x);
    else if (s?.rule === 'transfer') for (const x of inter(viaEdge(s.normal), viaEdge(s.alternate))) out.add(x);
    else if (s?.rule === 'ups') for (const x of s.bypass ? inter(viaEdge(s.input), viaEdge(s.bypass)) : viaEdge(s.input)) out.add(x);
    onStack.delete(id);
    memo.set(id, out);
    return out;
  }
  return mp;
}

/** Power nodes common to every cord path of a cabinet under overrides; empty = structurally redundant. */
function cabinetSpofs(g: SupplyGraph, cab: AnyId, ov: Overrides): ReadonlySet<AnyId> {
  const mp = mustPassOf(g, ov);
  const s = g.nodes.get(cab)?.supply as Extract<SupplyRule, { rule: 'any-cord' }>;
  const sets = [...s.cords.map((c) => mp(c)), ...(ov.extra.get(cab) ?? []).map((c) => mp(c))];
  if (sets.length < 2) return new Set(sets[0] ?? [cab]);
  return sets.reduce((x, y) => new Set([...x].filter((v) => y.has(v))));
}

function normalChain(g: SupplyGraph, start: AnyId, ov: Overrides): Set<AnyId> {
  const seen = new Set<AnyId>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const forced = ov.parent.get(id);
    if (forced) {
      stack.push(forced);
      continue;
    }
    const s = g.nodes.get(id)?.supply;
    if (s?.rule === 'series') stack.push(...s.input.to);
    else if (s?.rule === 'transfer') stack.push(...s.normal.to);
    else if (s?.rule === 'ups') stack.push(...s.input.to);
  }
  return seen;
}

const knownSingle = (e: SupplyEdge) => e.to[0] ?? null;

export function plan(an: Analysis, goal: FixGoal): FixOutcome {
  const { graph: g } = internalsOf(an);
  const f = an.facility;
  const report = an.audit();
  const byId = new Map(report.findings.map((x) => [x.id, x]));
  const requested: Finding[] =
    goal.clear === 'all-fixable' ? report.findings.filter((x) => FIXABLE.has(x.rule)) : goal.clear.map((id) => byId.get(id)).filter((x): x is Finding => !!x);
  const missingFacts = [...new Set(requested.filter((x) => x.certainty === 'contingent').flatMap((x) => x.contingentOn))].sort();
  const targets = requested.filter((x) => x.certainty === 'definite' && FIXABLE.has(x.rule));
  const allow = new Set(goal.allow);

  // Atoms: the unit a move covers. A convergence finding is cleared only when each of its cabinets is.
  const atomsOf = new Map<FindingId, string[]>();
  const atomCabinet = new Map<string, AnyId>();
  for (const t of targets) {
    if (t.rule === 'ab-convergence') {
      const atoms = t.detail.cabinets.map((c) => `${t.id}|${c}`);
      atomsOf.set(t.id, atoms);
      t.detail.cabinets.forEach((c, i) => atomCabinet.set(atoms[i]!, c));
    } else {
      atomsOf.set(t.id, [t.id]);
      if (t.rule === 'single-corded') atomCabinet.set(t.id, t.detail.cabinet);
    }
  }
  const allAtoms = [...atomsOf.values()].flat();

  const capOf = (id: AnyId) => g.nodes.get(id)?.capacity ?? null;
  const usable = (id: AnyId) => !g.baseline.has(id) && capOf(id) !== null;
  const spareCircuits = f
    .list('circuit')
    .map((c) => c.id)
    .filter((c) => usable(c) && !f.dependents(c).some((d) => kindOf(d) === 'cord') && knownSingle((g.nodes.get(c)!.supply as Extract<SupplyRule, { rule: 'series' }>).input));
  const spareBreakers = f
    .list('breaker')
    .map((b) => b.id)
    .filter((b) => usable(b) && f.dependents(b).length === 0 && knownSingle((g.nodes.get(b)!.supply as Extract<SupplyRule, { rule: 'series' }>).input));
  const cabLoad = (cab: AnyId) => g.cabinetLoadKw.get(cab)?.kw ?? 0;
  const cordsOf = (cab: AnyId) => (g.nodes.get(cab)?.supply as Extract<SupplyRule, { rule: 'any-cord' }>).cords;
  const circuitOf = (cord: AnyId) => knownSingle((g.nodes.get(cord)!.supply as Extract<SupplyRule, { rule: 'series' }>).input);

  const addDelta = (m: Map<AnyId, { n: number; f: number }>, nodes: Iterable<AnyId>, n: number, fl: number, skip: ReadonlySet<AnyId> = new Set()) => {
    for (const id of nodes) {
      if (skip.has(id)) continue;
      const cur = m.get(id) ?? { n: 0, f: 0 };
      m.set(id, { n: cur.n + n, f: cur.f + fl });
    }
  };
  const otherCordNodes = (cab: AnyId, except: AnyId | null) => {
    const s = new Set<AnyId>();
    for (const c of cordsOf(cab)) if (c !== except) for (const x of normalChain(g, c, NO_OVERRIDES)) s.add(x);
    return s;
  };
  const rehomeDeltas = (cord: AnyId, to: AnyId) => {
    const cab = g.cabinetOfCord.get(cord)!;
    const L = cabLoad(cab);
    const share = L / cordsOf(cab).length;
    const before = normalChain(g, cord, NO_OVERRIDES);
    const after = normalChain(g, cord, { parent: new Map([[cord, to]]), extra: new Map() });
    const others = otherCordNodes(cab, cord);
    const m = new Map<AnyId, { n: number; f: number }>();
    for (const x of after) if (!before.has(x)) addDelta(m, [x], share, others.has(x) ? 0 : L);
    for (const x of before) if (!after.has(x)) addDelta(m, [x], -share, others.has(x) ? 0 : -L);
    return m;
  };
  const addCordDeltas = (cab: AnyId, circuit: AnyId) => {
    const L = cabLoad(cab);
    const n = cordsOf(cab).length;
    const m = new Map<AnyId, { n: number; f: number }>();
    for (const c of cordsOf(cab)) addDelta(m, normalChain(g, c, NO_OVERRIDES), -(L / n - L / (n + 1)), 0);
    addDelta(m, normalChain(g, circuit, NO_OVERRIDES), L / (n + 1), 0);
    const others = otherCordNodes(cab, null);
    for (const x of normalChain(g, circuit, NO_OVERRIDES)) if (!others.has(x)) addDelta(m, [x], 0, L);
    return m;
  };
  const refeedDeltas = (device: AnyId, from: AnyId, to: AnyId) => {
    const q = g.normalLoadKw.get(device) ?? 0;
    const fq = g.failoverLoadKw.get(device) ?? 0;
    const before = normalChain(g, from, NO_OVERRIDES);
    const after = normalChain(g, to, NO_OVERRIDES);
    const m = new Map<AnyId, { n: number; f: number }>();
    for (const x of after) if (!before.has(x)) addDelta(m, [x], q, fq);
    for (const x of before) if (!after.has(x)) addDelta(m, [x], -q, -fq);
    return m;
  };
  const feasible = (base: ReadonlyMap<AnyId, { n: number; f: number }>, add: ReadonlyMap<AnyId, { n: number; f: number }>) => {
    for (const [id, d] of add) {
      const cur = base.get(id) ?? { n: 0, f: 0 };
      const n = cur.n + d.n;
      const fl = cur.f + d.f;
      if (n <= EPS && fl <= EPS) continue;
      const cap = capOf(id);
      if (!cap) continue;
      if ((g.normalLoadKw.get(id) ?? 0) + n > cap.kw * CONTINUOUS_DERATE + EPS && n > EPS) return false;
      if ((g.failoverLoadKw.get(id) ?? 0) + fl > cap.kw + EPS && fl > EPS) return false;
    }
    return true;
  };
  const merge = (x: ReadonlyMap<AnyId, { n: number; f: number }>, y: ReadonlyMap<AnyId, { n: number; f: number }>) => {
    const m = new Map(x);
    for (const [id, d] of y) {
      const cur = m.get(id) ?? { n: 0, f: 0 };
      m.set(id, { n: cur.n + d.n, f: cur.f + d.f });
    }
    return m;
  };
  const coveredUnder = (ov: Overrides) => new Set(allAtoms.filter((atom) => atomCabinet.has(atom) && cabinetSpofs(g, atomCabinet.get(atom)!, ov).size === 0));

  // 1. Candidate moves per target.
  const candidates = new Map<string, Candidate>();
  const offer = (c: Candidate) => {
    if (c.covers.size === 0 || !c.ops.every((o) => allow.has(o.op)) || !feasible(new Map(), c.deltas)) return;
    if (!candidates.has(c.key)) candidates.set(c.key, c);
  };
  const rehome = (cord: AnyId, to: AnyId, why: string, covers?: Set<string>): void => {
    const from = circuitOf(cord);
    if (!from || from === to) return;
    const ov: Overrides = { parent: new Map([[cord, to]]), extra: new Map() };
    const op: PatchOp = { op: 'rehome-cord', cord: cord as Id<'cord'>, from: from as Id<'circuit'>, to: to as Id<'circuit'> };
    const label = g.cordLabel.get(cord);
    const labelPenalty = label && derivedSideOf(g, powerChain(g, to)) !== label ? 1 : 0;
    offer({ key: canonical([op]), ops: [op], cost: MOVE_COST['rehome-cord'], covers: covers ?? coveredUnder(ov), deltas: rehomeDeltas(cord, to), uses: new Set([cord, to]), labelPenalty, why });
  };

  for (const t of targets) {
    if (t.rule === 'single-corded') {
      const cab = t.detail.cabinet;
      const cords = cordsOf(cab);
      if (cords.length === 1) {
        const dual = f.get(cab).dualPsu;
        if (dual.kind !== 'known' || dual.value !== true) continue;
        const k = cords[0]!;
        const have: Side | null = g.cordLabel.get(k) ?? derivedSideOf(g, powerChain(g, k));
        const side: Side = have === 'B' ? 'A' : 'B';
        if (f.parseId(cordIdFor(cab, side))) continue;
        for (const c of spareCircuits) {
          const ov: Overrides = { parent: new Map(), extra: new Map([[cab, [c]]]) };
          if (cabinetSpofs(g, cab, ov).size > 0) continue;
          const op: PatchOp = { op: 'add-cord', cabinet: cab, side, circuit: c as Id<'circuit'> };
          const labelPenalty = derivedSideOf(g, powerChain(g, c)) !== side ? 1 : 0;
          offer({ key: canonical([op]), ops: [op], cost: MOVE_COST['add-cord'], covers: new Set([t.id]), deltas: addCordDeltas(cab, c), uses: new Set([c, cab]), labelPenalty, why: t.id });
        }
      } else {
        for (const k of cords.slice(1)) for (const c of spareCircuits) {
          if (cabinetSpofs(g, cab, { parent: new Map([[k, c]]), extra: new Map() }).size === 0) rehome(k, c, t.id, new Set([t.id]));
        }
      }
    } else if (t.rule === 'ab-convergence') {
      const point = t.detail.convergesAt;
      for (const cab of t.detail.cabinets) {
        for (const k of cordsOf(cab)) {
          const chain = powerChain(g, k);
          if (!chain.includes(point)) continue;
          for (const c of spareCircuits) rehome(k, c, t.id);
          for (const panel of chain) {
            const kind = kindOf(panel);
            if ((kind !== 'pdu' && kind !== 'rpp') || panel === point) continue;
            const from = knownSingle((g.nodes.get(panel)!.supply as Extract<SupplyRule, { rule: 'series' }>).input);
            if (!from || !mustPassOf(g, NO_OVERRIDES)(panel).has(point)) continue;
            const busKind = (x: AnyId) => (kindOf(x) === 'breaker' ? knownSingle((g.nodes.get(x)!.supply as Extract<SupplyRule, { rule: 'series' }>).input) : null);
            const fromBus = busKind(from);
            for (const b of spareBreakers) {
              if (b === from || normalChain(g, b, NO_OVERRIDES).has(panel)) continue;
              // Same distribution level as today's feeder (a PDU sub-feed for an RPP, never a 480 V switchgear breaker).
              const toBus = busKind(b);
              if (fromBus ? !toBus || kindOf(toBus) !== kindOf(fromBus) : !toBus || kindOf(toBus) !== 'ups') continue;
              const label = g.sideLabel.get(panel);
              const labelPenalty = label && derivedSideOf(g, powerChain(g, b)) !== label ? 1 : 0;
              const ov: Overrides = { parent: new Map([[panel, b]]), extra: new Map() };
              const op: PatchOp = { op: 'refeed', device: panel as Id<'pdu' | 'rpp'>, from: from as Id<'ups' | 'breaker'>, to: b as Id<'ups' | 'breaker'> };
              offer({ key: canonical([op]), ops: [op], cost: MOVE_COST.refeed, covers: coveredUnder(ov), deltas: refeedDeltas(panel, from, b), uses: new Set([panel, b]), labelPenalty, why: t.id });
            }
          }
        }
      }
    } else if (t.rule === 'failover-overload') {
      const { overloaded, lost, loadKw, ratedKw } = t.detail;
      let need = loadKw - ratedKw + EPS;
      const movable = t.affected
        .flatMap((i) => i.cabinets)
        .flatMap((cab) => cordsOf(cab).filter((k) => normalChain(g, k, NO_OVERRIDES).has(overloaded)))
        .sort((x, y) => cabLoad(g.cabinetOfCord.get(y)!) - cabLoad(g.cabinetOfCord.get(x)!) || (x < y ? -1 : 1));
      const ops: PatchOp[] = [];
      let deltas = new Map<AnyId, { n: number; f: number }>();
      const used = new Set<string>();
      for (const k of movable) {
        if (need <= 0) break;
        const from = circuitOf(k);
        if (!from) continue;
        const cab = g.cabinetOfCord.get(k)!;
        const pick = spareCircuits.find((c) => {
          if (used.has(c)) return false;
          const chain = normalChain(g, c, NO_OVERRIDES);
          if (chain.has(overloaded) || chain.has(lost)) return false;
          if (cabinetSpofs(g, cab, { parent: new Map([[k, c]]), extra: new Map() }).size > 0) return false;
          return feasible(deltas, rehomeDeltas(k, c));
        });
        if (!pick) continue;
        ops.push({ op: 'rehome-cord', cord: k as Id<'cord'>, from: from as Id<'circuit'>, to: pick as Id<'circuit'> });
        deltas = merge(deltas, rehomeDeltas(k, pick));
        used.add(pick).add(k);
        need -= cabLoad(cab);
      }
      if (need <= 0 && ops.length > 0) {
        offer({ key: canonical(ops), ops, cost: ops.length * MOVE_COST['rehome-cord'], covers: new Set([t.id]), deltas, uses: used, labelPenalty: 0, why: t.id });
      }
    }
  }

  // 2. Exact bounded search. A target whose moves cannot fit (spares shared with other targets, move
  // budget) is dropped instead of failing the whole request: fewest dropped targets, then fewest moves,
  // then lowest cost. Keeps a finalist pool larger than `alternatives` because the full re-audit in
  // step 3 can reject finalists the local check accepted.
  const byAtom = new Map<string, Candidate[]>();
  for (const atom of allAtoms) byAtom.set(atom, []);
  for (const c of [...candidates.values()].sort((x, y) => (x.key < y.key ? -1 : 1))) for (const atom of c.covers) byAtom.get(atom)?.push(c);
  for (const list of byAtom.values()) list.sort((x, y) => x.ops.length - y.ops.length || x.cost - y.cost || x.labelPenalty - y.labelPenalty || y.covers.size - x.covers.size || (x.key < y.key ? -1 : 1));
  const plannable = allAtoms.filter((atom) => (byAtom.get(atom) ?? []).length > 0);
  const order = [...plannable].sort((x, y) => byAtom.get(x)!.length - byAtom.get(y)!.length || (x < y ? -1 : 1));
  const plannableTargets = new Set([...atomsOf].filter(([, atoms]) => atoms.every((x) => plannable.includes(x))).map(([id]) => id));
  const want = new Set(order.filter((atom) => plannableTargets.has(atomTarget(atom))));
  function atomTarget(atom: string): FindingId {
    return (atom.includes('|') ? atom.slice(0, atom.indexOf('|')) : atom) as FindingId;
  }
  const returned = Math.max(1, goal.alternatives);
  const keep = Math.max(returned * 4, 8);
  const solutions: { chosen: Candidate[]; dropped: number; moves: number; cost: number; penalty: number; key: string }[] = [];
  const worse = (d: number, m: number, c: number, s: { dropped: number; moves: number; cost: number }) =>
    d > s.dropped || (d === s.dropped && (m > s.moves || (m === s.moves && c > s.cost + EPS)));
  const penaltyOf = (cs: readonly Candidate[]) => cs.reduce((n, c) => n + c.labelPenalty, 0);
  let nodes = 0;
  let hitLimit = false;

  function dfs(chosen: Candidate[], covered: Set<string>, dropped: ReadonlySet<FindingId>, deltas: Map<AnyId, { n: number; f: number }>, uses: Set<string>, moves: number, cost: number) {
    if (++nodes > PLANNER_SEARCH_NODE_LIMIT) {
      hitLimit = true;
      return;
    }
    const next = order.find((atom) => want.has(atom) && !covered.has(atom) && !dropped.has(atomTarget(atom)));
    if (!next) {
      const key = canonical(chosen.map((c) => c.key).sort());
      if (chosen.length === 0 || solutions.some((s) => s.key === key)) return;
      // A move that only served a dropped target is a wasted move.
      if (chosen.some((c) => [...c.covers].every((atom) => dropped.has(atomTarget(atom))))) return;
      solutions.push({ chosen: [...chosen], dropped: dropped.size, moves, cost, penalty: penaltyOf(chosen), key });
      solutions.sort((x, y) => x.dropped - y.dropped || x.moves - y.moves || x.cost - y.cost || x.penalty - y.penalty || (x.key < y.key ? -1 : 1));
      if (solutions.length > keep) solutions.pop();
      return;
    }
    if (solutions.length >= keep && worse(dropped.size, moves, cost, solutions[solutions.length - 1]!)) return;
    for (const c of byAtom.get(next)!) {
      if (moves + c.ops.length > goal.maxMoves) continue;
      if ([...c.uses].some((u) => uses.has(u))) continue;
      if (!feasible(deltas, c.deltas)) continue;
      dfs([...chosen, c], new Set([...covered, ...c.covers]), dropped, merge(deltas, c.deltas), new Set([...uses, ...c.uses]), moves + c.ops.length, cost + c.cost);
      if (hitLimit) return;
    }
    dfs(chosen, covered, new Set([...dropped, atomTarget(next)]), deltas, uses, moves, cost);
  }
  if (want.size > 0) dfs([], new Set(), new Set(), new Map(), new Set(), 0, 0);

  // 3. Verify every plan by a full re-audit; cleared / untouched come from the re-audit, not the search.
  const customerName = (id: AnyId) => {
    if (kindOf(id) !== 'customer') return tagOf(id);
    return displayFact(f.get(id as Id<'customer'>).name) ?? tagOf(id);
  };
  const plans: FixPlan[] = [];
  const rankById = new Map<string, { readonly targets: number; readonly penalty: number }>();
  for (const s of solutions) {
    const ops = s.chosen.flatMap((c) => c.ops);
    const id = `plan-${sha256Hex(canonical([f.revision, ops])).slice(0, 12)}` as PlanId;
    const v = an.verify({ base: f.revision, ops }, id);
    if (!v.ok || !v.delta || !v.after) continue;
    const coveredTargets = [...plannableTargets].filter((t) => atomsOf.get(t)!.every((atom) => s.chosen.some((c) => c.covers.has(atom))));
    if (v.delta.introduced.length > 0 || coveredTargets.some((t) => !v.delta!.cleared.includes(t))) continue;
    const ag = internalsOf(v.after).graph;
    const touched = new Set(s.chosen.flatMap((c) => [...c.deltas.keys()]));
    let minHeadroomKw = Infinity;
    for (const n of touched) {
      const cap = ag.nodes.get(n)?.capacity;
      if (cap) minHeadroomKw = Math.min(minHeadroomKw, cap.kw - (ag.failoverLoadKw.get(n) ?? 0));
    }
    const explanation = s.chosen.map((c) => {
      const cleared = [...c.covers].map(atomTarget).filter((t, i, xs) => xs.indexOf(t) === i);
      const customers = [...new Set(cleared.flatMap((t) => byId.get(t)?.affected.map((i) => customerName(i.customer)) ?? []))].sort();
      return `${c.ops.map(describeOp).join('; ')}: addresses ${cleared.join(', ')}${customers.length ? ` (${customers.join(', ')})` : ''}`;
    });
    explanation.push(`Re-audit after all moves: clears ${v.delta.cleared.length} finding${v.delta.cleared.length === 1 ? '' : 's'} (${v.delta.cleared.join(', ')}), introduces none.`);
    rankById.set(id, { targets: coveredTargets.length, penalty: s.penalty });
    plans.push({
      id,
      patch: { base: f.revision, ops },
      moves: ops.length,
      cost: s.cost,
      cleared: v.delta.cleared,
      introduced: v.delta.introduced,
      untouched: v.delta.persisted,
      minHeadroomKw: Number.isFinite(minHeadroomKw) ? Math.round(minHeadroomKw * 100) / 100 : 0,
      optimal: !hitLimit,
      explanation,
      missingFacts,
    });
  }

  // 4. Rank: most requested findings cleared, then fewest moves, then cost, then label consistency,
  // then most headroom, then the ops themselves (not the id: it hashes the revision, so an unrelated
  // new document would reorder tied plans).
  const rankOf = (p: FixPlan) => rankById.get(p.id)!;
  const opsKey = (p: FixPlan) => canonical(p.patch.ops);
  const ranked = plans
    .sort((x, y) => rankOf(y).targets - rankOf(x).targets || x.moves - y.moves || x.cost - y.cost || rankOf(x).penalty - rankOf(y).penalty || y.minHeadroomKw - x.minHeadroomKw || (opsKey(x) < opsKey(y) ? -1 : 1))
    .slice(0, returned);

  // 5. Say why each requested finding no returned plan clears.
  const allowNote = (['rehome-cord', 'add-cord', 'refeed'] as const).every((o) => allow.has(o)) ? '' : ` with the allowed moves (${goal.allow.join(', ')})`;
  const noMove = (t: Finding): string => {
    if (t.rule === 'single-corded') {
      const cab = t.detail.cabinet;
      const dual = f.get(cab).dualPsu;
      if (cordsOf(cab).length === 1 && (dual.kind !== 'known' || dual.value !== true)) return `${tagOf(cab)} is not documented as dual-PSU, so a second cord has nothing to plug into.`;
      return `No documented spare circuit gives ${tagOf(cab)} a second independent path within headroom${allowNote}.`;
    }
    if (t.rule === 'ab-convergence') {
      const stuck = atomsOf.get(t.id)!.filter((atom) => !plannable.includes(atom)).map((atom) => tagOf(atomCabinet.get(atom)!));
      return `No documented spare circuit or spare panel feeder gives ${stuck.join(', ')} a path that avoids ${tagOf(t.detail.convergesAt)} within headroom${allowNote}.`;
    }
    if (t.rule === 'failover-overload') return `No documented spare circuits that avoid both ${tagOf(t.detail.overloaded)} and ${tagOf(t.detail.lost)} can take enough load off ${tagOf(t.detail.overloaded)}${allowNote}.`;
    return `No move addresses ${t.id}.`;
  };
  const clearedByAny = new Set(ranked.flatMap((p) => p.cleared));
  const unplanned: Unplanned[] = requested
    .filter((x) => !clearedByAny.has(x.id))
    .map((x): Unplanned => {
      if (x.certainty === 'contingent') return { finding: x.id, reason: 'record-missing', detail: `No document states ${x.contingentOn.join(', ')}.` };
      if (!FIXABLE.has(x.rule)) return { finding: x.id, reason: 'not-fixable', detail: `${x.rule} is not something a cord or feeder move fixes.` };
      if (!plannableTargets.has(x.id)) return { finding: x.id, reason: 'no-move', detail: noMove(x) };
      const others = targets.length > 1 ? ' alongside the other targets' : '';
      return { finding: x.id, reason: 'not-in-plan', detail: `Candidate moves exist, but none fits a verified plan of at most ${goal.maxMoves} moves${others}; the spares they need are spent elsewhere or the re-audit rejected them.` };
    });
  return { plans: ranked, unplanned };
}

/**
 * A plan made of moves a human chose by hand, verified by the same full re-audit as planner output.
 * null when the moves do not apply to this model. Headroom is checked on the circuits, panels and
 * feeders the moves land on.
 */
export function planOfOps(an: Analysis, ops: readonly PatchOp[]): FixPlan | null {
  const f = an.facility;
  const id = `plan-${sha256Hex(canonical([f.revision, ops])).slice(0, 12)}` as PlanId;
  const v = an.verify({ base: f.revision, ops }, id);
  if (!v.ok || !v.delta || !v.after) return null;
  const ag = internalsOf(v.after).graph;
  const landed = ops.flatMap((op): AnyId[] => (op.op === 'refeed' ? [op.device, op.to] : op.op === 'rehome-cord' ? [op.to] : [op.circuit]));
  let minHeadroomKw = Infinity;
  for (const n of landed) {
    const cap = ag.nodes.get(n)?.capacity;
    if (cap) minHeadroomKw = Math.min(minHeadroomKw, cap.kw - (ag.failoverLoadKw.get(n) ?? 0));
  }
  return {
    id,
    patch: { base: f.revision, ops },
    moves: ops.length,
    cost: ops.reduce((s, op) => s + MOVE_COST[op.op], 0),
    cleared: v.delta.cleared,
    introduced: v.delta.introduced,
    untouched: v.delta.persisted,
    minHeadroomKw: Number.isFinite(minHeadroomKw) ? Math.round(minHeadroomKw * 100) / 100 : 0,
    // Chosen by hand, not searched: nothing says a smaller plan does not exist.
    optimal: false,
    explanation: ops.map(describeOp),
    missingFacts: [],
  };
}
