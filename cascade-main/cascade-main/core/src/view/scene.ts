// Scene derivation: Analysis → SceneDto, consumed unchanged by the 3D view (R3F) and the 2D one-line
// view. Computed in core because placement depends on deep model semantics (topology-derived side,
// electrical tier, cooling pools) that the frontend would otherwise re-implement; the agent and the
// UI then share ids and x-ray paths. Pure and deterministic: every iteration is id-sorted.
//
// 3D (metres, y up, floor y = 0): halls side by side along +x with rows of cabinets on a floor grid;
// the electrical rooms sit behind the halls (z < 0), layered by electrical tier (sources farthest,
// PDUs nearest), A side on the left, B on the right; breakers and circuits sit on their bus/panel;
// the cooling plant sits beyond the halls (z > depth); CRAHs line the hall side walls.
// 2D one-line (pixels): left → right by electrical tier, lanes A (top) / shared / B (bottom),
// crossings reduced by barycenter sweeps; cabinets grouped by customer in wrapped columns sized for
// a ~16:10 canvas; the cooling plant in a band below.

import type { Layer, SceneDto, SceneLinkDto, SceneNodeDto, Side, Vec2, Vec3 } from '../contract.js';
import type { Analysis } from '../analysis/analysis.js';
import { derivedSideOf, internalsOf, powerChain } from '../analysis/analysis.js';
import { findingEntities } from '../analysis/audit.js';
import type { Entity, Placement } from '../facility/entities.js';
import { entitiesOf } from '../facility/facility.js';
import type { Fact } from '../facility/fact.js';
import type { AnyId, Id } from '../facility/ids.js';
import { kindOf } from '../facility/ids.js';
import { KINDS } from '../facility/kinds.js';
import { isPowerRole, type SupplyEdge, type SupplyRule } from '../physics/supply.js';

const CAB_W = 0.6;
const CAB_D = 1.2;
const ROW_PITCH = CAB_D + 1.2;
const MARGIN = 2;
const GALLERY = 2;
const HALL_GAP = 6;
const TRAY_Y = 3.2;
const FLOOR_Y = -0.4;
const COL = 220;
const PITCH = 48;
const LANE_GAP = 72;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const v3 = (x: number, y: number, z: number): Vec3 => [r3(x), r3(y), r3(z)];
const v2 = (x: number, y: number): Vec2 => [Math.round(x), Math.round(y)];
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface Box {
  pos: Vec3;
  size: Vec3;
  placed: SceneNodeDto['placed'];
}

