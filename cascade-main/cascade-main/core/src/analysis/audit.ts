// Redundancy audit: a typed rule registry over the compiled supply graph and the SPOF matrix.
// Rules never re-derive topology: they consume the single physics engine's outputs.

import { RULE_IDS, type Certainty, type RuleId, type Severity } from '../contract.js';
import { CONTINUOUS_DERATE } from '../constants.js';
import type { ContractTerm, RedundancyIntent } from '../facility/entities.js';
import type { Facility } from '../facility/facility.js';
import type { AnyId, FactRef, Id, Revision } from '../facility/ids.js';
import { kindOf, tagOf } from '../facility/ids.js';
import { renderIntent, renderTerm } from '../facility/kinds.js';
import type { SupplyGraph, SupplyRule, Transition } from '../physics/supply.js';
import type { CabinetPaths, SpofMatrix } from './analysis.js';
import { impacts } from './analysis.js';
import type { RevenueBook, Usd } from './money.js';

declare const FID: unique symbol;
/** Stable across revisions: `${rule}:${subject}[:${discriminator}]`, so plan deltas compare by id. */
export type FindingId = string & { readonly [FID]: true };

export type FindingDetail =
  | { readonly rule: 'single-corded'; readonly cabinet: Id<'cabinet'>; readonly circuit: Id<'circuit'> | null }
  | { readonly rule: 'ab-convergence'; readonly cabinets: readonly Id<'cabinet'>[]; readonly convergesAt: AnyId; readonly cords: readonly Id<'cord'>[] }
  | { readonly rule: 'failover-overload'; readonly lost: AnyId; readonly overloaded: AnyId; readonly loadKw: number; readonly ratedKw: number }
  | { readonly rule: 'circuit-overcommit'; readonly circuit: Id<'circuit'>; readonly loadKw: number; readonly ratedKw: number }
  | {
      readonly rule: 'cooling-capacity';
      readonly pool: Id<'loop' | 'hall'>;
      readonly intent: RedundancyIntent | null;
      readonly sparesActual: number;
      readonly demandKw: number;
      readonly capacityKw: number;
    }
  | { readonly rule: 'cooling-common-cause'; readonly pool: Id<'loop' | 'hall'>; readonly members: readonly AnyId[]; readonly sharedPoint: AnyId }
  | {
      readonly rule: 'contract-topology-mismatch';
      readonly contract: Id<'contract'>;
      readonly term: ContractTerm;
      readonly termRef: FactRef;
      readonly cabinets: readonly Id<'cabinet'>[];
      readonly actual: 'single-path' | 'converged' | 'single-ups-path' | 'no-cooling-spare';
    };

export interface CustomerImpact {
  readonly customer: Id<'customer'>;
  readonly cabinets: readonly Id<'cabinet'>[];
  readonly state: 'up' | 'unknown' | 'down' | 'exposed';
  readonly revenueExposed: Usd;
}

type FindingOf<R extends RuleId> = {
  readonly id: FindingId;
  readonly rule: R;
  readonly severity: Severity;
  readonly certainty: Certainty;
  readonly subject: AnyId;
  readonly detail: Extract<FindingDetail, { readonly rule: R }>;
  readonly affected: readonly CustomerImpact[];
  readonly revenueExposed: Usd;
  /** Facts no document states that the finding hinges on. Non-empty ⇒ certainty 'contingent'. */
  readonly contingentOn: readonly FactRef[];
};
export type Finding = { readonly [R in RuleId]: FindingOf<R> }[RuleId];

export interface AuditReport {
  readonly revision: Revision;
  readonly findings: readonly Finding[];
}

/** Everything a rule may read. Built once per Analysis. */
export interface RuleInput {
  readonly facility: Facility;
  readonly graph: SupplyGraph;
  readonly spofs: SpofMatrix;
  readonly paths: (cabinet: Id<'cabinet'>) => CabinetPaths;
  readonly book: RevenueBook;
}

interface Rule<R extends RuleId> {
  /** `prior` = findings of rules earlier in RULE_IDS order. */
  detect(input: RuleInput, prior: readonly Finding[]): readonly FindingOf<R>[];
  title(detail: Extract<FindingDetail, { readonly rule: R }>, f: Facility): string;
}

