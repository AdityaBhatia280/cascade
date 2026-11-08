import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis/analysis.js';
import { fixture } from '../testing/fixture.js';
import type { SceneNodeDto } from '../contract.js';

const scene = () => analyze(fixture().facility).scene();
const node = (s: ReturnType<typeof scene>, id: string) => s.nodes.find((n) => n.id === id)!;
const inside = (n: SceneNodeDto, hall: SceneNodeDto) =>
  Math.abs(n.pos3[0] - hall.pos3[0]) <= hall.size3[0] / 2 && Math.abs(n.pos3[2] - hall.pos3[2]) <= hall.size3[2] / 2;

test('cabinets stand on the hall floor in rows, from documented row and slot', () => {
  const s = scene();
  const hall = node(s, 'hall:DH-1');
  assert.deepEqual(hall.size3.slice(0, 1), [20]);
  const cabs = s.nodes.filter((n) => n.kind === 'cabinet');
  for (const c of cabs) {
    assert.ok(inside(c, hall), `${c.id} outside its hall`);
    assert.equal(c.pos3[1] - c.size3[1] / 2, 0);
    assert.equal(c.placed, 'documented');
  }
  const [c11, c12, c21] = ['cabinet:C11', 'cabinet:C12', 'cabinet:C21'].map((id) => node(s, id));
  assert.equal(c11!.pos3[2], c12!.pos3[2]);
  assert.ok(c21!.pos3[2] > c11!.pos3[2]);
  assert.ok(Math.abs(c12!.pos3[0] - c11!.pos3[0] - 0.6) < 1e-9);
});

test('electrical rooms sit behind the hall layered by tier, A left of B; the plant sits beyond it', () => {
  const s = scene();
  const hallDepth = node(s, 'hall:DH-1').size3[2];
  const z = (id: string) => node(s, id).pos3[2];
  for (const id of ['utility:UTIL-1', 'ats:ATS-A', 'switchgear:SWGR-A', 'ups:UPS-A', 'pdu:PDU-A1']) assert.ok(z(id) < 0, `${id} not behind the hall`);
  assert.ok(z('utility:UTIL-1') < z('ats:ATS-A') && z('ats:ATS-A') < z('switchgear:SWGR-A') && z('switchgear:SWGR-A') < z('ups:UPS-A') && z('ups:UPS-A') < z('pdu:PDU-A1'));
  assert.ok(node(s, 'ups:UPS-A').pos3[0] < node(s, 'ups:UPS-B').pos3[0]);
  for (const id of ['chiller:CH-1', 'header:HDR-1', 'loop:CHW-1']) assert.ok(z(id) > hallDepth, `${id} not beyond the hall`);
  for (const id of ['crah:CRAH-1', 'crah:CRAH-2']) assert.ok(inside(node(s, id), node(s, 'hall:DH-1')));
  for (const n of s.nodes) for (let i = 0; i < 3; i++) assert.ok(n.pos3[i]! >= s.bounds3.min[i]! - 1e-9 && n.pos3[i]! <= s.bounds3.max[i]! + 1e-9, `${n.id} outside bounds3`);
});

test('the one-line reads left to right by electrical tier, with A above B', () => {
  const s = scene();
  const x = (id: string) => node(s, id).pos2[0];
  const y = (id: string) => node(s, id).pos2[1];
  assert.ok(x('utility:UTIL-1') < x('ats:ATS-A') && x('ats:ATS-A') < x('switchgear:SWGR-A') && x('switchgear:SWGR-A') < x('ups:UPS-A'));
  assert.ok(x('ups:UPS-A') < x('pdu:PDU-A1') && x('pdu:PDU-A1') < x('circuit:PDU-A1/1') && x('circuit:PDU-A1/1') < x('cabinet:C11'));
  assert.ok(y('ups:UPS-A') < y('ups:UPS-B'));
  assert.equal(node(s, 'hall:DH-1').in2d, false);
  assert.equal(node(s, 'row:ROW-1').in2d, false);
  for (const n of s.nodes.filter((n) => n.in2d)) assert.ok(n.pos2[0] >= s.bounds2.min[0] && n.pos2[0] <= s.bounds2.max[0] && n.pos2[1] >= s.bounds2.min[1] && n.pos2[1] <= s.bounds2.max[1]);
});

test('cords are links (not nodes), drawn from the circuit the model puts them on', () => {
  const s = scene();
  assert.ok(!s.nodes.some((n) => n.kind === 'cord'));
  const c11b = s.links.find((l) => l.id === 'cord:C11/B')!;
  assert.deepEqual([c11b.from, c11b.to, c11b.side], ['circuit:PDU-B1/1', 'cabinet:C11', 'B']);
  const c22b = s.links.filter((l) => l.id.startsWith('cord:C22/B'));
  assert.deepEqual(c22b.map((l) => l.from), ['circuit:PDU-A1/6']);
});

test('x-ray separates A, B and convergence links', () => {
  const s = scene();
  const c12 = s.xray['cabinet:C12']!;
  assert.deepEqual(c12.convergence.includes('ups:UPS-A'), true);
  assert.ok(c12.A.includes('cord:C12/A') && c12.B.includes('cord:C12/B'));
  assert.ok(c12.B.includes('ups:UPS-A->breaker:UPS-A-2'));
  assert.ok(s.xray['cabinet:C22']!.convergence.includes('pdu:PDU-A1'));
  const ids = new Set(s.links.map((l) => l.id));
  for (const x of Object.values(s.xray)) for (const id of [...x.A, ...x.B]) assert.ok(ids.has(id), `xray link ${id} missing`);
});

test('findings and customers overlay their nodes; the scene is deterministic', () => {
  const s = scene();
  assert.ok(node(s, 'ups:UPS-A').findings.includes('ab-convergence:ups:UPS-A'));
  assert.equal(node(s, 'cabinet:C11').customer, 'customer:ACME');
  assert.equal(JSON.stringify(scene()), JSON.stringify(s));
});
