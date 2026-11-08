// Method of procedure (MOP) draft for an assessed work order. Every step is a switching action whose
// effect is computed by `propagate` on the model as it stands at that step: the documented as-built
// model, or the model after the prerequisite moves the planner proposes. Nothing is written by a model.
//
// Sections follow the MOP content Uptime and practitioner guides list (docs/research/03 §1): header and
// approvals, scope, affected systems and customers, customer notification, pre-checks, numbered
// switching steps with expected results, stop conditions, back-out, and post-work verification.

import { RISK_GRADES, type CoolingUnits, type EntityKind, type Side } from '../contract.js';
import type { Analysis } from '../analysis/analysis.js';
import { internalsOf } from '../analysis/analysis.js';
import { findingTitle, type Finding, type FindingId } from '../analysis/audit.js';
import type { FixPlan } from '../analysis/planner.js';
import type { AnyId, FactRef, Id } from '../facility/ids.js';
import { kindOf, tagOf } from '../facility/ids.js';
import { displayFact } from '../facility/kinds.js';
import type { Patch, PatchOp } from '../facility/patch.js';
import type { SiteHistory } from '../history/history.js';
import { propagate, type Initiator, type Propagation, type SupplyGraph, type Transition } from '../physics/supply.js';
import {
  assessWorkOrders, cabinetRange, changedLevels, poolLevels, renderRedundancy, renderSpare, sharedFeeds,
  type PoolLevel, type WorkAssessment,
} from './assessment.js';
import { earliestStartAfterNotice, noticeDueBy, noticeTermOf } from './notices.js';
import { businessDaysBetween, type LocalDateTime, type WorkOrder } from './work-orders.js';

// ───────────────────────────── The document ─────────────────────────────

/** One switching action. `open`/`stop`/`to-bypass`/`unplug` take something out; the rest put it back or change the wiring. */
export type SwitchAction =
  | { readonly op: 'open'; readonly device: AnyId }
  | { readonly op: 'close'; readonly device: AnyId }
  | { readonly op: 'stop'; readonly unit: AnyId; readonly says: string }
  | { readonly op: 'restart'; readonly unit: AnyId }
  | { readonly op: 'to-bypass'; readonly ups: AnyId }
  | { readonly op: 'from-bypass'; readonly ups: AnyId }
  | { readonly op: 'unplug'; readonly cord: AnyId; readonly circuit: AnyId }
  | { readonly op: 'rewire'; readonly change: PatchOp };

export type StepPhase = 'prerequisite' | 'work' | 'back-out';

export interface CabinetChange {
  readonly customer: Id<'customer'>;
  readonly cabinets: readonly Id<'cabinet'>[];
  readonly before: readonly Side[];
  readonly after: readonly Side[];
  /** False when the outcome hinges on a fact no document states. */
  readonly certain: boolean;
}

export interface StepEffect {
  /** Plant (panels, UPS, cooling units) that loses supply at this step, and plant that gets it back. */
  readonly deenergized: readonly AnyId[];
  readonly reenergized: readonly AnyId[];
  readonly customers: readonly CabinetChange[];
  readonly pools: readonly PoolLevel[];
}

export interface MopStep {
  readonly n: number;
  readonly phase: StepPhase;
  readonly action: SwitchAction;
  /** How many of the prerequisite moves are made in the model this step runs on (0 = as built). */
  readonly applied: number;
  /** The plant after this step, as the scenario that produces it on that model. */
  readonly state: readonly Initiator[];
  readonly effect: StepEffect;
  /** "Open PDU-3A-SF-3 → RPP-4B de-energized → Halcyon Health Partners E01–E05 A+B → A". */
  readonly text: string;
  /** A customer cabinet loses its last feed at this step (or may, where a record is missing). */
  readonly hold: boolean;
}

export interface MopNotice {
  readonly customer: Id<'customer'>;
  readonly cabinets: readonly Id<'cabinet'>[];
  readonly impact: string;
  readonly noticeDays: number | null;
  /** Last site-local day notice can be given; null without a notice clause. */
  readonly deadline: string | null;
  readonly status: 'on-time' | 'deadline-passed' | 'no-clause';
  readonly text: string;
}

export interface Prerequisite {
  readonly plan: FixPlan;
  readonly patch: Patch;
  readonly clears: readonly FindingId[];
}

export interface Mop {
  readonly workOrder: WorkOrder;
  readonly asOf: LocalDateTime;
  readonly title: string;
  /** The assessment as scheduled, and with the prerequisite moves made (null without prerequisites). */
  readonly assessment: Extract<WorkAssessment, { assessed: true }>;
  readonly prepared: Extract<WorkAssessment, { assessed: true }> | null;
  readonly prerequisite: Prerequisite | null;
  readonly header: readonly string[];
  readonly approvals: readonly string[];
  readonly scope: readonly string[];
  readonly affected: readonly string[];
  readonly notifications: readonly MopNotice[];
  readonly prechecks: readonly string[];
  readonly steps: readonly MopStep[];
  readonly stopConditions: readonly string[];
  readonly backout: readonly MopStep[];
  readonly verification: readonly string[];
  /** Single further faults during the window that cause an outage they would not cause today: the replan's choices. */
  readonly contingencies: readonly AnyId[];
}