export function deriveScene(an: Analysis): SceneDto {
  const f = an.facility;
  const { graph: g } = internalsOf(an);
  const audit = an.audit();
  const known = <T>(fact: Fact<T>): T | null => (fact.kind === 'known' ? fact.value : null);
  const entities = entitiesOf(f).filter((e) => e.kind !== 'cord');

  // ── Derived side per node (nearest labelled UPS, else switchgear, on its power chain).
  const sideMemo = new Map<AnyId, Side | null>();
  const sideOf = (id: AnyId): Side | null => {
    if (sideMemo.has(id)) return sideMemo.get(id)!;
    const kind = kindOf(id);
    let side: Side | null = null;
    if (kind === 'ups' || kind === 'switchgear') side = g.sideLabel.get(id) ?? derivedSideOf(g, powerChain(g, id));
    else if (kind === 'cabinet' || kind === 'customer' || kind === 'contract' || kind === 'hall' || kind === 'row' || kind === 'loop' || kind === 'header') side = null;
    else {
      const s = g.nodes.get(id)?.supply;
      const start = s?.rule === 'cooling-member' ? s.power.to : [id];
      const sides = new Set(start.map((x) => derivedSideOf(g, powerChain(g, x))));
      side = sides.size === 1 ? [...sides][0]! : null;
    }
    sideMemo.set(id, side);
    return side;
  };

  // ── Electrical tiers: longest path from a source over power edges (cycle-safe).
  const tierMemo = new Map<AnyId, number>();
  const onStack = new Set<AnyId>();
  const tierOf = (id: AnyId): number => {
    const hit = tierMemo.get(id);
    if (hit !== undefined) return hit;
    if (onStack.has(id)) return 0;
    onStack.add(id);
    let t = 0;
    for (const { role, edge } of g.nodes.get(id)?.upstream ?? []) if (isPowerRole(role)) for (const p of edge.to) t = Math.max(t, tierOf(p) + 1);
    onStack.delete(id);
    tierMemo.set(id, t);
    return t;
  };
  const PHYSICAL = new Set(['utility', 'generator', 'ats', 'switchgear', 'ups', 'pdu', 'rpp']);
  const physMemo = new Map<AnyId, number>();
  const physTier = (id: AnyId, stack = new Set<AnyId>()): number => {
    const hit = physMemo.get(id);
    if (hit !== undefined) return hit;
    if (stack.has(id)) return 0;
    stack.add(id);
    let t = 0;
    for (const { role, edge } of g.nodes.get(id)?.upstream ?? []) {
      if (!isPowerRole(role)) continue;
      for (const p of edge.to) t = Math.max(t, physTier(p, stack) + (PHYSICAL.has(kindOf(p)) ? 1 : 0));
    }
    stack.delete(id);
    physMemo.set(id, t);
    return t;
  };

  // ── 3D: halls, rows, cabinets.
  const boxes = new Map<AnyId, Box>();
  const halls = f.list('hall');
  const rowsByHall = new Map<AnyId, Entity[]>();
  const unassignedRows: Entity[] = [];
  for (const row of f.list('row')) {
    const h = known(row.hall);
    if (h) {
      let l = rowsByHall.get(h);
      if (!l) rowsByHall.set(h, (l = []));
      l.push(row);
    } else unassignedRows.push(row);
  }
  const cabsByRow = new Map<AnyId, Extract<Entity, { kind: 'cabinet' }>[]>();
  const unplacedCabs: Extract<Entity, { kind: 'cabinet' }>[] = [];
  for (const cab of f.list('cabinet')) {
    const row = known(cab.row);
    const slot = known(cab.slot);
    if (row && slot !== null && known(f.get(row).hall)) {
      let l = cabsByRow.get(row);
      if (!l) cabsByRow.set(row, (l = []));
      l.push(cab);
    } else unplacedCabs.push(cab);
  }
  const minSlot = Math.min(1, ...f.list('cabinet').map((c) => known(c.slot) ?? 1));
  const slotX = (slot: number) => (slot - minSlot) * CAB_W;
  const hallOrigin = new Map<AnyId, { x: number; w: number; d: number }>();
  let cursorX = 0;
  let maxDepth = 8;
  const rowZ = new Map<AnyId, number>();
  for (const hall of halls) {
    const rows = (rowsByHall.get(hall.id) ?? []).sort((a, b) => {
      const ia = known((a as Extract<Entity, { kind: 'row' }>).index);
      const ib = known((b as Extract<Entity, { kind: 'row' }>).index);
      return ia !== null && ib !== null && ia !== ib ? ia - ib : byId(a, b);
    });
    const maxSlotX = Math.max(0, ...rows.flatMap((r) => (cabsByRow.get(r.id) ?? []).map((c) => slotX(known(c.slot)!) + CAB_W)));
    const dims = known(hall.dimensionsM);
    const needW = 2 * MARGIN + 2 * GALLERY + maxSlotX;
    const needD = 2 * MARGIN + Math.max(1, rows.length) * ROW_PITCH;
    const w = Math.max(dims?.width ?? 0, needW, 10);
    const d = Math.max(dims?.depth ?? 0, needD, 8);
    hallOrigin.set(hall.id, { x: cursorX, w, d });
    boxes.set(hall.id, { pos: v3(cursorX + w / 2, 0, d / 2), size: v3(w, 0.1, d), placed: dims ? 'documented' : 'generated' });
    const x0 = cursorX + MARGIN + GALLERY;
    rows.forEach((row, i) => {
      const z = MARGIN + i * ROW_PITCH + CAB_D / 2;
      rowZ.set(row.id, z);
      const cabs = cabsByRow.get(row.id) ?? [];
      const len = Math.max(CAB_W, ...cabs.map((c) => slotX(known(c.slot)!) + CAB_W));
      const index = known((row as Extract<Entity, { kind: 'row' }>).index);
      boxes.set(row.id, { pos: v3(x0 + len / 2, 0.05, z), size: v3(len, 0.1, CAB_D), placed: index !== null ? 'documented' : 'generated' });
      for (const cab of cabs) boxes.set(cab.id, { pos: v3(x0 + slotX(known(cab.slot)!) + CAB_W / 2, 1.1, z), size: v3(CAB_W, 2.2, CAB_D), placed: 'documented' });
    });
    maxDepth = Math.max(maxDepth, d);
    cursorX += w + HALL_GAP;
  }
  const siteW = Math.max(10, cursorX - HALL_GAP);
  unplacedCabs.sort(byId).forEach((cab, i) => {
    boxes.set(cab.id, { pos: v3(MARGIN + i * (CAB_W + 0.2) + CAB_W / 2, 1.1, maxDepth + 1.5), size: v3(CAB_W, 2.2, CAB_D), placed: 'unplaced' });
  });
  unassignedRows.sort(byId).forEach((row, i) => boxes.set(row.id, { pos: v3(MARGIN + i * 3, 0.05, maxDepth + 3.5), size: v3(2.4, 0.1, CAB_D), placed: 'generated' }));

  // ── 3D: placed electrical (row-end / grid placement facts) and the electrical band behind the halls.
  const placeFromFact = (id: AnyId, placement: Placement | null, size: readonly [number, number, number]): boolean => {
    if (!placement) return false;
    if (placement.at === 'row-end') {
      const rowBox = boxes.get(placement.row);
      if (!rowBox) return false;
      const x = placement.end === 'start' ? rowBox.pos[0] - rowBox.size[0] / 2 - size[0] / 2 - 0.4 : rowBox.pos[0] + rowBox.size[0] / 2 + size[0] / 2 + 0.4;
      boxes.set(id, { pos: v3(x, size[1] / 2, rowBox.pos[2]), size: v3(...size), placed: 'documented' });
      return true;
    }
    if (placement.at === 'grid') {
      const o = hallOrigin.get(placement.hall);
      if (!o) return false;
      boxes.set(id, { pos: v3(o.x + placement.x, size[1] / 2, placement.z), size: v3(...size), placed: 'documented' });
      return true;
    }
    return false;
  };
  const band: Entity[] = [];
  for (const e of entities) {
    if (!PHYSICAL.has(e.kind)) continue;
    const placement = e.kind === 'pdu' || e.kind === 'rpp' ? known(e.placement) : null;
    if (!placeFromFact(e.id, placement, KINDS[e.kind].geometry.size)) band.push(e);
  }
  const bandTiers = [...new Set(band.map((e) => physTier(e.id)))].sort((a, b) => a - b);
  const maxBand = bandTiers.length - 1;
  const laneOrder = (id: AnyId) => (sideOf(id) === 'A' ? 0 : sideOf(id) === 'B' ? 2 : 1);
  bandTiers.forEach((tier, ti) => {
    const row = band.filter((e) => physTier(e.id) === tier).sort((a, b) => laneOrder(a.id) - laneOrder(b.id) || byId(a, b));
    const z = -(5 + (maxBand - ti) * 6);
    const widths = row.map((e) => KINDS[e.kind].geometry.size[0] + 1.5);
    const gaps: number[] = row.map((e, i) => (i > 0 && laneOrder(row[i - 1]!.id) !== laneOrder(e.id) ? 3 : 0));
    const total = widths.reduce((s, w) => s + w, 0) + gaps.reduce((s, x) => s + x, 0);
    let x = siteW / 2 - total / 2;
    row.forEach((e, i) => {
      x += gaps[i]!;
      const size = KINDS[e.kind].geometry.size;
      boxes.set(e.id, { pos: v3(x + widths[i]! / 2, size[1] / 2, z), size: v3(...size), placed: 'generated' });
      x += widths[i]!;
    });
  });

  // Breakers on their bus, circuits on their panel (small boxes on the front face).
  const attach = (kind: 'breaker' | 'circuit', parentOf: (e: Entity) => SupplyEdge, perRow: number, dx: number, dy: number) => {
    const groups = new Map<AnyId, Entity[]>();
    const orphans: Entity[] = [];
    for (const e of entities.filter((x) => x.kind === kind)) {
      const p = parentOf(e).to[0];
      if (p && boxes.has(p)) {
        let l = groups.get(p);
        if (!l) groups.set(p, (l = []));
        l.push(e);
      } else orphans.push(e);
    }
    const size = KINDS[kind].geometry.size;
    for (const [p, list] of groups) {
      const pb = boxes.get(p)!;
      list.sort(byId).forEach((e, i) => {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const x = pb.pos[0] + (col - (Math.min(perRow, list.length) - 1) / 2) * dx;
        boxes.set(e.id, { pos: v3(x, 0.3 + row * dy, pb.pos[2] + pb.size[2] / 2 + size[2] / 2 + 0.05), size: v3(...size), placed: 'generated' });
      });
    }
    orphans.sort(byId).forEach((e, i) => boxes.set(e.id, { pos: v3(i * 0.6, size[1] / 2, -2), size: v3(...size), placed: 'unplaced' }));
  };
  const seriesInput = (e: Entity) => (g.nodes.get(e.id)?.supply as Extract<SupplyRule, { rule: 'series' }>).input;
  attach('breaker', seriesInput, 8, 0.5, 0.7);
  attach('circuit', seriesInput, 6, 0.18, 0.2);

  // ── 3D: cooling plant beyond the halls; CRAHs on the hall side walls.
  const plantZ = maxDepth + 4;
  let px = 0;
  for (const loop of f.list('loop')) {
    const pool = g.loops.get(loop.id);
    const chillers = (pool?.chillers ?? []).map((m) => m.id).sort();
    const pumps = (pool?.pumps ?? []).map((m) => m.id).sort();
    const headers = [...new Set(chillers.flatMap((c) => (g.nodes.get(c)!.supply as Extract<SupplyRule, { rule: 'cooling-member' }>).via?.to ?? []))].sort();
    const start = px;
    chillers.forEach((c, i) => boxes.set(c, { pos: v3(px + i * 7 + 3, 1.25, plantZ + 6), size: v3(6, 2.5, 2.5), placed: 'generated' }));
    const chEnd = start + Math.max(1, chillers.length) * 7;
    headers.forEach((h) => {
      const xs = chillers.filter((c) => (g.nodes.get(c)!.supply as Extract<SupplyRule, { rule: 'cooling-member' }>).via?.to.includes(h)).map((c) => boxes.get(c)!.pos[0]);
      const x = xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : start;
      boxes.set(h, { pos: v3(x, 0.2, plantZ + 3), size: v3(Math.max(4, xs.length * 7 - 2), 0.4, 0.4), placed: 'generated' });
    });
    pumps.forEach((p, i) => boxes.set(p, { pos: v3(chEnd + 1 + i * 2, 0.5, plantZ + 1.5), size: v3(1.2, 1, 0.8), placed: 'generated' }));
    const end = Math.max(chEnd, chEnd + 1 + pumps.length * 2);
    boxes.set(loop.id, { pos: v3((start + end) / 2, 0.15, plantZ), size: v3(1, 0.3, 1), placed: 'generated' });
    px = end + 4;
  }
  for (const e of entities) {
    if ((e.kind === 'chiller' || e.kind === 'pump' || e.kind === 'header') && !boxes.has(e.id)) {
      const size = KINDS[e.kind].geometry.size;
      boxes.set(e.id, { pos: v3(px, size[1] / 2, plantZ + 8), size: v3(...size), placed: 'unplaced' });
      px += size[0] + 1;
    }
  }
  for (const hall of halls) {
    const o = hallOrigin.get(hall.id)!;
    const crahs = (g.halls.get(hall.id)?.crahs ?? []).map((m) => f.get(m.id as Id<'crah'>)).sort(byId);
    const free = crahs.filter((c) => !placeFromFact(c.id, known(c.placement), KINDS.crah.geometry.size));
    const left = free.filter((_, i) => i % 2 === 0);
    const right = free.filter((_, i) => i % 2 === 1);
    for (const [list, x] of [[left, o.x + 0.7], [right, o.x + o.w - 0.7]] as const) {
      list.forEach((c, j) => boxes.set(c.id, { pos: v3(x, 1, (o.d * (j + 1)) / (list.length + 1)), size: v3(...KINDS.crah.geometry.size), placed: 'generated' }));
    }
  }
  for (const e of entities) if (e.kind === 'crah' && !boxes.has(e.id)) boxes.set(e.id, { pos: v3(siteW + 2, 1, MARGIN), size: v3(...KINDS.crah.geometry.size), placed: 'unplaced' });

  // ── 3D: tenants float above their cabinets (label anchors, zero size).
  const customerOf = new Map<AnyId, AnyId | null>();
  for (const cab of f.list('cabinet')) customerOf.set(cab.id, known(cab.customer));
  for (const c of f.list('contract')) customerOf.set(c.id, known(c.customer));
  for (const c of f.list('customer')) customerOf.set(c.id, c.id);
  const centroid = (ids: readonly AnyId[], y: number): Vec3 => {
    const ps = ids.map((i) => boxes.get(i)?.pos).filter((p): p is Vec3 => !!p);
    if (ps.length === 0) return v3(0, y, -2);
    return v3(ps.reduce((s, p) => s + p[0], 0) / ps.length, y, ps.reduce((s, p) => s + p[2], 0) / ps.length);
  };
  for (const c of f.list('customer')) {
    const cabs = f.list('cabinet').filter((x) => customerOf.get(x.id) === c.id).map((x) => x.id);
    boxes.set(c.id, { pos: centroid(cabs, 3.2), size: v3(0, 0, 0), placed: 'generated' });
  }
  for (const c of f.list('contract')) {
    const cust = customerOf.get(c.id);
    const base = cust ? boxes.get(cust)?.pos : undefined;
    boxes.set(c.id, { pos: base ? v3(base[0], 3.8, base[2]) : v3(0, 3.8, -2), size: v3(0, 0, 0), placed: 'generated' });
  }

  // ── 2D one-line.
  const pos2 = new Map<AnyId, Vec2>();
  const powerKinds = new Set(['utility', 'generator', 'ats', 'switchgear', 'breaker', 'ups', 'pdu', 'rpp', 'circuit']);
  const elec = entities.filter((e) => powerKinds.has(e.kind)).map((e) => e.id);
  const maxTier = Math.max(0, ...elec.map(tierOf));
  const lanes: Record<0 | 1 | 2, Map<number, AnyId[]>> = { 0: new Map(), 1: new Map(), 2: new Map() };
  for (const id of elec.sort()) {
    const lane = laneOrder(id) as 0 | 1 | 2;
    const t = tierOf(id);
    let l = lanes[lane].get(t);
    if (!l) lanes[lane].set(t, (l = []));
    l.push(id);
  }
  const laneHeight = ([0, 1, 2] as const).map((l) => Math.max(0, ...[...lanes[l].values()].map((x) => x.length)) * PITCH);
  const laneTop = [0, laneHeight[0]! + LANE_GAP, laneHeight[0]! + laneHeight[1]! + 2 * LANE_GAP];
  const elecHeight = laneTop[2]! + laneHeight[2]!;
  const yOf = new Map<AnyId, number>();
  const assignY = () => {
    for (const l of [0, 1, 2] as const) for (const ids of lanes[l].values()) ids.forEach((id, i) => yOf.set(id, laneTop[l]! + i * PITCH + PITCH / 2));
  };
  const parentsOf = (id: AnyId) => (g.nodes.get(id)?.upstream ?? []).filter((u) => isPowerRole(u.role)).flatMap((u) => u.edge.to);
  const childrenOf = (id: AnyId) => (g.dependents.get(id) ?? []).filter((d) => powerKinds.has(kindOf(d)) || kindOf(d) === 'cord');
  const childY = (id: AnyId): number[] =>
    childrenOf(id).flatMap((c) => (kindOf(c) === 'cord' ? (yOf.has(g.cabinetOfCord.get(c)!) ? [yOf.get(g.cabinetOfCord.get(c)!)!] : []) : yOf.has(c) ? [yOf.get(c)!] : []));
  const sweep = (dir: 'down' | 'up') => {
    const tiers = [...Array(maxTier + 1).keys()];
    for (const t of dir === 'down' ? tiers : tiers.reverse()) {
      for (const l of [0, 1, 2] as const) {
        const ids = lanes[l].get(t);
        if (!ids) continue;
        const score = new Map(ids.map((id, i) => {
          const ys = dir === 'down' ? parentsOf(id).filter((p) => yOf.has(p)).map((p) => yOf.get(p)!) : childY(id);
          return [id, ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : yOf.get(id) ?? i * PITCH] as const;
        }));
        ids.sort((a, b) => score.get(a)! - score.get(b)! || (a < b ? -1 : 1));
      }
      assignY();
    }
  };

  // Cabinets: grouped by customer (revenue desc), wrapped into k columns for a ~16:10 canvas.
  const { book } = internalsOf(an);
  const customers: AnyId[] = f.list('customer').map((c) => c.id).sort((a, b) => book.customerMonthly(b) - book.customerMonthly(a) || (a < b ? -1 : 1));
  const cabOrder = [
    ...customers.flatMap((c) => f.list('cabinet').filter((x) => customerOf.get(x.id) === c).map((x) => x.id)),
    ...f.list('cabinet').filter((x) => !customers.includes(customerOf.get(x.id) ?? ('' as AnyId))).map((x) => x.id),
  ];
  const coolingCols = 4;
  const coolingRows = Math.max(1, f.list('chiller').length + f.list('pump').length, f.list('crah').length, f.list('header').length);
  const coolingHeight = coolingRows * PITCH;
  let bestK = 1;
  let bestErr = Infinity;
  for (let k = 1; k <= Math.max(1, cabOrder.length); k++) {
    const width = (maxTier + 1 + k + 2) * COL;
    const height = Math.max(elecHeight, Math.ceil(cabOrder.length / k) * PITCH) + LANE_GAP * 2 + coolingHeight;
    const err = Math.abs(Math.log(width / height / 1.6));
    if (err < bestErr - 1e-9) {
      bestErr = err;
      bestK = k;
    }
  }
  const perCol = Math.max(1, Math.ceil(cabOrder.length / bestK));
  const cabTop = Math.max(0, (elecHeight - perCol * PITCH) / 2);
  cabOrder.forEach((id, i) => yOf.set(id, cabTop + (i % perCol) * PITCH + PITCH / 2));
  assignY();
  sweep('down');
  sweep('up');
  sweep('down');
  for (const id of elec) pos2.set(id, v2(tierOf(id) * COL + COL / 2, yOf.get(id)!));
  const cabCol0 = maxTier + 1;
  cabOrder.forEach((id, i) => pos2.set(id, v2((cabCol0 + Math.floor(i / perCol)) * COL + COL / 2, yOf.get(id)!)));
  const custCol = cabCol0 + bestK;
  const contentH = Math.max(elecHeight, perCol * PITCH + cabTop);
  customers.forEach((c, i) => {
    const ys = cabOrder.filter((x) => customerOf.get(x) === c).map((x) => yOf.get(x)!);
    pos2.set(c, v2(custCol * COL + COL / 2, ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : i * PITCH + PITCH / 2));
  });
  f.list('contract').forEach((c, i) => {
    const cust = customerOf.get(c.id);
    const p = cust ? pos2.get(cust) : undefined;
    const sameCustomerBefore = f.list('contract').slice(0, i).filter((x) => customerOf.get(x.id) === cust).length;
    pos2.set(c.id, v2((custCol + 1) * COL + COL / 2, (p ? p[1] : i * PITCH + PITCH / 2) + sameCustomerBefore * PITCH));
  });
  const coolTop = contentH + LANE_GAP * 2;
  const coolCol: Record<string, number> = { header: 0, chiller: 1, pump: 1, loop: 2, crah: 3, hall: coolingCols, row: coolingCols + 1 };
  const coolCount = new Map<number, number>();
  for (const e of entities.filter((x) => x.kind in coolCol).sort((a, b) => coolCol[a.kind]! - coolCol[b.kind]! || byId(a, b))) {
    const col = coolCol[e.kind]!;
    const n = coolCount.get(col) ?? 0;
    coolCount.set(col, n + 1);
    pos2.set(e.id, v2(col * COL + COL / 2, coolTop + n * PITCH + PITCH / 2));
  }

  // ── Overlays.
  const findingsOf = new Map<AnyId, string[]>();
  for (const x of audit.findings) for (const id of findingEntities(x)) {
    let l = findingsOf.get(id);
    if (!l) findingsOf.set(id, (l = []));
    l.push(x.id);
  }

  const nodes: SceneNodeDto[] = entities.sort(byId).map((e) => {
    const b = boxes.get(e.id) ?? { pos: v3(0, 0, 0), size: v3(0, 0, 0), placed: 'unplaced' as const };
    return {
      id: e.id,
      kind: e.kind,
      layer: KINDS[e.kind].layer,
      label: e.tag,
      side: sideOf(e.id),
      customer: customerOf.get(e.id) ?? null,
      pos3: b.pos,
      size3: b.size,
      pos2: pos2.get(e.id) ?? v2(0, 0),
      in2d: e.kind !== 'hall' && e.kind !== 'row',
      findings: [...new Set(findingsOf.get(e.id) ?? [])].sort(),
      placed: b.placed,
    };
  });

  // ── Links.
  const top = (id: AnyId): Vec3 => {
    const b = boxes.get(id);
    return b ? v3(b.pos[0], b.pos[1] + b.size[1] / 2, b.pos[2]) : v3(0, 0, 0);
  };
  const bottom = (id: AnyId): Vec3 => {
    const b = boxes.get(id);
    return b ? v3(b.pos[0], Math.max(0, b.pos[1] - b.size[1] / 2), b.pos[2]) : v3(0, 0, 0);
  };
  const route3 = (from: AnyId, to: AnyId, layer: Layer): Vec3[] => {
    if (layer === 'cooling') {
      const a = bottom(from);
      const b = bottom(to);
      return dedupe([a, v3(a[0], FLOOR_Y, a[2]), v3(b[0], FLOOR_Y, a[2]), v3(b[0], FLOOR_Y, b[2]), b]);
    }
    if (layer === 'power') {
      const a = top(from);
      const b = top(to);
      const y = Math.max(TRAY_Y, a[1] + 0.3, b[1] + 0.3);
      return dedupe([a, v3(a[0], y, a[2]), v3(b[0], y, a[2]), v3(b[0], y, b[2]), b]);
    }
    return [boxes.get(from)?.pos ?? v3(0, 0, 0), boxes.get(to)?.pos ?? v3(0, 0, 0)];
  };
  const route2 = (from: AnyId, to: AnyId): Vec2[] => {
    const a = pos2.get(from) ?? v2(0, 0);
    const b = pos2.get(to) ?? v2(0, 0);
    if (a[1] === b[1]) return [a, b];
    const mx = Math.round((a[0] + b[0]) / 2);
    return [a, v2(mx, a[1]), v2(mx, b[1]), b];
  };
  const links = new Map<string, SceneLinkDto>();
  const link = (id: string, from: AnyId, to: AnyId, layer: Layer, side: Side | null) => {
    if (!links.has(id)) links.set(id, { id, from, to, layer, side, path3: route3(from, to, layer), path2: route2(from, to) });
  };
  const edgeLink = (from: AnyId, to: AnyId) => `${from}->${to}`;
  for (const n of [...g.nodes.values()].sort(byId)) {
    if (kindOf(n.id) === 'cord' || kindOf(n.id) === 'cabinet') continue;
    for (const { role, edge } of n.upstream) {
      if (role === 'cord' || role === 'zone') continue;
      const layer: Layer = isPowerRole(role) || role === 'power' ? 'power' : 'cooling';
      for (const from of edge.to) link(edgeLink(from, n.id), from, n.id, layer, layer === 'power' ? sideOf(n.id) : null);
    }
  }
  const cordCircuit = new Map<AnyId, AnyId | null>();
  for (const cord of f.list('cord')) {
    const circuit = (g.nodes.get(cord.id)!.supply as Extract<SupplyRule, { rule: 'series' }>).input.to[0] ?? null;
    const side = derivedSideOf(g, powerChain(g, cord.id)) ?? g.cordLabel.get(cord.id) ?? null;
    link(cord.id, circuit ?? cord.cabinet, cord.cabinet, 'power', side);
    cordCircuit.set(cord.id, circuit);
  }
  for (const row of f.list('row')) {
    const h = known(row.hall);
    if (h) link(edgeLink(row.id, h), row.id, h, 'space', null);
  }
  for (const cab of f.list('cabinet')) {
    const row = known(cab.row);
    if (row) link(edgeLink(cab.id, row), cab.id, row, 'space', null);
    const cust = customerOf.get(cab.id);
    if (cust) link(edgeLink(cab.id, cust), cab.id, cust, 'tenant', null);
  }
  for (const c of f.list('contract')) {
    const cust = customerOf.get(c.id);
    if (cust) link(edgeLink(c.id, cust), c.id, cust, 'tenant', null);
  }

  // ── X-ray per cabinet: the links on each side's power path.
  const xray: SceneDto['xray'] = {};
  for (const cab of f.list('cabinet')) {
    const p = an.paths(cab.id);
    const A = new Set<string>();
    const B = new Set<string>();
    p.cords.forEach((cp, i) => {
      // Bucketed by the cord's own label: the B cord's path is drawn as "B" even where topology puts it on A — that is the convergence to see.
      const bucket = (cp.labelledSide ?? cp.derivedSide ?? (i === 0 ? 'A' : 'B')) === 'A' ? A : B;
      const seen = new Set<AnyId>();
      const walk = (id: AnyId) => {
        if (seen.has(id)) return;
        seen.add(id);
        for (const { role, edge } of g.nodes.get(id)?.upstream ?? []) {
          if (!isPowerRole(role)) continue;
          for (const t of edge.to) {
            bucket.add(edgeLink(t, id));
            walk(t);
          }
        }
      };
      bucket.add(cp.cord);
      const circuit = cordCircuit.get(cp.cord);
      if (circuit) walk(circuit);
    });
    xray[cab.id] = { A: [...A].sort(), B: [...B].sort(), convergence: [...p.convergence] };
  }

  // ── Bounds.
  const all3 = nodes;
  const min3 = v3(Math.min(...all3.map((n) => n.pos3[0] - n.size3[0] / 2)), Math.min(FLOOR_Y, ...all3.map((n) => n.pos3[1] - n.size3[1] / 2)), Math.min(...all3.map((n) => n.pos3[2] - n.size3[2] / 2)));
  const max3 = v3(Math.max(...all3.map((n) => n.pos3[0] + n.size3[0] / 2)), Math.max(TRAY_Y, ...all3.map((n) => n.pos3[1] + n.size3[1] / 2)), Math.max(...all3.map((n) => n.pos3[2] + n.size3[2] / 2)));
  const pts2 = [...nodes.filter((n) => n.in2d).flatMap((n) => [v2(n.pos2[0] - 88, n.pos2[1] - 18), v2(n.pos2[0] + 88, n.pos2[1] + 18)]), ...[...links.values()].filter((l) => l.layer !== 'space').flatMap((l) => l.path2)];
  const bounds2 = { min: v2(Math.min(0, ...pts2.map((p) => p[0])), Math.min(0, ...pts2.map((p) => p[1]))), max: v2(Math.max(0, ...pts2.map((p) => p[0])), Math.max(0, ...pts2.map((p) => p[1]))) };

  return {
    revision: f.revision,
    bounds3: all3.length ? { min: min3, max: max3 } : { min: v3(0, 0, 0), max: v3(0, 0, 0) },
    bounds2,
    nodes,
    links: [...links.values()].sort(byId),
    xray,
  };
}

function dedupe(points: Vec3[]): Vec3[] {
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1] || p[2] !== points[i - 1]![2]);
}
