// Accuracy against the DFW1 seed's planted ground truth. The ground-truth file is read by this test
// only (never by the app). Every number printed here is computed from the documents by the engine.
// Its planted disagreements now resolve by source precedence, so the D03/B one becomes a finding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyze } from './analysis/analysis.js';
import { findingEntities, type Finding } from './analysis/audit.js';
import { assemble, type CompletedChange } from './facility/assemble.js';
import { siteId, type FactRef } from './facility/ids.js';
import type { PatchOp } from './facility/patch.js';
import { normalizeTag } from './ingest/sources.js';
import { DFW1_DIR, loadDfw1 } from './testing/dfw1.js';
import type { RiskGrade } from './contract.js';
import { assessWorkOrders } from './maintenance/assessment.js';
import { upcomingWorkOrders, workOrdersOf } from './maintenance/work-orders.js';

interface Subject { readonly kind: string; readonly tag: string }
interface PlannedFix { readonly op: 'add-cord' | 'rehome-cord' | 'refeed' | null; readonly onto: readonly Subject[] }
interface GroundTruth {
  readonly defects: readonly { id: string; rule: string; subjects: readonly Subject[]; consequential: readonly { rule: string; subject: Subject }[]; fix: PlannedFix }[];
  readonly conflicts: readonly { id: string; entity: Subject; field: string; sources: readonly { doc: string; value: unknown }[] }[];
  readonly decoys: readonly { id: string; looksLike: string; subjects: readonly Subject[] }[];
  readonly workOrders: { readonly exportedAt: string; readonly week: readonly { wonum: string; expectedGrade: RiskGrade; why: string }[] };
}

const truth = JSON.parse(readFileSync(path.join(DFW1_DIR, 'ground_truth.json'), 'utf8')) as GroundTruth;
const idOf = (s: Subject) => `${s.kind}:${normalizeTag(s.tag)}`;
const docs = loadDfw1();
const built = (completed: CompletedChange[]) => assemble({ site: siteId('dfw1'), statements: docs.statements, completed });
const { facility, issues } = built([]);
const an = analyze(facility);
const findings = an.audit().findings;
// The D03/B disagreement resolves to the BMS (RPP-3A/26), which puts both D03 cords on RPP-3A.
const D03 = 'ab-convergence:rpp:RPP-3A' as Finding['id'];

const matches = (x: Finding, rule: string, subjects: readonly Subject[]) => x.rule === rule && subjects.some((s) => findingEntities(x).includes(idOf(s) as never));

test('DFW1 parses and assembles cleanly', () => {
  assert.deepEqual(docs.unparsed, []);
  assert.deepEqual(issues, []);
});

test('DFW1: every planted disagreement resolves to the BMS value, live measurement over paperwork', () => {
  for (const c of truth.conflicts) {
    const fact = facility.fact(`${idOf(c.entity)}#${c.field}` as FactRef);
    const bms = c.sources.find((s) => s.doc === 'docs/bms_points.json')!;
    assert.equal(fact?.kind, 'known', c.id);
    const value = fact!.kind === 'known' ? fact!.value : null;
    assert.deepEqual(value, typeof bms.value === 'string' ? `circuit:${normalizeTag(bms.value)}` : bms.value, c.id);
  }
});