// ───────────────────────────── Shared helpers ─────────────────────────────

const LEVELS: readonly Severity[] = ['low', 'medium', 'high', 'critical'];
const sorted = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();
const union = (...lists: readonly (readonly FactRef[])[]): FactRef[] => sorted(lists.flat());
const round2 = (n: number) => Math.round(n * 100) / 100;
const RANK = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;

/**
 * Severity = rule base, lowered one step when no contract revenue is exposed, raised one step when
 * two or more customers are affected; a contingent finding is capped at 'high'.
 */
function severityOf(base: Severity, revenue: number, customers: number, certainty: Certainty): Severity {
  let i = LEVELS.indexOf(base);
  if (revenue <= 0) i -= 1;
  else if (customers >= 2) i += 1;
  i = Math.max(0, Math.min(3, i));
  if (certainty === 'contingent') i = Math.min(i, 2);
  return LEVELS[i]!;
}

interface Draft<R extends RuleId> {
  readonly rule: R;
  readonly key: string;
  readonly subject: AnyId;
  readonly detail: Extract<FindingDetail, { readonly rule: R }>;
  readonly cabinets: readonly Id<'cabinet'>[];
  readonly base: Severity;
  readonly contingentOn: readonly FactRef[];
}

function finish<R extends RuleId>(input: RuleInput, d: Draft<R>): FindingOf<R> {
  const certainty: Certainty = d.contingentOn.length > 0 ? 'contingent' : 'definite';
  const state = certainty === 'definite' ? 'exposed' : 'unknown';
  const affected = impacts(input.facility, input.book, new Map(sorted(d.cabinets).map((c) => [c, { state }])));
  const revenueExposed = input.book.exposed(d.cabinets);
  return {
    id: `${d.rule}:${d.key}` as FindingId,
    rule: d.rule,
    severity: severityOf(d.base, revenueExposed, affected.length, certainty),
    certainty,
    subject: d.subject,
    detail: d.detail,
    affected,
    revenueExposed,
    contingentOn: union(d.contingentOn),
  };
}

const cabinetRule = (g: SupplyGraph, id: AnyId) => g.nodes.get(id)?.supply as Extract<SupplyRule, { rule: 'any-cord' }>;
const cordCircuit = (g: SupplyGraph, cord: AnyId) => (g.nodes.get(cord)?.supply as Extract<SupplyRule, { rule: 'series' }>).input;
const memberCap = (g: SupplyGraph, id: AnyId) => g.nodes.get(id)?.supply as Extract<SupplyRule, { rule: 'cooling-member' }>;