// ───────────────────────────── Isolation: how each kind of asset is taken out ─────────────────────────────

interface IsolationInput {
  readonly asset: AnyId;
  readonly how: Initiator['how'];
  readonly says: string;
  readonly an: Analysis;
}

const loadedBranches = ({ asset, an }: IsolationInput): SwitchAction[] => {
  const g = internalsOf(an).graph;
  return (g.dependents.get(asset) ?? [])
    .filter((b) => kindOf(b) === 'breaker' && (g.dependents.get(b) ?? []).length > 0)
    .map((device) => ({ op: 'open', device }));
};

/** The breaker feeding `asset`, when its input is one known breaker. */
function feederOf({ asset, an }: IsolationInput): AnyId | null {
  const input = internalsOf(an).graph.nodes.get(asset)?.upstream.find((u) => u.role === 'input')?.edge;
  return input && input.to.length === 1 && kindOf(input.to[0]!) === 'breaker' ? input.to[0]! : null;
}

const stopUnit = (x: IsolationInput): SwitchAction[] => [{ op: 'stop', unit: x.asset, says: x.says }];

const branchesThenFeeder = (x: IsolationInput): SwitchAction[] => {
  const feeder = feederOf(x);
  return [...loadedBranches(x), feeder ? { op: 'open', device: feeder } : { op: 'stop', unit: x.asset, says: x.says }];
};

/**
 * The switching that takes each kind of asset out of service. A distribution panel sheds its loaded
 * branch breakers one at a time, so each step's effect is one panel's load, then its feeder opens.
 */
const ISOLATION: { readonly [K in EntityKind]?: (x: IsolationInput) => SwitchAction[] } = {
  switchgear: branchesThenFeeder,
  pdu: branchesThenFeeder,
  rpp: (x) => {
    const feeder = feederOf(x);
    return feeder ? [{ op: 'open', device: feeder }] : stopUnit(x);
  },
  breaker: (x) => [{ op: 'open', device: x.asset }],
  ups: (x) => (x.how === 'maintenance' ? [{ op: 'to-bypass', ups: x.asset }] : [...loadedBranches(x), ...stopUnit(x)]),
};

const UNDO: { readonly [O in SwitchAction['op']]?: (a: Extract<SwitchAction, { op: O }>) => SwitchAction } = {
  open: (a) => ({ op: 'close', device: a.device }),
  stop: (a) => ({ op: 'restart', unit: a.unit }),
  'to-bypass': (a) => ({ op: 'from-bypass', ups: a.ups }),
};

const undo = (a: SwitchAction): SwitchAction => (UNDO[a.op] as ((x: SwitchAction) => SwitchAction) | undefined)?.(a) ?? a;

/** The engine event an action leaves standing, if any. */
function eventOf(a: SwitchAction): Initiator | null {
  switch (a.op) {
    case 'open':
      return { target: a.device, how: 'fails', atMin: 0 };
    case 'stop':
      return { target: a.unit, how: 'fails', atMin: 0 };
    case 'to-bypass':
      return { target: a.ups, how: 'maintenance', atMin: 0 };
    case 'unplug':
      return { target: a.cord, how: 'fails', atMin: 0 };
    default:
      return null;
  }
}

const restored = (a: SwitchAction): AnyId | null => (a.op === 'close' ? a.device : a.op === 'restart' ? a.unit : a.op === 'from-bypass' ? a.ups : null);

// ───────────────────────────── Engine state per step ─────────────────────────────

const PLANT_KINDS: ReadonlySet<EntityKind> = new Set(['switchgear', 'ups', 'pdu', 'rpp', 'chiller', 'pump', 'crah', 'generator', 'ats']);
const COOLING_KINDS: ReadonlySet<EntityKind> = new Set(['chiller', 'pump', 'crah']);
const RANK = { up: 0, exposed: 1, unknown: 2, down: 3 } as const;

interface ModelRun {
  readonly an: Analysis;
  readonly g: SupplyGraph;
  readonly run: (events: readonly Initiator[]) => Propagation;
}

function modelRun(an: Analysis): ModelRun {
  const g = internalsOf(an).graph;
  const memo = new Map<string, Propagation>();
  const run = (events: readonly Initiator[]) => {
    const key = JSON.stringify(events);
    let p = memo.get(key);
    if (!p) memo.set(key, (p = propagate(g, events, { timed: false })));
    return p;
  };
  return { an, g, run };
}

const stateIn = (m: ModelRun, p: Propagation, id: AnyId): Transition['state'] => p.final.get(id)?.state ?? (m.g.baseline.has(id) ? 'unknown' : 'up');
const failing = (s: Transition['state']) => RANK[s] >= RANK.unknown;

interface CabinetState {
  readonly sides: readonly Side[];
  readonly certain: boolean;
}

function cabinetStates(m: ModelRun, events: readonly Initiator[]): Map<Id<'cabinet'>, CabinetState> {
  const p = m.run(events);
  const out = new Map<Id<'cabinet'>, CabinetState>();
  for (const n of m.g.nodes.values()) {
    if (n.supply.rule !== 'any-cord') continue;
    const cab = n.id as Id<'cabinet'>;
    const tr = p.final.get(cab);
    const live = failing(stateIn(m, p, cab)) ? [] : n.supply.cords.filter((c) => stateIn(m, p, c) === 'up');
    const sides = [...new Set(live.map((c) => m.g.cordLabel.get(c)).filter((x): x is Side => !!x))].sort();
    const unsure = n.supply.cords.some((c) => stateIn(m, p, c) === 'unknown') || (tr?.contingentOn.length ?? 0) > 0;
    out.set(cab, { sides, certain: !unsure });
  }
  return out;
}

