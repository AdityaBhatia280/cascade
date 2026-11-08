// Analysis: the deep read-side module. `analyze(facility)` is the ONLY way to get audit / what-if /
// exposure / plans / scene, which guarantees that every one of them was computed over the same
// compiled supply graph. Everything is lazy + memoized inside the (immutable) Analysis value.

import type { SceneDto, Side } from '../contract.js';
import { CONTINUOUS_DERATE } from '../constants.js';
import type { ContractTerm } from '../facility/entities.js';
import { factsOf, type Facility } from '../facility/facility.js';
import type { Fact } from '../facility/fact.js';
import type { AnyId, FactRef, Id, Revision } from '../facility/ids.js';
import { kindOf, tagOf } from '../facility/ids.js';
import { applyPatch, type Patch, type PatchConflict } from '../facility/patch.js';
import { compileSupply, isPowerRole, propagate, type Initiator, type Propagation, type SupplyGraph, type Transition } from '../physics/supply.js';
import { deriveScene } from '../view/scene.js';
import { diffAudits, findingEntities, runAudit, type AuditDelta, type AuditReport, type CustomerImpact, type Finding } from './audit.js';
import { revenueBook, type RevenueBook, type Usd } from './money.js';
import { plan, type FixGoal, type FixOutcome, type FixPlan } from './planner.js';

// ───────────────────────────── Result types ─────────────────────────────

export interface Scenario {
  readonly events: readonly Initiator[];
}

/** Not stored. Same (revision, scenario) ⇒ identical result. */
export interface ScenarioResult {
  readonly scenario: Scenario;
  readonly revision: Revision;
  readonly timeline: readonly Transition[];
  readonly customers: readonly CustomerImpact[];
  readonly revenueExposed: Usd;
}

export interface CordPath {
  readonly cord: Id<'cord'>;
  readonly labelledSide: Side | null;
  /** Side derived from topology (which UPS/switchgear root it reaches), independent of the cord's label. */
  readonly derivedSide: Side | null;
  /** cord → circuit → panel → … → source(s); ATS alternates and UPS bypasses follow in order. */
  readonly chain: readonly AnyId[];
}

export interface CabinetPaths {
  readonly cabinet: Id<'cabinet'>;
  readonly cords: readonly CordPath[];
  readonly spofs: readonly SpofEntry[];
  /** Power SPOFs on ≥ 2 cords' chains: where A and B meet. Pulses in the x-ray view. */
  readonly convergence: readonly AnyId[];
  readonly redundancy: 'redundant' | 'single-path' | 'unknown';
}

export interface SpofEntry {
  readonly component: AnyId;
  readonly cause: 'topology' | 'capacity' | 'thermal';
  readonly certainty: 'definite' | 'contingent';
  readonly contingentOn: readonly FactRef[];
}

/** What removing one component did, kept for the rules that need more than "which cabinets died". */
export interface SpofRun {
  readonly component: AnyId;
  readonly final: ReadonlyMap<AnyId, Transition>;
}

export interface SpofMatrix {
  readonly byCabinet: ReadonlyMap<Id<'cabinet'>, readonly SpofEntry[]>;
  readonly byComponent: ReadonlyMap<AnyId, readonly Id<'cabinet'>[]>;
  readonly runs: ReadonlyMap<AnyId, SpofRun>;
}

export interface TermCompliance {
  readonly term: ContractTerm;
  readonly ref: FactRef;
  readonly met: boolean | null;
  readonly why: string;
}

export interface CustomerExposure {
  readonly customer: Id<'customer'>;
  readonly cabinets: readonly CabinetPaths[];
  readonly terms: readonly Fact<ContractTerm>[];
  readonly compliance: readonly TermCompliance[];
  readonly monthlyRevenue: Usd;
  /** Revenue of this customer's cabinets that are not on independent paths. */
  readonly revenueExposed: Usd;
}

export interface PatchVerification {
  readonly ok: boolean;
  readonly conflicts: readonly string[];
  readonly delta: AuditDelta | null;
  /** The post-patch analysis, so callers (planner, approval) never re-run analyze themselves. */
  readonly after: Analysis | null;
}

export interface Explanation {
  readonly target: AnyId;
  readonly facts: readonly Fact<unknown>[];
  readonly dependents: readonly AnyId[];
  readonly findings: readonly Finding[];
  readonly paths: CabinetPaths | null;
}

// ───────────────────────────── The module ─────────────────────────────

export interface Analysis {
  readonly facility: Facility;