test('DFW1 accuracy: planted defects found, decoys not flagged', () => {
  const matched = new Set<string>();
  const report: string[] = [];
  let found = 0;
  for (const d of truth.defects) {
    const hits = findings.filter((x) => matches(x, d.rule, d.subjects));
    hits.forEach((x) => matched.add(x.id));
    if (hits.length) found++;
    report.push(`${hits.length ? 'FOUND ' : 'MISSED'} ${d.id}: ${hits.map((x) => `${x.id} [${x.certainty}]`).join(', ') || '-'}`);
    for (const c of d.consequential) {
      const ch = findings.filter((x) => x.rule === c.rule && x.subject === idOf(c.subject));
      ch.forEach((x) => matched.add(x.id));
      report.push(`  ${ch.length ? 'found ' : 'missed'} consequence ${c.rule} ${c.subject.tag}`);
    }
  }
  const falseFlags: string[] = [];
  for (const d of truth.decoys) {
    const flagged =
      d.looksLike === 'conflict'
        ? d.subjects.filter((s) => facility.parseId(idOf(s)) === null).map(idOf)
        : findings.filter((x) => matches(x, d.looksLike, d.subjects)).map((x) => x.id);
    if (flagged.length) falseFlags.push(`${d.id}: ${flagged.join(', ')}`);
    report.push(`${flagged.length ? 'FALSE FLAG' : 'clean     '} decoy ${d.id}`);
  }
  const extra = findings.filter((x) => !matched.has(x.id) && x.id !== D03);
  const consequences = truth.defects.flatMap((d) => d.consequential).length;
  const consequencesFound = truth.defects.flatMap((d) => d.consequential).filter((c) => findings.some((x) => x.rule === c.rule && x.subject === idOf(c.subject))).length;
  report.push(
    `defects ${found}/${truth.defects.length} (recall ${(found / truth.defects.length).toFixed(2)}), consequences ${consequencesFound}/${consequences}`,
    `findings ${findings.length}: ${matched.size} matched, D03 convergence from the BMS reading, ${extra.length} unexplained${extra.length ? ` (${extra.map((x) => x.id).join(', ')})` : ''}`,
    `precision ${((matched.size + 1) / findings.length).toFixed(2)}; decoys falsely flagged ${falseFlags.length}/${truth.decoys.length}`,
  );
  console.log(['DFW1 accuracy', ...report].join('\n  '));
  assert.equal(found, truth.defects.length);
  assert.deepEqual(falseFlags, []);
  assert.deepEqual(extra.map((x) => x.id), []);
  assert.ok(findings.some((x) => x.id === D03 && x.certainty === 'definite'));
  // The loop defect by its own finding: CHW-LOOP-1 as the point all eight DH-1 CRAHs share.
  const loop = findings.find((x) => x.id === 'cooling-common-cause:hall:DH-1:loop:CHW-LOOP-1');
  assert.ok(loop?.rule === 'cooling-common-cause' && loop.certainty === 'definite' && loop.detail.members.length === 8);
});

