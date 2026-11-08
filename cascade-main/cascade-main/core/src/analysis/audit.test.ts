import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_IDS } from '../contract.js';
import { BASE, BMS, fixture, setRow, type Row } from '../testing/fixture.js';
import { analyze } from './analysis.js';
import type { Finding } from './audit.js';

const audit = (rows: readonly Row[] = BASE, bms: readonly Row[] = BMS) => {
  const { facility } = fixture(rows, bms);
  const an = analyze(facility);
  return { an, facility, findings: an.audit().findings, byId: (id: string) => an.audit().findings.find((x) => x.id === id) };
};
/** C22's B cord with no documented circuit: whatever hinges on it is contingent. */
const NO_C22_B = setRow(BASE, 'cord', 'C22/B', 'circuit', null);
const of = <R extends Finding['rule']>(fs: readonly Finding[], rule: R) => fs.filter((x): x is Extract<Finding, { rule: R }> => x.rule === rule);

test('a finding is contingent exactly when it hinges on a missing fact that exists in the model', () => {
  const { findings, facility } = audit(NO_C22_B, []);
  assert.ok(findings.length > 0);
  for (const x of findings) {
    for (const r of x.contingentOn) assert.equal(facility.fact(r)?.kind, 'missing', `${x.id}: ${r}`);
    assert.equal(x.certainty === 'contingent', x.contingentOn.length > 0);
  }
});

test('single-corded: one cord, with its circuit and the roster facts behind it', () => {
  const sc = of(audit().findings, 'single-corded');
  assert.deepEqual(sc.map((x) => x.id), ['single-corded:cabinet:C21']);
  assert.equal(sc[0]!.detail.circuit, 'circuit:PDU-A1/4');
});

test('A/B convergence on a shared upstream device is found at the most downstream shared point', () => {
  const { byId } = audit();
  const x = byId('ab-convergence:ups:UPS-A');
  assert.ok(x && x.rule === 'ab-convergence');
  assert.deepEqual(x.detail.cabinets, ['cabinet:C12', 'cabinet:C13']);
  assert.equal(x.certainty, 'definite');
  assert.deepEqual(x.affected.map((i) => i.customer).sort(), ['customer:ACME', 'customer:GLOBEX']);
});

test('the BMS placing both C22 cords on PDU-A1 makes a definite convergence', () => {
  const x = audit().byId('ab-convergence:pdu:PDU-A1');
  assert.ok(x && x.rule === 'ab-convergence');
  assert.deepEqual(x.detail.cabinets, ['cabinet:C22']);
  assert.equal(x.certainty, 'definite');
  assert.equal(audit(BASE, []).byId('ab-convergence:pdu:PDU-A1'), undefined);
});

test('a convergence that hinges on a missing cord circuit is contingent on exactly that fact', () => {
  const x = of(audit(NO_C22_B, []).findings, 'ab-convergence').find((f) => f.detail.cabinets.includes('cabinet:C22' as never));
  assert.ok(x);
  assert.equal(x.certainty, 'contingent');
  assert.deepEqual(x.contingentOn, ['cord:C22/B#circuit']);
});

test('failover overload is a capacity single point of failure', () => {
  const { findings } = audit(setRow(BASE, 'ups', 'UPS-B', 'rating', '8 kW'), []);
  const fo = of(findings, 'failover-overload');
  assert.equal(fo.length, 1);
  assert.equal(fo[0]!.detail.overloaded, 'ups:UPS-B');
  // Losing the A side leaves UPS-B carrying C11 and C22 whole (6 kW each, on the register's B cords); C12, C13 and C21 have no B path off UPS-B.
  assert.deepEqual([fo[0]!.detail.loadKw, fo[0]!.detail.ratedKw], [12, 8]);
  assert.equal(of(audit().findings, 'failover-overload').length, 0);
});

test('cooling N+1 is derived from capacity, not unit count', () => {
  // 3 × 10 kW CRAHs against 30 kW of heat: three units, but none can be lost.
  const small = ['CRAH-1', 'CRAH-2', 'CRAH-3'].reduce((acc, c) => setRow(acc, 'crah', c, 'capacityKw', '10'), BASE as readonly Row[]);
  const cc = of(audit(small).findings, 'cooling-capacity');
  assert.equal(cc.length, 1);
  assert.equal(cc[0]!.detail.pool, 'hall:DH-1');
  assert.equal(cc[0]!.detail.sparesActual, 0);
  assert.equal(cc[0]!.detail.demandKw, 30);
  assert.deepEqual(cc[0]!.detail.intent, { scheme: 'N+K', k: 1 });
  assert.equal(of(audit().findings, 'cooling-capacity').length, 0);
});