// ───────────────────────────── Build ─────────────────────────────

const FIXABLE_RULES = new Set(['single-corded', 'ab-convergence', 'failover-overload']);

/** Pass-through shape for the assessed variant. */
type Assessed = Extract<WorkAssessment, { assessed: true }>;

export interface MopInput {
  readonly an: Analysis;
  readonly order: WorkOrder;
  /** Every work order, for related open work and the assessment's record trail. */
  readonly history: readonly WorkOrder[];
  readonly site: SiteHistory;
  readonly asOf: LocalDateTime;
}

export function draftMop({ an, order, history, site, asOf }: MopInput): Mop | { readonly why: string } {
  const assessed = assessWorkOrders(an, [order], history)[0]!;
  if (!assessed.assessed) return { why: assessed.why };
  const f = an.facility;
  const customerName = (c: Id<'customer'>) => displayFact(f.get(c).name) ?? tagOf(c);
  const customerOf = (cab: Id<'cabinet'>): Id<'customer'> | null => {
    const owner = f.get(cab).customer;
    return owner.kind === 'known' ? owner.value : null;
  };

  // Prerequisite moves: the planner's fix for every definite finding behind a cabinet the work would drop.
  const audit = an.audit().findings;
  const lost = new Set(assessed.reasons.filter((r) => r.kind === 'loses-power' && r.certainty === 'definite').flatMap((r) => r.customers.flatMap((c) => c.cabinets)));
  const behind = (x: Finding) => x.certainty === 'definite' && FIXABLE_RULES.has(x.rule) && x.affected.some((i) => i.cabinets.some((c) => lost.has(c)));
  const targets = audit.filter(behind).map((x) => x.id);
  const outcome = targets.length > 0 ? an.planOutcome({ clear: targets, maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'], alternatives: 1 }) : null;
  const plan = outcome?.plans[0] ?? null;

  // One analysis per number of moves made, so each prerequisite step runs on the wiring of its moment.
  const models: ModelRun[] = [modelRun(an)];
  for (let i = 1; plan && i <= plan.patch.ops.length; i++) {
    const after = an.verify({ base: plan.patch.base, ops: plan.patch.ops.slice(0, i) }, `${plan.id}#${i}`).after;
    if (!after) break;
    models.push(modelRun(after));
  }
  const ready = plan !== null && models.length === plan.patch.ops.length + 1;
  const final = ready ? models.at(-1)! : models[0]!;
  const prepared = ready ? (assessWorkOrders(final.an, [order], history)[0] as Assessed) : null;
  const working: Assessed = prepared ?? assessed;


  // ── Steps ──
  const steps: MopStep[] = [];
  const backout: MopStep[] = [];
  let prevModel = models[0]!;
  let prevState: readonly Initiator[] = [];
  const push = (into: MopStep[], phase: StepPhase, action: SwitchAction, applied: number, state: readonly Initiator[]): MopStep => {
    const m = models[applied]!;
    const effect = effectOf(prevModel, prevState, m, state, customerOf);
    const step: MopStep = {
      n: steps.length + backout.length + 1,
      phase,
      action,
      applied,
      state,
      effect,
      text: stepText(action, effect, customerName),
      hold: effect.customers.some((c) => c.after.length === 0 && c.before.length > 0),
    };
    into.push(step);
    prevModel = m;
    prevState = state;
    return step;
  };

  if (ready) {
    plan.patch.ops.forEach((op, i) => {
      const fails = (target: AnyId): Initiator[] => [{ target, how: 'fails', atMin: 0 }];
      switch (op.op) {
        case 'refeed':
          push(steps, 'prerequisite', { op: 'open', device: op.from }, i, fails(op.from));
          push(steps, 'prerequisite', { op: 'rewire', change: op }, i + 1, fails(op.to));
          push(steps, 'prerequisite', { op: 'close', device: op.to }, i + 1, []);
          break;
        case 'rehome-cord':
          push(steps, 'prerequisite', { op: 'unplug', cord: op.cord, circuit: op.from }, i, fails(op.cord));
          push(steps, 'prerequisite', { op: 'rewire', change: op }, i + 1, []);
          break;
        case 'add-cord':
          push(steps, 'prerequisite', { op: 'rewire', change: op }, i + 1, []);
          break;
      }
    });
  }
  const applied = models.indexOf(final);
  const isolation = (ISOLATION[kindOf(working.work.asset)] ?? stopUnit)({ asset: working.work.asset, how: working.work.events[0]!.how, says: working.work.says, an: final.an });
  const workSteps: MopStep[] = [];
  let state: Initiator[] = [];
  for (const action of isolation) {
    state = [...state, eventOf(action)!];
    workSteps.push(push(steps, 'work', action, applied, state));
  }
  for (const s of [...workSteps].reverse()) {
    const ev = eventOf(s.action)!;
    state = state.filter((e) => e.target !== ev.target);
    push(backout, 'back-out', undo(s.action), applied, state);
  }

  // ── Sections ──
  const lastWork = workSteps.at(-1);
  const preparedNote = prepared ? ` (with the prerequisite moves: ${RISK_GRADES[prepared.grade]})` : '';
  const header: string[] = [
    `${order.wonum} · ${order.description} · status ${order.status}${order.priority !== null ? ` · priority ${order.priority}` : ''}`,
    `Asset: ${tagOf(working.work.asset)}${order.asset?.resolved ? ` (Maximo ${order.asset.assetNum})` : ''} at ${order.location}`,
    `Window: ${order.scheduledStart ?? 'unscheduled'} to ${order.scheduledFinish ?? 'open'} site time`,
    `Performed by: ${[order.vendor && `vendor ${order.vendor}`, order.lead && `lead ${order.lead}`, order.ownerGroup].filter(Boolean).join(', ') || 'not stated'}`,
    `Risk grade: ${RISK_GRADES[assessed.grade]} as scheduled${preparedNote}. ${assessed.headline}`,
  ];

  const touched = new Map<Id<'customer'>, { cabinets: Set<Id<'cabinet'>>; worst: number; impact: string }>();
  const IMPACT = ['one further fault from an outage', 'cooling redundancy reduced', 'runs on one feed', 'may lose power (a record is missing)', 'loses power'] as const;
  const note = (c: Id<'customer'>, cabs: readonly Id<'cabinet'>[], level: number) => {
    const cur = touched.get(c) ?? { cabinets: new Set<Id<'cabinet'>>(), worst: -1, impact: '' };
    cabs.forEach((x) => cur.cabinets.add(x));
    if (level > cur.worst) Object.assign(cur, { worst: level, impact: IMPACT[level]! });
    touched.set(c, cur);
  };
  for (const s of steps) {
    for (const c of s.effect.customers) {
      if (c.after.length >= c.before.length) continue;
      note(c.customer, c.cabinets, c.after.length === 0 ? (c.certain ? 4 : 3) : 2);
    }
  }
  for (const r of working.reasons) {
    const level = r.kind === 'loses-power' ? (r.certainty === 'definite' ? 4 : 3) : r.kind === 'one-cord-left' ? 2 : r.kind === 'loses-cooling' ? 4 : r.kind === 'cooling-margin' ? 1 : 0;
    for (const c of r.customers) note(c.customer, c.cabinets, level);
  }

  const affected: string[] = [
    ...working.reasons.map((r) => (r.text)),
    ...working.pools.map((p) => `${UNIT_NAME[p.units]} in ${tagOf(p.pool)}: ${renderSpare(p.before)} → ${renderSpare(p.after)} while ${tagOf(working.work.asset)} is ${working.work.says}`),
    ...working.plant.map((id) => `${tagOf(id)} ${id === working.work.asset ? working.work.says : 'changes mode'}: its load runs unprotected`),
  ];
  if (affected.length === 0) affected.push(working.headline);

  const notifications = [...touched]
    .sort(([, x], [, y]) => y.worst - x.worst || (x.impact < y.impact ? -1 : 1))
    .map(([customer, t]) => notice(an, customer, [...t.cabinets].sort(), t.impact, order, asOf, customerName));

  // ── Pre-checks ──
  const prechecks: string[] = [];
  const late = notifications.filter((x) => x.status === 'deadline-passed');
  if (late.length > 0) {
    const due = [...new Set(late.map((n) => n.deadline!))].sort().map(dayLabel).join(', ');
    const earliest = earliestStartAfterNotice(asOf, Math.max(...late.map((n) => n.noticeDays!)));
    prechecks.push(`Customer notice is late for ${late.map((n) => customerName(n.customer)).join(', ')} (due ${due}). Hold until each has accepted the window in writing, or reschedule to ${dayLabel(earliest)} or later (section 4).`);
  }
  const unclaused = notifications.filter((x) => x.status === 'no-clause');
  if (unclaused.length > 0) prechecks.push(`No notice clause on record for ${unclaused.map((n) => customerName(n.customer)).join(', ')}: notify per site practice before the window.`);
  const firstWork = workSteps[0]?.n ?? 1;
  if (ready) {
    const preSteps = steps.filter((s) => s.phase === 'prerequisite');
    const moves = plan.explanation.slice(0, -1).map((e) => e.replace(/: addresses .*$/, '')).map((e) => e.charAt(0).toLowerCase() + e.slice(1));
    prechecks.push(`Before opening anything on ${tagOf(working.work.asset)}: ${moves.join('; ')} (steps ${preSteps[0]!.n}–${preSteps.at(-1)!.n}). The planner's re-audit clears ${plan.cleared.length} finding${plan.cleared.length === 1 ? '' : 's'} and introduces none. Re-assessed with the moves made (grade ${RISK_GRADES[prepared!.grade]}): ${prepared!.headline}`);
    const related = relatedOpenWork(history, plan.patch.ops, an, order.wonum);
    for (const o of related) prechecks.push(`Open work order ${o.wonum} (${o.status}) is on the same equipment: ${o.description}. Close it with this move or confirm it is superseded.`);
    for (const x of assessed.reasons.flatMap((r) => r.contradictions)) {
      const wos = x.workOrders.map((o) => `${o.wonum} ${o.status}`).join(', ');
      prechecks.push(`${tagOf(x.entity)} is labelled ${x.labelledSide} but fed from ${tagOf(x.fedFrom)} (${x.tracedSide} side)${wos ? `; work orders ${wos}` : ''}. Field-confirm the feeder at the panel before step ${(steps.find((s) => s.action.op === 'open' && s.action.device === x.fedFrom) ?? preSteps[0]!).n}.`);
    }
  }
  for (const u of outcome?.unplanned ?? []) {
    const finding = audit.find((x) => x.id === u.finding);
    prechecks.push(`Hold: ${finding ? cabinetsOf(finding) : u.finding} still loses power during the work and the planner has no move for it (${u.detail}). Get the customer's written acceptance of the outage or do not proceed.`);
  }
  const unsure = audit.filter((x) => x.certainty === 'contingent' && x.affected.some((i) => i.cabinets.some((c) => steps.some((s) => s.effect.customers.some((k) => k.cabinets.includes(c))))));
  const atRisk = (ref: FactRef) => [...new Set(unsure.filter((x) => x.contingentOn.includes(ref)).flatMap((x) => x.affected.flatMap((i) => i.cabinets)))];
  for (const ref of [...new Set(unsure.flatMap((x) => x.contingentOn))].sort()) {
    const at = steps.find((s) => s.effect.customers.some((c) => !c.certain));
    prechecks.push(`Field-confirm ${refLabel(ref)} before step ${at?.n ?? firstWork}: no document states it, and ${cabinetRange(atRisk(ref))} may lose${at ? ` power at step ${at.n}` : ' redundancy'} depending on it.`);
  }
  const g = final.g;
  const shared = sharedFeeds(g, working.work.asset);
  for (const feed of [...new Set(shared.map((s) => s.feed))]) {
    const units = shared.filter((s) => s.feed === feed);
    prechecks.push(`Isolate ${tagOf(working.work.asset)} at its own disconnect. Do not open ${tagOf(feed)}: it also feeds ${units.map((s) => tagOf(s.unit)).join(', ')}.`);
  }
  for (const id of standbyPeers(final, working.work.asset)) {
    prechecks.push(`Start standby ${tagOf(id)} and confirm it is carrying load before step ${firstWork}: the engine counts it toward the ${UNIT_NAME[unitsOf(id)].toLowerCase()} that remain while ${tagOf(working.work.asset)} is out.`);
  }
  for (const o of openWorkOnPools(history, final, working.work.asset, order.wonum)) {
    prechecks.push(`Open work order ${o.wonum} (${o.status}) is on ${o.asset?.resolved ? tagOf(o.asset.entity) : o.location}, in the same pool: ${o.description}. Confirm that unit is in service before step ${firstWork}.`);
  }
  if (prechecks.length === 0) prechecks.push(`No prerequisite moves: no customer cabinet loses its last feed during the work.`);

  // ── Stop conditions ──
  const stopConditions: string[] = [];
  const contingencies = contingenciesOf(working);
  for (const r of working.reasons.filter((x) => x.secondFaults.length > 0)) {
    const who = [...new Set(r.customers.map((c) => customerName(c.customer)))].join(', ');
    const equipment = r.secondFaults.filter(isEquipment).map(tagOf);
    const branches = r.secondFaults.length - equipment.length;
    const what = [...equipment, ...(branches > 0 ? [`any of the ${branches} cords and branch circuits left carrying it`] : [])];
    stopConditions.push(`Stop and back out if ${listOr(what)} trips or alarms: with ${tagOf(working.work.asset)} ${working.work.says}, that drops ${who || 'customer load'}${r.kind === 'cooling-margin' ? ' short of cooling' : ''}.`);
  }
  const powerWork = steps.some((s) => s.phase === 'work' && s.effect.customers.length > 0) || working.plant.length > 0;
  if (powerWork) {
    const ats = f.list('ats');
    stopConditions.push(`Hold switching if utility power is lost or a generator starts (${ats.map((x) => x.tag).join(', ')} transfer): load already on one path rides the transfer with no second feed.`);
  }
  const coolingWork = COOLING_KINDS.has(kindOf(working.work.asset)) || working.reasons.some((r) => r.kind === 'cooling-margin' || r.kind === 'loses-cooling');
  if (coolingWork) {
    for (const h of f.list('hall')) {
      const limit = h.maxInletC;
      if (limit.kind !== 'known') continue;
      stopConditions.push(`Stop and back out if any ${h.tag} cold aisle exceeds ${fmtF(limit.value * 1.8 + 32)} °F (${limit.value} °C maximum inlet).`);
    }
    for (const [loop, { chillers }] of g.loops) {
      const latest = latestSample(site, loop, asOf, /CHWS/i);
      const reading = latest ? `; last reading ${latest.value} °F at ${latest.at}` : '';
      const members = new Set<AnyId>(chillers.map((x) => x.id));
      const limits = site.limits.filter((l) => l.bound === 'high' && /CHWS/i.test(l.source) && members.has(l.entity));
      const at = limits.length ? Math.min(...limits.map((l) => l.value)) : null;
      stopConditions.push(
        at === null
          ? `Stop and back out if ${tagOf(loop)} supply water alarms high. The BMS point list sets no CHWS high alarm on its chillers: agree a limit before the window${reading}.`
          : `Stop and back out if ${tagOf(loop)} supply water rises above ${at} °F (BMS high alarm)${reading}.`,
      );
    }
  }
  if (stopConditions.length === 0) stopConditions.push(`Stop and back out if any alarm appears on ${tagOf(working.work.asset)} or its feeds: the engine finds no further single fault that this work turns into an outage.`);

  // ── Verification ──
  const verification: string[] = [];
  for (const r of working.reasons) {
    for (const c of r.customers) {
      if (!c.before) continue;
      verification.push(`${customerName(c.customer)} ${cabinetRange(c.cabinets)} back on ${renderRedundancy(c.before)}: every listed feed energized and drawing load.`);
    }
  }
  for (const p of working.pools) verification.push(`${UNIT_NAME[p.units]} in ${tagOf(p.pool)} back to ${renderSpare(p.before)} with ${tagOf(working.work.asset)} in service.`);
  for (const id of working.plant) verification.push(`${tagOf(id)} back on its normal path (off bypass, alternate open).`);
  const end = backout.at(-1);
  const restoredAll = !end || [...cabinetStates(final, end.state)].every(([cab, s]) => sameSides(s.sides, cabinetStates(final, []).get(cab)!.sides));
  verification.push(restoredAll
      ? `Engine check: after step ${end?.n ?? lastWork?.n ?? 1} every cabinet is back to its pre-work feeds.`
      : `Engine check failed: after the back-out some cabinet is not back to its pre-work feeds. Do not close the work order.`);
  if (ready) {
    for (const id of plan.cleared) {
      const x = audit.find((y) => y.id === id);
      if (x) verification.push(`Prerequisite holds: "${findingTitle(x, f)}" is cleared in the re-audit. Update the equipment register and circuit roster to the new feeds.`);
    }
  }
  verification.push(`Return ${order.wonum} in Maximo with the as-left state recorded.`);

  const scope: string[] = [
    `${tagOf(working.work.asset)} ${working.work.says} for: ${order.description}${order.jobPlan ? ` (job plan ${order.jobPlan}${order.pm ? `, PM ${order.pm}` : ''})` : ''}.`,
    `Switching covered: ${steps.filter((s) => s.phase !== 'back-out').length} step${steps.length === 1 ? '' : 's'}${ready ? `, including ${plan.patch.ops.length} prerequisite move${plan.patch.ops.length === 1 ? '' : 's'} from the fix planner` : ''}, and ${backout.length} back-out step${backout.length === 1 ? '' : 's'}. Each expected result is the engine's, on the model as it stands at that step.`,
  ];

  const approvals = approvalsFor({ steps: [...steps, ...backout], order, customerName, touched, liveAsset: (final.g.normalLoadKw.get(working.work.asset) ?? 0) > 0 ? working.work.asset : null });

  return {
    workOrder: order,
    asOf,
    title: `MOP: ${tagOf(working.work.asset)} ${working.work.says} (${order.wonum})`,
    assessment: assessed,
    prepared,
    prerequisite: ready ? { plan, patch: plan.patch, clears: plan.cleared } : null,
    header,
    approvals,
    scope,
    affected,
    notifications,
    prechecks,
    steps,
    stopConditions,
    backout,
    verification,
    contingencies,
  };
}

// ───────────────────────────── Effects and words ─────────────────────────────

function effectOf(pm: ModelRun, pe: readonly Initiator[], m: ModelRun, e: readonly Initiator[], customerOf: (c: Id<'cabinet'>) => Id<'customer'> | null): StepEffect {
  const pp = pm.run(pe);
  const p = m.run(e);
  const acted = new Set([...pe, ...e].map((x) => x.target));
  const plant = [...new Set([...m.g.nodes.keys()].filter((id) => PLANT_KINDS.has(kindOf(id)) && !acted.has(id)))].sort();
  const was = (id: AnyId) => (pm.g.nodes.has(id) ? failing(stateIn(pm, pp, id)) : false);
  const is = (id: AnyId) => failing(stateIn(m, p, id));
  const deenergized = plant.filter((id) => !was(id) && is(id));
  const reenergized = plant.filter((id) => was(id) && !is(id));

  const before = cabinetStates(pm, pe);
  const after = cabinetStates(m, e);
  const groups = new Map<string, { customer: Id<'customer'>; cabinets: Id<'cabinet'>[]; before: readonly Side[]; after: readonly Side[]; certain: boolean }>();
  for (const [cab, a] of [...after].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const b = before.get(cab) ?? { sides: [], certain: true };
    if (sameSides(a.sides, b.sides)) continue;
    const customer = customerOf(cab);
    if (!customer) continue;
    const certain = a.certain && b.certain;
    const key = JSON.stringify([customer, b.sides, a.sides, certain]);
    const cur = groups.get(key);
    if (cur) cur.cabinets.push(cab);
    else groups.set(key, { customer, cabinets: [cab], before: b.sides, after: a.sides, certain });
  }

  const coolingMoved = [...m.g.nodes.keys()].some((id) => COOLING_KINDS.has(kindOf(id)) && was(id) !== is(id)) || [...pe, ...e].some((x) => COOLING_KINDS.has(kindOf(x.target)));
  const pools = coolingMoved && pm === m ? changedLevels(poolLevels(m.g, m.run, pe), poolLevels(m.g, m.run, e), null) : [];
  return { deenergized, reenergized, customers: [...groups.values()], pools };
}

const sameSides = (x: readonly Side[], y: readonly Side[]) => x.length === y.length && x.every((s, i) => s === y[i]);
const sidesLabel = (s: readonly Side[]) => (s.length === 0 ? 'none' : s.join('+'));

const UNIT_NAME: { readonly [U in CoolingUnits]: string } = { chillers: 'Chillers', pumps: 'Chilled water pumps', crahs: 'CRAHs' };

function actionWords(a: SwitchAction): string {
  switch (a.op) {
    case 'open':
      return `Open ${tagOf(a.device)}`;
    case 'close':
      return `Close ${tagOf(a.device)}`;
    case 'stop':
      return `Take ${tagOf(a.unit)} out of service (${a.says}) and lock out`;
    case 'restart':
      return `Remove lockout and return ${tagOf(a.unit)} to service`;
    case 'to-bypass':
      return `Transfer ${tagOf(a.ups)} to maintenance bypass`;
    case 'from-bypass':
      return `Transfer ${tagOf(a.ups)} from maintenance bypass back to inverter`;
    case 'unplug':
      return `Unplug cord ${tagOf(a.cord)} from circuit ${tagOf(a.circuit)}`;
    case 'rewire':
      switch (a.change.op) {
        case 'refeed':
          return `With ${tagOf(a.change.from)} and ${tagOf(a.change.to)} open and locked out, move the ${tagOf(a.change.device)} feeder from ${tagOf(a.change.from)} to ${tagOf(a.change.to)}`;
        case 'rehome-cord':
          return `Plug cord ${tagOf(a.change.cord)} into circuit ${tagOf(a.change.to)} and close its breaker`;
        case 'add-cord':
          return `Install the ${a.change.side} cord for ${tagOf(a.change.cabinet)} on circuit ${tagOf(a.change.circuit)} and close its breaker`;
      }
  }
}

function stepText(a: SwitchAction, e: StepEffect, customerName: (c: Id<'customer'>) => string): string {
  const parts = [actionWords(a)];
  if (e.deenergized.length) parts.push(`${e.deenergized.map(tagOf).join(', ')} de-energized`);
  if (e.reenergized.length) parts.push(`${e.reenergized.map(tagOf).join(', ')} energized`);
  for (const c of e.customers) parts.push(`${customerName(c.customer)} ${cabinetRange(c.cabinets)} ${sidesLabel(c.before)} → ${sidesLabel(c.after)}${c.certain ? '' : ' (a record is missing)'}`);
  for (const p of e.pools) parts.push(`${UNIT_NAME[p.units]} ${renderSpare(p.before)} → ${renderSpare(p.after)}`);
  if (parts.length === 1) parts.push('no customer feed changes');
  return parts.join(' → ');
}

function refLabel(ref: FactRef): string {
  const [entity, field] = ref.split('#') as [string, string];
  return `${tagOf(entity as AnyId)} ${field}`;
}

// ───────────────────────────── Notice ─────────────────────────────

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));

