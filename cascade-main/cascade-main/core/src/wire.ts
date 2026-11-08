// Domain → DTO. The one place domain types become JSON. Routes call these; nothing else builds DTOs.
// (The scene is already a DTO by design: it is a pure view projection with no domain-only content.)

import {
  ENTITY_KINDS,
  type AuditDto,
  type CauseDto,
  type CustomerExposureDto,
  type CustomerImpactDto,
  type EntityDto,
  type EntityKind,
  type EntityHistoryDto,
  type FactDto,
  type FixPlanDto,
  type ModelSummaryDto,
  type ModelView,
  type ScenarioResultDto,
  type WorkOrderDto,
  type WorkAssessmentDto,
  type RedundancyDto,
  type PoolLevelDto,
  type FindingDto,
  type HandoffDto,
  type NoticeSetDto,
  type MopDto,
  type MopStepDto,
  type ReplanDto,
} from './contract.js';
import type { CustomerExposure, Explanation, ScenarioResult } from './analysis/analysis.js';
import { findingTitle, type AuditReport, type CustomerImpact, type Finding } from './analysis/audit.js';
import type { FixPlan } from './analysis/planner.js';
import type { Fact } from './facility/fact.js';
import type { Facility } from './facility/facility.js';
import type { FactRef, Id } from './facility/ids.js';
import { kindOf, refParts, tagOf } from './facility/ids.js';
import { displayFact, KINDS, renderIntent, renderTerm } from './facility/kinds.js';
import type { HandoffBrief } from './handoff/handoff.js';
import type { EntityHistory } from './history/history.js';
import type { NoticeSet } from './maintenance/notices.js';
import type { WorkOrder } from './maintenance/work-orders.js';
import { cabinetRange, REASON_GRADE, renderRedundancy, renderSpare, type PoolLevel, type Redundancy, type WorkAssessment } from './maintenance/assessment.js';
import type { Cause } from './physics/supply.js';
import type { Mop, MopStep } from './maintenance/mop.js';
import type { Replan } from './maintenance/replan.js';

const cause = (c: Cause): CauseDto => {
  switch (c.kind) {
    case 'no-supply':
      return { kind: 'no-supply', lost: [...c.lost] };
    case 'lost-redundancy':
      return { kind: 'lost-redundancy', remaining: [...c.remaining] };
    default:
      return { ...c };
  }
};

const factDto = (fact: Fact<unknown>): FactDto => ({ ref: fact.ref, field: refParts(fact.ref).field, display: displayFact(fact) });

function factByRef(f: Facility, ref: FactRef): FactDto | null {
  const fact = f.fact(ref);
  return fact ? factDto(fact) : null;
}

const facts = (f: Facility, refs: readonly FactRef[]) => refs.map((ref) => factByRef(f, ref)).filter((d): d is FactDto => d !== null);

const customerName = (f: Facility, c: Id<'customer'>) => displayFact(f.get(c).name) ?? tagOf(c);

function impactDto(i: CustomerImpact, f: Facility): CustomerImpactDto {
  return { customer: i.customer, customerName: customerName(f, i.customer), cabinets: [...i.cabinets], cabinetsLabel: cabinetRange(i.cabinets), state: i.state, revenueExposedUsd: i.revenueExposed };
}

const redundancy = (r: Redundancy | null): RedundancyDto | null =>
  r === null ? null : r.kind === 'cords' ? { kind: 'cords', sides: [...r.sides], label: renderRedundancy(r) } : { ...r, label: renderRedundancy(r) };

const poolLevel = (p: PoolLevel): PoolLevelDto => ({ ...p, label: `${renderSpare(p.before)} → ${renderSpare(p.after)}` });

function findingDto(x: Finding, f: Facility): FindingDto {
  return {
    id: x.id,
    rule: x.rule,
    severity: x.severity,
    subject: x.subject,
    title: findingTitle(x, f),
    detail: detailDto(x),
    affected: x.affected.map((i) => impactDto(i, f)),
    revenueExposedUsd: x.revenueExposed,
  };
}

const scenarioOf = (events: readonly { readonly how: string; readonly target: string; readonly atMin: number }[]) => events.map((e) => `${e.how}:${e.target}@${e.atMin}`);

function stepDto(s: MopStep, f: Facility): MopStepDto {
  const sides = (x: readonly string[]) => (x.length === 0 ? 'none' : x.join('+'));
  return {
    n: s.n,
    phase: s.phase,
    applied: s.applied,
    text: s.text,
    hold: s.hold,
    state: scenarioOf(s.state),
    deenergized: [...s.effect.deenergized],
    reenergized: [...s.effect.reenergized],
    customers: s.effect.customers.map((c) => ({
      customer: c.customer,
      customerName: customerName(f, c.customer),
      cabinets: [...c.cabinets],
      cabinetsLabel: cabinetRange(c.cabinets),
      before: sides(c.before),
      after: sides(c.after),
    })),
    pools: s.effect.pools.map(poolLevel),
  };
}