test('DFW1 fix plan re-feeds the Halcyon B panel and re-verifies clean', () => {
  const plans = an.planFixes({ clear: 'all-fixable', maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'], alternatives: 2 });
  const [best] = plans;
  assert.ok(best);
  console.log(`DFW1 best plan: ${best.explanation.join(' | ')}`);
  for (const p of plans) console.log(`DFW1 plan ${p.id} (${p.moves} moves): cleared [${p.cleared.join(', ')}] introduced [${p.introduced.join(', ')}]`);
  assert.deepEqual(best.introduced, []);
  const halcyon = truth.defects.find((d) => d.id === 'ab-convergence-halcyon')!;
  const spare = idOf(halcyon.fix.onto[0]!);
  assert.ok(
    best.patch.ops.some((o) => o.op === 'refeed' && o.device === 'rpp:RPP-4B' && o.to === spare),
    `best plan does not re-feed RPP-4B from ${spare}`,
  );
  assert.ok(best.cleared.includes('ab-convergence:pdu:PDU-3A' as never));
});

// The roster's circuit for D03/B. It carries no cord once the BMS places that cord on RPP-3A/26, so the model counts it as a spare.
const FREED = 'circuit:RPP-3B/13';
const landing = (o: PatchOp): string => (o.op === 'add-cord' ? o.circuit : o.op === 'rehome-cord' || o.op === 'refeed' ? o.to : '');

test('DFW1 planner: each fixable defect gets a verified plan onto its documented spare, the rest get none', () => {
  const report: string[] = [];
  for (const d of truth.defects) {
    const targets = findings.filter((x) => x.certainty === 'definite' && matches(x, d.rule, d.subjects)).map((x) => x.id);
    assert.ok(targets.length > 0, `${d.id}: no definite finding to plan against`);
    const plans = an.planFixes({ clear: targets, maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'], alternatives: 3 });
    const clearing = plans.filter((p) => targets.every((t) => p.cleared.includes(t)));
    report.push(`${clearing.length ? 'PLANNED' : 'no plan'} ${d.id}${d.fix.op ? '' : ' (expected none)'}`);
    for (const p of clearing) {
      report.push(`  ${p.patch.ops.map((o) => `${o.op}->${landing(o)}`).join('; ')}: cleared [${p.cleared.join(', ')}] introduced [${p.introduced.join(', ')}]`);
    }
    if (!d.fix.op) {
      assert.equal(clearing.length, 0, `${d.id}: expected no plan`);
      continue;
    }
    assert.ok(clearing.length > 0, `${d.id}: expected a verified plan`);
    const onto = new Set([...d.fix.onto.map(idOf), FREED]);
    for (const p of clearing) assert.deepEqual(p.introduced, [], `${d.id}: ${p.id} introduces findings`);
    assert.ok(clearing[0]!.patch.ops.every((o) => o.op === d.fix.op && onto.has(landing(o))), `${d.id}: best plan does not land on the documented spares`);
  }
  console.log(['DFW1 planner coverage', ...report].join('\n  '));
});

test('DFW1 planner: asking for one alternative still returns the plan that three alternatives find', () => {
  const goal = { clear: ['single-corded:cabinet:D06' as Finding['id']], maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'] as const };
  const three = an.planFixes({ ...goal, alternatives: 3 });
  const one = an.planFixes({ ...goal, alternatives: 1 });
  assert.ok(three.length > 0, 'D06 has a verified plan');
  assert.equal(one.length, 1);
  assert.equal(one[0]!.id, three[0]!.id);
});

const allMoves = { maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'] as PatchOp['op'][], alternatives: 3 };

test('DFW1 planner: D03 alone gets a verified cord move onto a spare', () => {
  const { plans, unplanned } = an.planOutcome({ ...allMoves, clear: [D03] });
  assert.ok(plans.length > 0);
  for (const p of plans) {
    assert.ok(p.cleared.includes(D03));
    assert.deepEqual(p.introduced, []);
    assert.ok(p.patch.ops.every((o) => o.op === 'rehome-cord' && o.cord.startsWith('cord:D03/')));
  }
  assert.deepEqual(unplanned, []);
});

test('DFW1 planner: all-fixable clears the best fixable subset when targets compete for the move budget', () => {
  const { plans, unplanned } = an.planOutcome({ ...allMoves, clear: 'all-fixable' });
  for (const p of plans) console.log(`DFW1 all-fixable with D03 converged: ${p.patch.ops.map((o) => `${o.op}->${landing(o)}`).join('; ')} cleared [${p.cleared.join(', ')}]`);
  assert.ok(plans.length > 0, 'all-fixable must not fail as a whole');
  for (const p of plans) assert.deepEqual(p.introduced, []);
  assert.ok(plans[0]!.cleared.some((id) => id.startsWith('ab-convergence:pdu:PDU-3A')));
  assert.ok(plans.some((p) => p.cleared.includes(D03)), 'some alternative spends a B spare on D03');
  assert.deepEqual(
    unplanned.map((u) => [u.finding, u.reason]),
    [['failover-overload:pdu:PDU-2A', 'not-in-plan'], ['single-corded:cabinet:B08', 'no-move']],
  );
});

test("DFW1 work orders: the engine grades each of this week's work orders as the ground truth expects", () => {
  const all = workOrdersOf(docs.documents, facility);
  const graded = new Map(assessWorkOrders(an, upcomingWorkOrders(all, truth.workOrders.exportedAt), all).map((x) => [x.workOrder.wonum, x.assessed ? x.grade : null]));
  for (const w of truth.workOrders.week) assert.equal(graded.get(w.wonum), w.expectedGrade, `${w.wonum}: ${w.why}`);
});

test('DFW1 scenario: PDU-3A maintenance prices dark and backup cabinets apart, per customer', () => {
  const r = an.whatIf({ events: [{ target: 'pdu:PDU-3A' as never, how: 'maintenance', atMin: 0 }] });
  const end = r.moments.at(-1)!.customers;
  const sum = (states: readonly string[]) => end.filter((c) => states.includes(c.state)).reduce((s, c) => s + c.revenueExposed, 0);
  assert.equal(sum(['down', 'unknown']), 10550);
  assert.equal(sum(['exposed']), 20075);
  assert.equal(r.revenueExposed, 30625);
  const owner = end.find((c) => c.cabinets.includes('cabinet:D03' as never))!.customer;
  const trinity = end.filter((c) => c.customer === owner);
  assert.deepEqual(
    trinity.map((c) => [c.state, c.cabinets.length, c.revenueExposed]),
    [['down', 2, 2700], ['exposed', 8, 10800]],
  );
});