function notice(
  an: Analysis,
  customer: Id<'customer'>,
  cabinets: readonly Id<'cabinet'>[],
  impact: string,
  order: WorkOrder,
  asOf: LocalDateTime,
  customerName: (c: Id<'customer'>) => string,
): MopNotice {
  const term = noticeTermOf(an, customer);
  const who = `${customerName(customer)} (${cabinetRange(cabinets)}): ${impact}.`;
  const start = order.scheduledStart?.slice(0, 10) ?? null;
  if (!term || !start) {
    return { customer, cabinets, impact, noticeDays: term?.days ?? null, deadline: null, status: 'no-clause', text: `${who} No scheduled-maintenance notice clause on record${start ? '' : ' and no scheduled start'}; notify per site practice.` };
  }
  const deadline = noticeDueBy(start, term.days);
  const today = asOf.slice(0, 10);
  const left = businessDaysBetween(today, start);
  const late = today > deadline;
  const text = late
    ? `${who} Notice of at least ${term.days} business days was due by ${dayLabel(deadline)}; ${left} business day${left === 1 ? ' remains' : 's remain'} before the window. Unless notice went out by then, get written acceptance from the customer or move the work to ${dayLabel(earliestStartAfterNotice(today, term.days))} or later.`
    : `${who} Send notice by ${dayLabel(deadline)} (at least ${term.days} business days before the window).`;
  return { customer, cabinets, impact, noticeDays: term.days, deadline, status: late ? 'deadline-passed' : 'on-time', text };
}