/** Every entity id a finding mentions (subject, affected cabinets, detail ids). */
export function findingEntities(x: Finding): AnyId[] {
  const ids = new Set<AnyId>([x.subject]);
  for (const imp of x.affected) for (const c of imp.cabinets) ids.add(c);
  const visit = (v: unknown) => {
    if (typeof v === 'string' && /^[a-z]+:/.test(v) && !v.includes('#')) ids.add(v as AnyId);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(x.detail);
  return [...ids].sort();
}

/** Static cooling redundancy per pool: how many of the largest members can be lost with capacity ≥ demand. */
interface PoolSpares {
  readonly pool: Id<'loop' | 'hall'>;
  readonly spares: number;
  readonly required: number | null;
  readonly intent: RedundancyIntent | null;
  readonly demandKw: number;
  readonly capacityKw: number;
  readonly cabinets: readonly Id<'cabinet'>[];
}

const sparesMemo = new WeakMap<RuleInput, readonly PoolSpares[]>();

function poolSpares(input: RuleInput): readonly PoolSpares[] {
  const memo = sparesMemo.get(input);
  if (memo) return memo;
  const { graph: g, facility: f } = input;
  const out: PoolSpares[] = [];
  const caps = (members: readonly { id: AnyId }[]) =>
    members.filter((m) => !g.baseline.has(m.id)).map((m) => memberCap(g, m.id).capacityKw.kw).sort((x, y) => y - x);
  const required = (intent: RedundancyIntent | null, n: number) =>
    intent === null ? null : intent.scheme === 'N' ? 0 : intent.scheme === 'N+K' ? intent.k : Math.floor(n / 2);

  for (const [id, pool] of g.halls) {
    const hall = f.get(id as Id<'hall'>);
    const demand = g.normalDemandKw.get(id) ?? 0;
    const c = caps(pool.crahs);
    const total = c.reduce((s, v) => s + v, 0);
    let spares = -1;
    for (let k = 0, left = total; k <= c.length && left + 1e-9 >= demand; left -= c[k] ?? 0, k++) spares = k;
    const intent = hall.coolingIntent.kind === 'known' ? hall.coolingIntent.value : null;
    out.push({
      pool: id as Id<'hall'>,
      spares,
      required: required(intent, c.length),
      intent,
      demandKw: demand,
      capacityKw: total,
      cabinets: pool.cabinets.map((x) => x.id as Id<'cabinet'>),
    });
  }
  for (const [id, pool] of g.loops) {
    const loop = f.get(id as Id<'loop'>);
    const demand = g.normalDemandKw.get(id) ?? 0;
    const ch = caps(pool.chillers);
    const pu = caps(pool.pumps);
    const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
    const capAfter = (i: number, j: number) => Math.min(sum(ch.slice(i)), pool.pumps.length === 0 ? Infinity : sum(pu.slice(j)));
    let spares = -1;
    for (let k = 0; k <= ch.length + pu.length; k++) {
      let ok = true;
      for (let i = 0; i <= k; i++) {
        const j = k - i;
        if (i > ch.length || j > pu.length) continue;
        if (capAfter(i, j) + 1e-9 < demand) ok = false;
      }
      if (!ok) break;
      spares = k;
    }
    const intent = loop.intent.kind === 'known' ? loop.intent.value : null;
    const halls = [...g.halls].filter(([, h]) => h.crahs.some((c) => c.loops.includes(id))).flatMap(([, h]) => h.cabinets.map((x) => x.id as Id<'cabinet'>));
    out.push({
      pool: id as Id<'loop'>,
      spares,
      required: required(intent, ch.length),
      intent,
      demandKw: demand,
      capacityKw: capAfter(0, 0) === Infinity ? sum(ch) : capAfter(0, 0),
      cabinets: halls,
    });
  }
  sparesMemo.set(input, out);
  return out;
}

/** The chain position of a node on a cord path (0 = the cord itself). */
const depthOn = (chains: readonly (readonly AnyId[])[], x: AnyId) => Math.max(...chains.map((c) => (c.includes(x) ? c.indexOf(x) : Infinity)));

// ───────────────────────────── The registry ─────────────────────────────

export const RULES: { readonly [R in RuleId]: Rule<R> } = {
  'single-corded': {
    detect(input) {
      const { graph: g, facility: f } = input;
      const out: FindingOf<'single-corded'>[] = [];
      for (const cab of f.list('cabinet')) {
        const s = cabinetRule(g, cab.id);
        const edges = s.cords.map((c) => cordCircuit(g, c));
        let circuit: Id<'circuit'> | null = null;
        let contingentOn: FactRef[] = [];
        if (edges.length === 1) {
          const e = edges[0]!;
          circuit = (e.to[0] as Id<'circuit'> | undefined) ?? null;
          contingentOn = e.to.length === 1 ? [] : [...e.refs];
        } else if (edges.length >= 2) {
          const common = edges.map((e) => new Set(e.to)).reduce((x, y) => new Set([...x].filter((v) => y.has(v))));
          if (common.size === 0) continue;
          circuit = [...common].sort()[0] as Id<'circuit'>;
        }
        out.push(
          finish(input, {
            rule: 'single-corded',
            key: cab.id,
            subject: cab.id,
            detail: { rule: 'single-corded', cabinet: cab.id, circuit },
            cabinets: [cab.id],
            base: 'medium',
            contingentOn,
          }),
        );
      }
      return out;
    },
    title: (d) => `Cabinet ${tagOf(d.cabinet)} is single-corded${d.circuit ? ` on ${tagOf(d.circuit)}` : ''}`,
  },

  'ab-convergence': {
    detect(input, prior) {
      const { facility: f } = input;
      const single = new Set(prior.filter((x) => x.rule === 'single-corded').map((x) => x.subject));
      const groups = new Map<string, { point: AnyId; cabinets: Id<'cabinet'>[]; cords: Id<'cord'>[]; contingentOn: FactRef[] }>();
      for (const cab of f.list('cabinet')) {
        if (single.has(cab.id)) continue;
        const p = input.paths(cab.id);
        if (p.cords.length < 2) continue;
        const chains = p.cords.map((c) => c.chain);
        const topo = p.spofs.filter((e) => e.cause === 'topology' && !p.cords.some((c) => c.cord === e.component));
        if (topo.length === 0) continue;
        const best = [...topo].sort((x, y) => depthOn(chains, x.component) - depthOn(chains, y.component) || (x.component < y.component ? -1 : 1))[0]!;
        const contingent = best.certainty === 'contingent';
        const key = `${best.component}${contingent ? ':contingent' : ''}`;
        let grp = groups.get(key);
        if (!grp) groups.set(key, (grp = { point: best.component, cabinets: [], cords: [], contingentOn: [] }));
        grp.cabinets.push(cab.id);
        grp.cords.push(...p.cords.map((c) => c.cord));
        grp.contingentOn.push(...best.contingentOn);
      }
      return [...groups]
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([key, grp]) =>
          finish(input, {
            rule: 'ab-convergence',
            key,
            subject: grp.point,
            detail: { rule: 'ab-convergence', cabinets: sorted(grp.cabinets), convergesAt: grp.point, cords: sorted(grp.cords) },
            cabinets: grp.cabinets,
            base: 'high',
            contingentOn: grp.contingentOn,
          }),
        );
    },
    title: (d) => `A and B feeds of ${d.cabinets.length} cabinet${d.cabinets.length === 1 ? '' : 's'} converge at ${tagOf(d.convergesAt)}`,
  },

  'failover-overload': {
    detect(input) {
      const { spofs } = input;
      const best = new Map<AnyId, { lost: AnyId; tr: Transition; cabinets: Id<'cabinet'>[] }>();
      for (const [x, run] of spofs.runs) {
        const capacityCabinets = (spofs.byComponent.get(x) ?? []).filter((c) =>
          spofs.byCabinet.get(c)!.some((e) => e.component === x && e.cause === 'capacity'),
        );
        if (capacityCabinets.length === 0) continue;
        for (const tr of run.final.values()) {
          if (tr.cause.kind !== 'overload' || tr.id === x) continue;
          const cur = best.get(tr.id);
          // Prefer a definite overload, then the highest load, then the most local loss (fewest nodes downed).
          const score = (t: Transition, lost: AnyId) => [t.state === 'down' ? 1 : 0, t.cause.kind === 'overload' ? t.cause.loadKw : 0, -spofs.runs.get(lost)!.final.size] as const;
          const a = score(tr, x);
          const b = cur ? score(cur.tr, cur.lost) : null;
          const better = !b || a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] + 1e-9 || (Math.abs(a[1] - b[1]) <= 1e-9 && (a[2] > b[2] || (a[2] === b[2] && x < cur!.lost)))));
          if (better) best.set(tr.id, { lost: x, tr, cabinets: capacityCabinets });
        }
      }
      return [...best]
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([overloaded, { lost, tr, cabinets }]) => {
          const c = tr.cause as Extract<Transition['cause'], { kind: 'overload' }>;
          return finish(input, {
            rule: 'failover-overload',
            key: overloaded,
            subject: overloaded,
            detail: { rule: 'failover-overload', lost, overloaded, loadKw: c.loadKw, ratedKw: c.ratedKw },
            cabinets,
            base: 'high',
            contingentOn: tr.contingentOn,
          });
        });
    },
    title: (d) => `Losing ${tagOf(d.lost)} overloads ${tagOf(d.overloaded)} (${d.loadKw} kW on ${d.ratedKw} kW)`,
  },

  'circuit-overcommit': {
    detect(input) {
      const { graph: g, facility: f } = input;
      const committed = new Map<AnyId, number>();
      for (const c of f.list('contract')) {
        for (const t of c.terms) if (t.kind === 'known' && t.value.term === 'committed-kw') committed.set(t.value.cabinet, t.value.kw);
      }
      const out: FindingOf<'circuit-overcommit'>[] = [];
      for (const circuit of f.list('circuit')) {
        const cap = g.nodes.get(circuit.id)?.capacity;
        if (!cap) continue;
        const cords = f.dependents(circuit.id).filter((d) => kindOf(d) === 'cord');
        const cabinets = sorted(cords.map((c) => g.cabinetOfCord.get(c)!).filter(Boolean));
        let failoverKw = 0;
        for (const cab of cabinets) failoverKw += Math.max(committed.get(cab) ?? 0, g.cabinetLoadKw.get(cab)!.kw);
        const measured = circuit.measuredKw.kind === 'known' ? circuit.measuredKw.value : 0;
        const loadKw = Math.max(failoverKw, g.normalLoadKw.get(circuit.id) ?? 0, measured);
        const ratedKw = cap.kw * CONTINUOUS_DERATE;
        if (loadKw <= ratedKw + 1e-9) continue;
        const contingentOn = cords.map((c) => cordCircuit(g, c)).filter((e) => e.to.length !== 1).flatMap((e) => e.refs);
        out.push(
          finish(input, {
            rule: 'circuit-overcommit',
            key: circuit.id,
            subject: circuit.id,
            detail: { rule: 'circuit-overcommit', circuit: circuit.id, loadKw: round2(loadKw), ratedKw: round2(ratedKw) },
            cabinets,
            base: 'medium',
            contingentOn,
          }),
        );
      }
      return out;
    },
    title: (d) => `Circuit ${tagOf(d.circuit)} must carry ${d.loadKw} kW on failover against ${d.ratedKw} kW continuous`,
  },

  'cooling-capacity': {
    detect(input) {
      return poolSpares(input)
        .filter((p) => p.spares < 0 || (p.required !== null ? p.spares < p.required : p.spares <= 0))
        .map((p) =>
          finish(input, {
            rule: 'cooling-capacity',
            key: p.pool,
            subject: p.pool,
            detail: { rule: 'cooling-capacity', pool: p.pool, intent: p.intent, sparesActual: p.spares, demandKw: round2(p.demandKw), capacityKw: round2(p.capacityKw) },
            cabinets: p.cabinets,
            base: p.spares < 0 ? 'critical' : 'high',
            contingentOn: [],
          }),
        );
    },
    title: (d) =>
      d.sparesActual < 0
        ? `${tagOf(d.pool)} cooling (${d.capacityKw} kW) is below its ${d.demandKw} kW heat load`
        : `${tagOf(d.pool)} can lose ${d.sparesActual} cooling unit${d.sparesActual === 1 ? '' : 's'}${d.intent ? ` (${renderIntent(d.intent)} intended)` : ' (no documented redundancy)'}`,
  },

  'cooling-common-cause': {
    detect(input) {
      const { graph: g, spofs } = input;
      const out: FindingOf<'cooling-common-cause'>[] = [];
      const pools: [AnyId, readonly AnyId[], readonly Id<'cabinet'>[]][] = [
        ...[...g.loops].map(([id, p]): [AnyId, AnyId[], Id<'cabinet'>[]] => [
          id,
          [...p.chillers, ...p.pumps].map((m) => m.id),
          [...g.halls.values()].filter((h) => h.crahs.some((c) => c.loops.includes(id))).flatMap((h) => h.cabinets.map((c) => c.id as Id<'cabinet'>)),
        ]),
        ...[...g.halls].map(([id, p]): [AnyId, AnyId[], Id<'cabinet'>[]] => [id, p.crahs.map((m) => m.id), p.cabinets.map((c) => c.id as Id<'cabinet'>)]),
      ];
      // A CRAH whose chilled-water loop is the failed component cools nothing, however it is powered.
      const drawsFrom = new Map([...g.halls.values()].flatMap((h) => h.crahs.map((c) => [c.id, c.loops] as const)));
      for (const [pool, members, cabinets] of pools) {
        const qualifying = new Map<AnyId, { tr: Transition; down: AnyId[] }>();
        for (const [x, run] of spofs.runs) {
          if (members.includes(x)) continue;
          const tr = run.final.get(pool);
          if (!tr || tr.cause.kind !== 'thermal' || RANK[tr.state] < RANK.unknown) continue;
          const down = members.filter((m) => {
            const t = run.final.get(m);
            return (!!t && RANK[t.state] >= RANK.unknown) || (drawsFrom.get(m)?.includes(x) ?? false);
          });
          if (down.length < 2) continue;
          if (kindOf(pool) === 'hall') {
            // Only the hall's own CRAHs: a deficit caused by the chilled-water loop belongs to the loop pool.
            const left = members.filter((m) => !down.includes(m)).reduce((s, m) => s + memberCap(g, m).capacityKw.kw, 0);
            const heat = cabinets.filter((c) => {
              const t = run.final.get(c);
              return !(t && t.state === 'down' && t.cause.kind !== 'thermal');
            }).reduce((s, c) => s + (g.cabinetLoadKw.get(c)?.kw ?? 0), 0);
            if (left + 1e-9 >= heat) continue;
          }
          qualifying.set(x, { tr, down });
        }
        for (const [x, { tr, down }] of [...qualifying].sort(([a], [b]) => (a < b ? -1 : 1))) {
          const run = spofs.runs.get(x)!;
          if ([...qualifying.keys()].some((y) => y !== x && run.final.has(y))) continue;
          out.push(
            finish(input, {
              rule: 'cooling-common-cause',
              key: `${pool}:${x}`,
              subject: x,
              detail: { rule: 'cooling-common-cause', pool: pool as Id<'loop' | 'hall'>, members: down, sharedPoint: x },
              cabinets,
              base: 'high',
              contingentOn: tr.contingentOn,
            }),
          );
        }
      }
      return out;
    },
    title: (d) => `${d.members.length} cooling units of ${tagOf(d.pool)} share ${tagOf(d.sharedPoint)}; losing it leaves too little cooling`,
  },

  'contract-topology-mismatch': {
    detect(input, prior) {
      const { facility: f, graph: g } = input;
      const out: FindingOf<'contract-topology-mismatch'>[] = [];
      const single = new Set(prior.filter((x) => x.rule === 'single-corded').map((x) => x.subject));
      const spares = poolSpares(input);
      type Actual = Extract<FindingDetail, { rule: 'contract-topology-mismatch' }>['actual'];
      const RANK_ACTUAL: Record<Actual, number> = { 'no-cooling-spare': 0, 'single-ups-path': 1, converged: 2, 'single-path': 3 };
      interface Verdict { readonly cab: Id<'cabinet'>; readonly actual: Actual; readonly contingentOn: readonly FactRef[] }

      /** Power terms compare topology only: capacity loss on failover is the failover-overload finding. */
      const powerVerdict = (cab: Id<'cabinet'>, level: '2N' | 'A+B'): Verdict | null => {
        const p = input.paths(cab);
        const topo = p.spofs.filter((e) => e.cause === 'topology');
        if (p.cords.length < 2 || topo.length > 0) {
          const definite = topo.filter((e) => e.certainty === 'definite');
          const used = definite.length > 0 || p.cords.length < 2 ? definite : topo;
          return {
            cab,
            actual: single.has(cab) || p.cords.length < 2 ? 'single-path' : 'converged',
            contingentOn: definite.length > 0 || p.cords.length < 2 ? [] : used.flatMap((e) => e.contingentOn),
          };
        }
        if (level !== '2N') return null;
        const firstUps = new Set(p.cords.map((cp) => cp.chain.find((id) => kindOf(id) === 'ups')).filter((u): u is AnyId => !!u));
        if (firstUps.size >= 2) return null;
        const contingentOn = p.cords.flatMap((cp) => cp.chain.flatMap((id) => (g.nodes.get(id)?.upstream ?? []).filter((u) => u.edge.to.length === 0).flatMap((u) => u.edge.refs)));
        return { cab, actual: 'single-ups-path', contingentOn };
      };
      const coolingVerdict = (cab: Id<'cabinet'>): Verdict | null => {
        const zone = cabinetRule(g, cab).zone;
        const pools = [...zone.to, ...sorted(zone.to.flatMap((h) => (g.halls.get(h)?.crahs ?? []).flatMap((m) => m.loops)))];
        const failing = pools.flatMap((pool) => {
          const p = spares.find((s) => s.pool === pool);
          const findings = prior.filter((x) => (x.rule === 'cooling-common-cause' || x.rule === 'cooling-capacity') && x.detail.pool === pool);
          return (p !== undefined && p.spares < 1) || findings.length > 0 ? [{ p, findings }] : [];
        });
        if (failing.length === 0) return null;
        const definite = failing.some((x) => x.findings.some((y) => y.certainty === 'definite') || (x.p && x.p.spares < 1));
        return { cab, actual: 'no-cooling-spare', contingentOn: definite ? [] : failing.flatMap((x) => x.findings.flatMap((y) => y.contingentOn)) };
      };

      for (const c of f.list('contract')) {
        const cabinets = c.cabinets.kind === 'known' ? c.cabinets.value : [];
        for (const t of c.terms) {
          if (t.kind !== 'known') continue;
          const term = t.value;
          let verdicts: Verdict[];
          if (term.term === 'power-redundancy' && (term.level === '2N' || term.level === 'A+B')) {
            const level = term.level;
            verdicts = cabinets.map((cab) => powerVerdict(cab, level)).filter((v): v is Verdict => v !== null);
          } else if (term.term === 'cooling-redundancy' && term.level === 'N+1') {
            verdicts = cabinets.map(coolingVerdict).filter((v): v is Verdict => v !== null);
          } else continue;
          const field = t.ref.slice(t.ref.indexOf('#') + 1);
          const groups: [string, Verdict[]][] = [
            [`${c.id}:${field}`, verdicts.filter((v) => v.contingentOn.length === 0)],
            [`${c.id}:${field}:contingent`, verdicts.filter((v) => v.contingentOn.length > 0)],
          ];
          for (const [key, vs] of groups) {
            if (vs.length === 0) continue;
            const actual = vs.map((v) => v.actual).reduce((x, y) => (RANK_ACTUAL[y] > RANK_ACTUAL[x] ? y : x));
            out.push(
              finish(input, {
                rule: 'contract-topology-mismatch',
                key,
                subject: c.id,
                detail: { rule: 'contract-topology-mismatch', contract: c.id, term, termRef: t.ref, cabinets: sorted(vs.map((v) => v.cab)), actual },
                cabinets: vs.map((v) => v.cab),
                base: 'high',
                contingentOn: vs.flatMap((v) => v.contingentOn),
              }),
            );
          }
        }
      }
      return out;
    },
    title: (d) => `${tagOf(d.contract)} promises ${renderTerm(d.term)} but ${d.cabinets.length} cabinet${d.cabinets.length === 1 ? ' is' : 's are'} ${d.actual.replace(/-/g, ' ')}`,
  },
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Runs RULES in RULE_IDS order, sorts by (severity, revenue, id). */
export function runAudit(input: RuleInput, revision: Revision): AuditReport {
  const findings: Finding[] = [];
  for (const rule of RULE_IDS) {
    const r = RULES[rule] as Rule<RuleId>;
    findings.push(...(r.detect(input, findings) as Finding[]));
  }
  findings.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || y.revenueExposed - x.revenueExposed || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { revision, findings };
}

export function findingTitle(x: Finding, f: Facility): string {
  return (RULES[x.rule] as Rule<RuleId>).title(x.detail as never, f);
}

export interface AuditDelta {
  readonly cleared: readonly FindingId[];
  readonly introduced: readonly FindingId[];
  readonly persisted: readonly FindingId[];
}

export function diffAudits(before: AuditReport, after: AuditReport): AuditDelta {
  const a = new Set(after.findings.map((x) => x.id));
  const b = new Set(before.findings.map((x) => x.id));
  return {
    cleared: sorted([...b].filter((id) => !a.has(id))),
    introduced: sorted([...a].filter((id) => !b.has(id))),
    persisted: sorted([...b].filter((id) => a.has(id))),
  };
}