/** Flattens a typed finding detail into the wire's string/number/string[] record. */
function detailDto(x: Finding): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(x.detail)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.map(String);
    else if (k === 'intent') out[k] = renderIntent(v as never);
    else if (k === 'term') out[k] = renderTerm(v as never);
  }
  return out;
}

export const toWire = {
  summary(f: Facility, view: ModelView): ModelSummaryDto {
    const counts = Object.fromEntries(ENTITY_KINDS.map((k) => [k, f.list(k).length])) as Record<EntityKind, number>;
    return { site: f.site, revision: f.revision, view, counts };
  },
  fact: factDto,
  entity(e: Explanation, f: Facility): EntityDto {
    const entity = f.get(e.target);
    return { id: e.target, kind: entity.kind, tag: entity.tag, layer: KINDS[entity.kind].layer, facts: e.facts.map(factDto), dependents: [...e.dependents] };
  },
  audit(r: AuditReport, f: Facility): AuditDto {
    return { revision: r.revision, findings: r.findings.map((x) => findingDto(x, f)) };
  },
  scenario(r: ScenarioResult, f: Facility): ScenarioResultDto {
    return {
      revision: r.revision,
      events: r.scenario.events.map((e) => ({ target: e.target, how: e.how, atMin: e.atMin })),
      timeline: r.timeline.map((t) => ({ tMin: t.tMin, entity: t.id, state: t.state, cause: cause(t.cause) })),
      moments: r.moments.map((m) => ({ tMin: m.tMin, customers: m.customers.map((i) => impactDto(i, f)) })),
      revenueExposedUsd: r.revenueExposed,
    };
  },
  exposure(x: readonly CustomerExposure[], f: Facility): CustomerExposureDto[] {
    return x.map((c) => ({
      customer: c.customer,
      name: customerName(f, c.customer),
      cabinets: c.cabinets.map((p) => ({
        id: p.cabinet,
        paths: p.cords.map((cp) => ({ cord: cp.cord, side: cp.derivedSide ?? cp.labelledSide, chain: [...cp.chain] })),
        spofs: [...new Set(p.spofs.filter((s) => s.cause !== 'thermal').map((s) => s.component as string))].sort(),
        redundancy: p.redundancy,
      })),
      terms: c.terms.map(factDto),
      compliance: c.compliance.map((t) => ({ term: renderTerm(t.term), met: t.met, why: t.why })),
      monthlyRevenueUsd: c.monthlyRevenue,
      revenueExposedUsd: c.revenueExposed,
    }));
  },
  plan(p: FixPlan): FixPlanDto {
    return {
      id: p.id,
      base: p.patch.base,
      ops: p.patch.ops.map((o) => ({ ...o })),
      moves: p.moves,
      cleared: [...p.cleared],
      introduced: [...p.introduced],
      minHeadroomKw: p.minHeadroomKw,
      optimal: p.optimal,
      explanation: [...p.explanation],
    };
  },
  workOrder(o: WorkOrder): WorkOrderDto {
    const { asset, assetNum: _inAsset, ...fields } = o;
    return {
      ...fields,
      asset:
        asset === null ? null
        : asset.resolved ? { assetNum: asset.assetNum, resolved: true, entity: asset.entity, tag: tagOf(asset.entity) }
        : { assetNum: asset.assetNum, resolved: false, why: asset.why },
    };
  },
  assessment(x: WorkAssessment, f: Facility): WorkAssessmentDto {
    const workOrder = toWire.workOrder(x.workOrder);
    if (!x.assessed) return { workOrder, assessed: false, why: x.why };
    return {
      workOrder,
      assessed: true,
      grade: x.grade,
      headline: x.headline,
      asset: x.work.asset,
      says: x.work.says,
      scenario: scenarioOf(x.work.events),
      pools: x.pools.map(poolLevel),
      plant: [...x.plant],
      reasons: x.reasons.map((r) => ({
        kind: r.kind,
        grade: REASON_GRADE[r.kind],
        text: r.text,
        customers: r.customers.map((c) => ({
          customer: c.customer,
          customerName: customerName(f, c.customer),
          cabinets: [...c.cabinets],
          cabinetsLabel: cabinetRange(c.cabinets),
          before: redundancy(c.before),
          after: redundancy(c.after),
          revenueExposedUsd: c.revenueExposed,
          promise: c.promise ? factByRef(f, c.promise) : null,
        })),
        revenueExposedUsd: r.revenueExposed,
        secondFaults: [...r.secondFaults],
        standingFaults: [...r.standingFaults],
        pools: r.pools.map(poolLevel),
        sharedFeeds: r.sharedFeeds.map((s) => ({ unit: s.unit, feed: s.feed, facts: facts(f, s.refs) })),
        contradictions: r.contradictions.map((c) => ({
          entity: c.entity,
          fedFrom: c.fedFrom,
          labelledSide: c.labelledSide,
          tracedSide: c.tracedSide,
          label: factByRef(f, c.label)!,
          trace: facts(f, c.trace),
          workOrders: c.workOrders.map(toWire.workOrder),
        })),
      })),
    };
  },
  mop(m: Mop, f: Facility): MopDto {
    return {
      wonum: m.workOrder.wonum,
      title: m.title,
      asOf: m.asOf,
      revision: f.revision,
      grade: m.assessment.grade,
      preparedGrade: m.prepared?.grade ?? null,
      prerequisite: m.prerequisite ? { ops: m.prerequisite.patch.ops.map((o) => ({ ...o })), clears: [...m.prerequisite.clears] } : null,
      header: [...m.header],
      approvals: [...m.approvals],
      scope: [...m.scope],
      affected: [...m.affected],
      notifications: m.notifications.map((n) => ({
        customer: n.customer,
        customerName: customerName(f, n.customer),
        cabinets: [...n.cabinets],
        cabinetsLabel: cabinetRange(n.cabinets),
        impact: n.impact,
        noticeDays: n.noticeDays,
        deadline: n.deadline,
        status: n.status,
        text: n.text,
      })),
      prechecks: [...m.prechecks],
      steps: m.steps.map((s) => stepDto(s, f)),
      stopConditions: [...m.stopConditions],
      backout: m.backout.map((s) => stepDto(s, f)),
      verification: [...m.verification],
      contingencies: m.contingencies.map((id) => ({ id, tag: tagOf(id), kind: kindOf(id) })),
    };
  },
  replan(r: Replan): ReplanDto {
    const c = r.countdown;
    return {
      wonum: r.workOrder.wonum,
      fault: r.fault,
      headline: r.headline,
      scenario: scenarioOf(r.events),
      countdown: c
        ? {
            hall: c.hall, heatKw: c.heatKw, limitF: c.limitF, startF: c.startF, startLabel: c.startLabel, startAt: c.startAt,
            phases: c.phases.map((x) => ({ label: x.label, coolingKw: x.coolingKw, deficitKw: x.deficitKw, minutes: x.countdown.minutes, low: x.countdown.low, high: x.countdown.high })),
          }
        : null,
      affected: [...r.affected],
      actions: [...r.actions],
      parameters: r.parameters.map((x) => ({ name: x.name, value: x.value, basis: x.basis, source: x.source })),
    };
  },
  history(h: EntityHistory): EntityHistoryDto {
    return {
      entity: h.entity,
      from: h.window.from,
      to: h.window.to,
      timeline: h.timeline.map((t) =>
        t.kind === 'event'
          ? { kind: 'event', at: t.at, entity: t.entity, event: { ...t.event } }
          : { kind: 'work-order', at: t.at, entity: t.entity, workOrder: toWire.workOrder(t.workOrder) },
      ),
      trends: h.trends.map((s) => ({ system: s.system, source: s.source, label: s.label, unit: s.unit, entity: s.entity, samples: s.samples.map((x) => ({ at: x.at, value: x.value })) })),
    };
  },
  notices(wonum: string, set: NoticeSet, f: Facility): NoticeSetDto {
    if (!set.assessed) return { wonum, assessed: false, why: set.why };
    return {
      wonum,
      assessed: true,
      notices: set.notices.map((n) => ({
        id: n.id,
        wonum: n.workOrder.wonum,
        customer: n.customer,
        customerName: n.customerName,
        effects: n.effects.map((e) => ({ kind: e.kind, cabinets: [...e.cabinets], cabinetsLabel: cabinetRange(e.cabinets), line: e.line })),
        blocked: n.blocked && { reason: n.blocked.reason, workOrders: n.blocked.workOrders.map(toWire.workOrder) },
        period: n.period && { requiredBusinessDays: n.period.requiredBusinessDays, givenBusinessDays: n.period.givenBusinessDays, clause: factByRef(f, n.period.clause)! },
        issuedOn: n.issuedOn,
        subject: n.subject,
        body: n.body,
        contentHash: n.contentHash,
      })),
    };
  },
  handoff(b: HandoffBrief, f: Facility): HandoffDto {
    return {
      at: b.at,
      since: b.since,
      until: b.until,
      work: b.work.map((x) => ({ when: x.when, assessment: toWire.assessment(x.assessment, f) })),
      lostRedundancy: b.lostRedundancy.map((x) => ({ finding: findingDto(x.finding, f), openWork: x.openWork.map(toWire.workOrder) })),
      alarms: {
        recent: b.alarms.recent.map((e) => ({ ...e })),
        standing: b.alarms.standing.map((e) => ({ ...e })),
        coverage: b.alarms.coverage.map((c) => ({ ...c })),
      },
      waiting: b.waiting.map(toWire.workOrder),
      watch: b.watch.map((x) =>
        x.kind === 'limit'
          ? { kind: 'limit', limit: { ...x.limit } }
          : { kind: 'during-work', wonum: x.workOrder.wonum, scheduledStart: x.workOrder.scheduledStart, scheduledFinish: x.workOrder.scheduledFinish, text: x.text, faults: [...x.faults] },
      ),
      calls: b.calls.map((c) => ({ workOrder: toWire.workOrder(c.workOrder), vendor: c.vendor, lead: c.lead, ownerGroup: c.ownerGroup })),
      subject: b.subject,
      text: b.text,
      contentHash: b.contentHash,
    };
  },
} as const;