// ───────────────────────────── Approvals ─────────────────────────────

interface ApprovalInput {
  readonly steps: readonly MopStep[];
  readonly order: WorkOrder;
  readonly customerName: (c: Id<'customer'>) => string;
  /** The asset under work when it carries customer load in normal operation. */
  readonly liveAsset: AnyId | null;
  readonly touched: ReadonlyMap<Id<'customer'>, { readonly worst: number }>;
}

/**
 * Who signs, by exposure (docs/research/03 §1, Anvilfield: "grade by exposure and consequence"). Each rule
 * names the condition from this MOP that triggers it; a rule whose condition is absent adds nothing.
 */
const APPROVALS: readonly ((x: ApprovalInput) => string | null)[] = [
  (x) => `Technical review: ${x.order.ownerGroup ?? 'site engineering'} checks each step and expected result against the as-built records.`,
  () => `Operations approval: critical facilities manager confirms the plant's state, staffing and other work in flight for the window.`,
  (x) => (x.order.vendor ? `Vendor procedure: ${x.order.vendor}'s own MOP reviewed against these steps; the vendor works under the site's switching authority.` : null),
  (x) => {
    const live = x.steps.filter((s) => s.effect.customers.length > 0 || s.effect.pools.length > 0 || (x.liveAsset !== null && s.phase === 'work'));
    return live.length ? `Change advisory board: steps ${live.map((s) => s.n).join(', ')} switch equipment carrying live customer load.` : null;
  },
  (x) => {
    const exposed = [...x.touched].filter(([, t]) => t.worst >= 2).map(([c]) => c);
    return exposed.length
      ? `Customer sign-off accepting the exposure: ${exposed.map(x.customerName).join(', ')}.`
      : null;
  },
  (x) => {
    const bare = x.steps.filter((s) => s.effect.customers.some((c) => c.after.length <= 1 && c.before.length > c.after.length));
    return bare.length ? `Two-person rule (challenge and response) on steps ${bare.map((s) => s.n).join(', ')}: customer load is left with no redundancy.` : null;
  },
];