  audit(): AuditReport;
  whatIf(scenario: Scenario): ScenarioResult;
  paths(cabinet: Id<'cabinet'>): CabinetPaths;
  exposure(customer?: Id<'customer'>): readonly CustomerExposure[];
  /** Apply → re-analyze → re-audit → delta. The ONE definition of "re-verify". */
  verify(patch: Patch, proposalId: string): PatchVerification;
  planFixes(goal: FixGoal): readonly FixPlan[];
  /** planFixes plus, for every requested finding no returned plan clears, the reason. */
  planOutcome(goal: FixGoal): FixOutcome;
  explain(target: AnyId): Explanation;
  /** View model for BOTH the 3D and 2D views. */
  scene(): SceneDto;
}

/** Compiled internals shared with the planner and scene inside core. Never exported from index.ts. */
export interface AnalysisInternals {
  readonly graph: SupplyGraph;
  readonly book: RevenueBook;
  spofs(): SpofMatrix;
}

const INTERNALS = new WeakMap<Analysis, AnalysisInternals>();

export function internalsOf(an: Analysis): AnalysisInternals {
  const i = INTERNALS.get(an);
  if (!i) throw new Error('not an Analysis produced by analyze()');
  return i;
}

function lazy<T>(make: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = make();
      done = true;
    }
    return value;
  };
}

const describeConflict = (c: PatchConflict): string =>
  c.kind === 'precondition' ? `${c.op.op}: ${c.ref} ${c.reason}` : `${c.op.op}: ${c.reason}`;

export function analyze(f: Facility): Analysis {
  const graph = compileSupply(f);
  const book = revenueBook(f);
  const spofs = lazy(() => spofMatrix(graph));
  const pathsMemo = new Map<AnyId, CabinetPaths>();
  const paths = (cabinet: Id<'cabinet'>): CabinetPaths => {
    let p = pathsMemo.get(cabinet);
    if (!p) pathsMemo.set(cabinet, (p = cabinetPaths(graph, spofs(), cabinet)));
    return p;
  };
  const audit = lazy(() => runAudit({ facility: f, graph, spofs: spofs(), paths, book }, f.revision));
  const scene = lazy(() => deriveScene(an));

  const an: Analysis = {
    facility: f,
    audit,
    whatIf(scenario) {
      const p = propagate(graph, scenario.events, { timed: true });
      const affected = new Map<Id<'cabinet'>, Transition>();
      for (const [id, tr] of p.final) if (kindOf(id) === 'cabinet' && tr.state !== 'up') affected.set(id as Id<'cabinet'>, tr);
      return {
        scenario,
        revision: f.revision,
        timeline: p.timeline,
        customers: impacts(f, book, affected),
        revenueExposed: book.exposed(affected.keys()),
      };
    },
    paths,
    exposure(customer) {
      return exposureOf(an, graph, book, customer);
    },
    verify(patch, proposalId) {
      const r = applyPatch(f, patch, proposalId);
      if (!r.ok) return { ok: false, conflicts: r.conflicts.map(describeConflict), delta: null, after: null };
      const after = analyze(r.facility);
      return { ok: true, conflicts: [], delta: diffAudits(audit(), after.audit()), after };
    },
    planFixes: (goal) => plan(an, goal).plans,
    planOutcome: (goal) => plan(an, goal),
    explain(target) {
      const e = f.get(target);
      const report = audit();
      return {
        target,
        facts: factsOf(e).map((x) => x.fact),
        dependents: f.dependents(target),
        findings: report.findings.filter((x) => findingEntities(x).includes(target)),
        paths: e.kind === 'cabinet' ? paths(e.id) : null,
      };
    },
    scene,
  };
  INTERNALS.set(an, { graph, book, spofs });
  return an;
}

/** Customers touched by a set of cabinet outcomes, worst state per customer. */
export function impacts(f: Facility, book: RevenueBook, cabinets: ReadonlyMap<Id<'cabinet'>, { readonly state: Transition['state'] }>): CustomerImpact[] {
  const order = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;
  const byCustomer = new Map<Id<'customer'>, { cabinets: Id<'cabinet'>[]; state: Transition['state'] }>();
  for (const [cab, { state }] of [...cabinets].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const owner = f.get(cab).customer;
    if (owner.kind === 'missing') continue;
    const cur = byCustomer.get(owner.value);
    if (!cur) byCustomer.set(owner.value, { cabinets: [cab], state });
    else {
      cur.cabinets.push(cab);
      if (order[state] > order[cur.state]) cur.state = state;
    }
  }
  return [...byCustomer]
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([customer, v]) => ({ customer, cabinets: v.cabinets, state: v.state, revenueExposed: book.exposed(v.cabinets) }));
}