test('redundant cooling units sharing one breaker are a common cause', () => {
  // 3 × 20 kW: N+1 by capacity (40 ≥ 30), but CRAH-1 and CRAH-3 share SWGR-A-M (20 < 30).
  const rows = ['CRAH-1', 'CRAH-2', 'CRAH-3'].reduce((acc, c) => setRow(acc, 'crah', c, 'capacityKw', '20'), BASE as readonly Row[]);
  const { findings } = audit(rows);
  const ccc = of(findings, 'cooling-common-cause');
  assert.deepEqual(ccc.map((x) => x.detail.sharedPoint), ['breaker:SWGR-A-M']);
  assert.deepEqual([...ccc[0]!.detail.members].sort(), ['crah:CRAH-1', 'crah:CRAH-3']);
  assert.equal(of(findings, 'cooling-capacity').length, 0);
  assert.ok(of(findings, 'contract-topology-mismatch').some((x) => x.detail.actual === 'no-cooling-spare'));
});

test('contracts promising A+B are checked against topology', () => {
  const ct = of(audit().findings, 'contract-topology-mismatch');
  const acme = ct.find((x) => x.subject === 'contract:MSA-ACME')!;
  assert.deepEqual(acme.detail.cabinets, ['cabinet:C12']);
  assert.equal(acme.detail.actual, 'converged');
  assert.ok(!ct.some((x) => x.subject === 'contract:MSA-INITECH'));
});

test('circuit overcommit uses the full committed load a cord carries on failover', () => {
  const rows: Row[] = [...BASE, ['contract', 'MSA-ACME', 'terms', 'C11 9 kW', { term: 'committed-kw', cabinet: 'C11', kw: 9 }]];
  const oc = of(audit(rows).findings, 'circuit-overcommit');
  // 30 A × 208 V × √3 × 0.95 pf = 10.27 kW nameplate, 8.21 kW continuous.
  assert.deepEqual(oc.map((x) => x.detail.circuit).sort(), ['circuit:PDU-A1/1', 'circuit:PDU-B1/1']);
  assert.equal(oc[0]!.detail.ratedKw, 8.21);
  assert.equal(of(audit().findings, 'circuit-overcommit').length, 0);
});

test('every rule id is a registered rule and audit output is deterministic', () => {
  const { facility } = fixture();
  assert.deepEqual(analyze(facility).audit(), analyze(facility).audit());
  const rules = new Set(audit().findings.map((x) => x.rule));
  for (const r of rules) assert.ok(RULE_IDS.includes(r));
});

test('the planner finds the minimal moves, and verify confirms by a full re-audit', () => {
  const { an } = audit(NO_C22_B, []);
  const plans = an.planFixes({ clear: 'all-fixable', maxMoves: 6, allow: ['rehome-cord', 'add-cord', 'refeed'], alternatives: 3 });
  assert.ok(plans.length > 0);
  const best = plans[0]!;
  assert.equal(best.moves, 2);
  assert.deepEqual(best.patch.ops.map((o) => o.op).sort(), ['add-cord', 'refeed']);
  const refeed = best.patch.ops.find((o) => o.op === 'refeed')!;
  assert.deepEqual(refeed, { op: 'refeed', device: 'rpp:RPP-B2', from: 'breaker:UPS-A-2', to: 'breaker:UPS-B-2' });
  for (const id of ['ab-convergence:ups:UPS-A', 'single-corded:cabinet:C21', 'contract-topology-mismatch:contract:MSA-ACME:terms/power-redundancy']) assert.ok(best.cleared.includes(id as never), id);
  assert.deepEqual(best.introduced, []);
  assert.deepEqual(best.missingFacts, ['cord:C22/B#circuit']);
  const v = an.verify(best.patch, 'check');
  assert.ok(v.ok && v.delta);
  assert.deepEqual(v.delta.introduced, []);
  assert.deepEqual([...v.delta.cleared], [...best.cleared]);
  assert.equal(of(v.after!.audit().findings, 'ab-convergence').filter((x) => x.certainty === 'definite').length, 0);
});

test('the planner can fix convergence by moving cords when refeeds are not allowed', () => {
  const { an } = audit(BASE, []);
  const [p] = an.planFixes({ clear: ['ab-convergence:ups:UPS-A' as never], maxMoves: 4, allow: ['rehome-cord'], alternatives: 1 });
  assert.ok(p);
  assert.equal(p.moves, 2);
  assert.ok(p.patch.ops.every((o) => o.op === 'rehome-cord'));
  assert.ok(p.cleared.includes('ab-convergence:ups:UPS-A' as never));
});