function approvalsFor(x: ApprovalInput): string[] {
  return APPROVALS.map((rule) => rule(x)).filter((l): l is string => l !== null);
}

// ───────────────────────────── Related records ─────────────────────────────

const OPEN_STATUSES = new Set(['WAPPR', 'APPR', 'WSCH', 'WMATL', 'WPCOND', 'INPRG']);

function relatedOpenWork(history: readonly WorkOrder[], ops: readonly PatchOp[], an: Analysis, wonum: string): WorkOrder[] {
  const f = an.facility;
  const ids = new Set<AnyId>();
  for (const op of ops) {
    const touched: AnyId[] = op.op === 'refeed' ? [op.device, op.from, op.to] : op.op === 'rehome-cord' ? [op.cord, op.from, op.to] : [op.cabinet, op.circuit];
    for (const id of touched) {
      ids.add(id);
      const panel = kindOf(id) === 'circuit' ? f.get(id as Id<'circuit'>).panel : null;
      if (panel?.kind === 'known') ids.add(panel.value);
    }
  }
  return history.filter((o) => o.wonum !== wonum && OPEN_STATUSES.has(o.status) && o.asset?.resolved && ids.has(o.asset.entity));
}

function openWorkOnPools(history: readonly WorkOrder[], m: ModelRun, asset: AnyId, wonum: string): WorkOrder[] {
  const pools = [...m.g.loops.values()].flatMap((l) => [l.chillers, l.pumps]).concat([...m.g.halls.values()].map((h) => h.crahs));
  const peers = new Set(pools.filter((ms) => ms.some((x) => x.id === asset)).flatMap((ms) => ms.map((x) => x.id)));
  return history.filter((o) => o.wonum !== wonum && OPEN_STATUSES.has(o.status) && o.asset?.resolved && o.asset.entity !== asset && peers.has(o.asset.entity));
}