// ───────────────────────────── SPOF matrix ─────────────────────────────

const RANK = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;

function mechanism(final: ReadonlyMap<AnyId, Transition>, id: AnyId, seen = new Set<AnyId>()): SpofEntry['cause'] {
  if (seen.has(id)) return 'topology';
  seen.add(id);
  const tr = final.get(id);
  if (!tr) return 'topology';
  switch (tr.cause.kind) {
    case 'overload':
      return 'capacity';
    case 'thermal':
      return 'thermal';
    case 'no-supply': {
      const kinds = tr.cause.lost.map((l) => mechanism(final, l, seen));
      return kinds.includes('capacity') ? 'capacity' : kinds.includes('thermal') ? 'thermal' : 'topology';
    }
    default:
      return 'topology';
  }
}

/**
 * Single points of failure by brute-force removal, using the ONE engine. For every component in
 * the union of the cabinets' upstream cones (power and cooling), fail it with timing off and record
 * every cabinet whose state got worse than its normal-operation state. This is a dominator
 * computation for the AND/OR supply graph, done by removal because capacity effects (overload
 * SPOFs) are not graph-structural and dominator trees cannot see them.
 */
export function spofMatrix(g: SupplyGraph): SpofMatrix {
  const cabinets = [...g.nodes.values()].filter((n) => n.supply.rule === 'any-cord').map((n) => n.id as Id<'cabinet'>);
  const cone = new Set<AnyId>();
  const stack: AnyId[] = [...cabinets];
  const visited = new Set<AnyId>();
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const n = g.nodes.get(id);
    if (!n) continue;
    if (n.supply.rule !== 'any-cord' && n.supply.rule !== 'pool') cone.add(id);
    for (const { edge } of n.upstream) for (const t of edge.to) stack.push(t);
  }
  const byCabinet = new Map<Id<'cabinet'>, SpofEntry[]>(cabinets.map((c) => [c, []]));
  const byComponent = new Map<AnyId, Id<'cabinet'>[]>();
  const runs = new Map<AnyId, SpofRun>();
  for (const x of [...cone].sort()) {
    const p: Propagation = propagate(g, [{ target: x, how: 'fails', atMin: 0 }], { timed: false });
    runs.set(x, { component: x, final: p.final });
    for (const c of cabinets) {
      const tr = p.final.get(c);
      if (!tr || RANK[tr.state] < RANK.unknown) continue;
      if (g.baseline.has(c) && tr.state !== 'down') continue;
      const entry: SpofEntry = {
        component: x,
        cause: mechanism(p.final, c),
        certainty: tr.state === 'unknown' || tr.contingentOn.length > 0 ? 'contingent' : 'definite',
        contingentOn: tr.contingentOn,
      };
      byCabinet.get(c)!.push(entry);
      let list = byComponent.get(x);
      if (!list) byComponent.set(x, (list = []));
      list.push(c);
    }
  }
  return { byCabinet, byComponent, runs };
}

// ───────────────────────────── Paths ─────────────────────────────

/** cord → … → sources, depth-first over power edges in role order (normal before alternate, input before bypass). */
export function powerChain(g: SupplyGraph, start: AnyId, override?: ReadonlyMap<AnyId, AnyId>): AnyId[] {
  const out: AnyId[] = [];
  const seen = new Set<AnyId>();
  const visit = (id: AnyId) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    const forced = override?.get(id);
    if (forced) return visit(forced);
    for (const { role, edge } of g.nodes.get(id)?.upstream ?? []) if (isPowerRole(role)) for (const t of edge.to) visit(t);
  };
  visit(start);
  return out;
}

export function derivedSideOf(g: SupplyGraph, chain: readonly AnyId[]): Side | null {
  for (const kind of ['ups', 'switchgear'] as const) {
    const sides = new Set(chain.filter((id) => kindOf(id) === kind && g.sideLabel.has(id)).map((id) => g.sideLabel.get(id)!));
    if (sides.size === 1) return [...sides][0]!;
    if (sides.size > 1) return null;
  }
  return null;
}