function standbyPeers(m: ModelRun, asset: AnyId): AnyId[] {
  const pool = [...m.g.loops.values()].map((l) => l.chillers).find((ms) => ms.some((x) => x.id === asset));
  if (!pool) return [];
  return pool
    .map((x) => x.id)
    .filter((id) => id !== asset && kindOf(id) === 'chiller')
    .filter((id) => {
      const role = m.an.facility.get(id as Id<'chiller'>).role;
      return role.kind === 'known' && role.value === 'standby';
    });
}

const unitsOf = (id: AnyId): CoolingUnits => (kindOf(id) === 'chiller' ? 'chillers' : kindOf(id) === 'pump' ? 'pumps' : 'crahs');

export interface LatestSample {
  readonly value: number;
  readonly at: LocalDateTime;
  readonly label: string;
}

/** The last reading at or before `asOf` among an entity's trend series whose source matches. */
export function latestSample(site: SiteHistory, entity: AnyId, asOf: LocalDateTime, source: RegExp): LatestSample | null {
  let best: LatestSample | null = null;
  for (const s of site.trends) {
    if (s.entity !== entity || !source.test(s.source)) continue;
    for (const x of s.samples) {
      if (x.value === null || x.at > asOf) continue;
      if (!best || x.at > best.at) best = { value: x.value, at: x.at, label: s.label };
    }
  }
  return best;
}

/** The second faults an operator can pick for a replan: the engine's, less per-cabinet cords and circuits. */
export function contingenciesOf(x: Assessed): AnyId[] {
  return [...new Set(x.reasons.flatMap((r) => r.secondFaults))].filter(isEquipment).sort();
}

/** Equipment an operator watches during the window: not the per-cabinet cords and branch circuits. */
const isEquipment = (id: AnyId) => kindOf(id) !== 'cord' && kindOf(id) !== 'circuit';

const fmtF = (f: number) => (Math.round(f * 10) / 10).toFixed(1);

const listOr = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

function cabinetsOf(x: Finding): string {
  return cabinetRange(x.affected.flatMap((i) => i.cabinets));
}