function cabinetPaths(g: SupplyGraph, m: SpofMatrix, cabinet: Id<'cabinet'>): CabinetPaths {
  const s = g.nodes.get(cabinet)?.supply;
  const cordIds = s?.rule === 'any-cord' ? s.cords : [];
  const cords: CordPath[] = cordIds.map((cord) => {
    const chain = powerChain(g, cord);
    return { cord, labelledSide: g.cordLabel.get(cord) ?? null, derivedSide: derivedSideOf(g, chain), chain };
  });
  const spofs = m.byCabinet.get(cabinet) ?? [];
  const power = spofs.filter((e) => e.cause !== 'thermal');
  const convergence = power.filter((e) => cords.filter((c) => c.chain.includes(e.component)).length >= 2).map((e) => e.component);
  const redundancy: CabinetPaths['redundancy'] =
    cords.length < 2 || power.some((e) => e.certainty === 'definite')
      ? 'single-path'
      : power.length > 0 || g.baseline.has(cabinet)
        ? 'unknown'
        : 'redundant';
  return { cabinet, cords, spofs, convergence: [...new Set(convergence)].sort(), redundancy };
}

// ───────────────────────────── Exposure ─────────────────────────────

function exposureOf(an: Analysis, g: SupplyGraph, book: RevenueBook, only?: Id<'customer'>): CustomerExposure[] {
  const f = an.facility;
  const report = an.audit();
  const mismatch = new Map<string, Finding>();
  for (const x of report.findings) if (x.rule === 'contract-topology-mismatch') mismatch.set(x.detail.termRef, x);
  const customers = only ? [only] : f.list('customer').map((c) => c.id);
  return customers.map((customer) => {
    const owns = (fact: Fact<Id<'customer'>>) => fact.kind === 'known' && fact.value === customer;
    const cabinets = f
      .list('cabinet')
      .filter((cab) => owns(cab.customer))
      .map((cab) => an.paths(cab.id));
    const terms = f.list('contract').filter((c) => owns(c.customer)).flatMap((c) => c.terms);
    const compliance = terms.flatMap((t): TermCompliance[] => (t.kind === 'known' ? [termCompliance(t.value, t.ref, mismatch.get(t.ref), g, f)] : []));
    return {
      customer,
      cabinets,
      terms,
      compliance,
      monthlyRevenue: book.customerMonthly(customer),
      revenueExposed: book.exposed(cabinets.filter((p) => p.redundancy !== 'redundant').map((p) => p.cabinet)),
    };
  });
}

function termCompliance(term: ContractTerm, ref: FactRef, finding: Finding | undefined, g: SupplyGraph, f: Facility): TermCompliance {
  if (finding && finding.rule === 'contract-topology-mismatch') {
    const n = finding.detail.cabinets.length;
    return { term, ref, met: finding.certainty === 'definite' ? false : null, why: `${n} cabinet(s) ${finding.detail.actual}${finding.certainty === 'contingent' ? ' (a record is missing)' : ''}` };
  }
  switch (term.term) {
    case 'power-redundancy':
      return { term, ref, met: true, why: term.level === 'N' || term.level === 'N+1' ? `no A/B path required by ${term.level}` : 'every listed cabinet has independent paths' };
    case 'cooling-redundancy':
      return { term, ref, met: true, why: term.level === 'N' ? 'no cooling spare required' : 'cooling survives the loss of any single unit or shared point' };
    case 'committed-kw': {
      const cords = f.cordsOf(term.cabinet);
      let worstKw = Infinity;
      for (const c of cords) {
        const n = g.nodes.get(c.id)?.supply;
        if (n?.rule !== 'series' || n.input.to.length !== 1) return { term, ref, met: null, why: `cord ${c.tag} circuit is not settled` };
        const cap = g.nodes.get(n.input.to[0]!)?.capacity;
        if (!cap) return { term, ref, met: null, why: `circuit ${tagOf(n.input.to[0]!)} rating unknown` };
        worstKw = Math.min(worstKw, cap.kw * CONTINUOUS_DERATE);
      }
      if (cords.length === 0) return { term, ref, met: false, why: 'cabinet has no cords' };
      const met = worstKw + 1e-9 >= term.kw;
      return { term, ref, met, why: `smallest cord circuit carries ${Math.round(worstKw * 100) / 100} kW continuous; ${term.kw} kW committed` };
    }
    case 'availability':
      return { term, ref, met: null, why: 'availability is a measured history, not a topology property' };
    case 'maintenance-notice':
      return { term, ref, met: null, why: 'notice is owed per maintenance window, not a topology property' };
  }
}
