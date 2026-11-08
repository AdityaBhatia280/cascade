// The floor plan in drawing units. The scene's metres are warped piecewise-linearly so the cabinet rows,
// where most of the picture is, get more room than the yard and plant, and the whole site fits a
// FW x FH plan. Rooms are the bands each group of kinds occupies. Pure.

import type { EntityKind, SceneDto, SceneNodeDto } from "@cascade/core/contract";

export const FW = 1240;
export const FH = 800;
/** Drawing units per metre of height. */
const HS = 13;

export interface Box {
  id: string;
  kind: EntityKind;
  label: string;
  customer: string | null;
  X: number;
  Z: number;
  w: number;
  d: number;
  H: number;
  cab: boolean;
  /** Put the label above the box: something sits right below it. */
  labelAbove: boolean;
}

export interface Zone {
  /** The room's place in floor order, stable while the site grows. */
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  fill: number;
  edge: number;
  dashed: boolean;
}

export interface FloorLayout {
  boxes: Map<string, Box>;
  zones: Zone[];
  /** Metres (x, z) to plan units (X, Z), centred on the origin. */
  at: (x: number, z: number) => [number, number];
}

const NOT_DRAWN = new Set<EntityKind>(["circuit", "breaker", "customer", "row", "hall", "contract", "cord"]);
const ROOM_IDS = ["plant", "power", "hall", "cooling"] as const;
const ROOMS: readonly (readonly EntityKind[])[] = [
  ["utility", "generator", "ats"],
  ["switchgear", "ups", "pdu", "transformer", "rpp", "panel"],
  [],
  ["chiller", "header", "loop", "pump"],
];

type Range = readonly [number, number];
const extent = (ns: readonly SceneNodeDto[], axis: 0 | 2): Range => [
  Math.min(...ns.map((n) => n.pos3[axis] - n.size3[axis] / 2)),
  Math.max(...ns.map((n) => n.pos3[axis] + n.size3[axis] / 2)),
];
const within = (v: number, [a, b]: Range) => v > a && v < b;

/** A monotone map of [lo, hi] onto [a, b] whose local stretch is `weight(v)`. */
function warp(lo: number, hi: number, weight: (v: number) => number, a: number, b: number) {
  const step = 0.05;
  const acc: number[] = [];
  let s = 0;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    acc.push(s);
    s += weight(v + step / 2) * step;
  }
  const k = (b - a) / s;
  return (v: number) => a + acc[Math.max(0, Math.min(acc.length - 1, Math.round((v - lo) / step)))]! * k;
}

/** Never true: stands in for a band the site does not have yet. */
const NONE: Range = [0, 0];

export function buildLayout(scene: SceneDto): FloorLayout {
  const drawn = scene.nodes.filter((n) => !NOT_DRAWN.has(n.kind) && n.placed !== "unplaced");
  if (!drawn.length) return { boxes: new Map(), zones: [], at: (x, z) => [x, z] };
  const hallNode = scene.nodes.find((n) => n.kind === "hall");
  const cabs = drawn.filter((n) => n.kind === "cabinet");
  // A site read from part of its files may have plant but no hall or cabinets yet.
  const hallZ: Range | null = hallNode ? extent([hallNode], 2) : cabs.length ? extent(cabs, 2) : null;
  const hallX: Range = hallNode ? extent([hallNode], 0) : extent(drawn, 0);
  const inHall = (n: SceneNodeDto) => !!hallZ && within(n.pos3[2], hallZ);

  // Rooms in floor order: each group's z band, the hall's from the hall itself.
  const bands = ROOMS.map((kinds, i): Range | null => {
    if (i === 2) return hallZ;
    const ns = drawn.filter((n) => kinds.includes(n.kind) && !inHall(n));
    return ns.length ? extent(ns, 2) : null;
  });
  const present = bands.map((b, i) => [b, i] as const).filter((x): x is readonly [Range, number] => x[0] !== null);
  const zones: Zone[] = present.map(([[a, b], i], k) => {
    const hall = i === 2;
    const prev = present[k - 1]?.[0];
    const next = present[k + 1]?.[0];
    const z0 = hall ? a - 0.4 : prev ? (prev[1] + a) / 2 + 0.4 : a - 1;
    const z1 = hall ? b + 0.4 : next ? (b + next[0]) / 2 - 0.4 : b + 1;
    const outer = k === 0 || k === present.length - 1;
    return {
      id: ROOM_IDS[i]!,
      x0: hallX[0] - 0.4,
      x1: hallX[1] + 0.4,
      z0,
      z1,
      fill: hall ? 0xfafbfc : outer ? 0xf3f4f6 : 0xf4f5f7,
      edge: hall ? 0xd3d8dd : outer ? 0xd8dce1 : 0xdde1e5,
      dashed: outer && !hall,
    };
  });
  // Keep the hall's neighbours clear of its walls.
  for (let k = 0; k < zones.length; k++) {
    const z = zones[k]!;
    const nx = zones[k + 1];
    if (nx && z.z1 > nx.z0 - 0.8) z.z1 = nx.z0 - 0.8;
  }

  const rows = drawn.filter((n) => n.kind === "cabinet" || ((n.kind === "pdu" || n.kind === "rpp") && inHall(n)));
  const denseZ: Range = cabs.length ? [extent(cabs, 2)[0] - 0.4, extent(cabs, 2)[1] + 0.6] : (hallZ ?? NONE);
  const denseX: Range = rows.length ? [extent(rows, 0)[0] - 0.3, extent(rows, 0)[1] + 0.4] : hallX;
  const span: Range = zones.length ? [Math.min(...zones.map((z) => z.z0)), Math.max(...zones.map((z) => z.z1))] : extent(drawn, 2);
  const zLo = span[0] - 0.2;
  const zHi = span[1] + 0.2;
  const xLo = hallX[0] - 0.6;
  const xHi = hallX[1] + 0.7;
  const hallBand: Range = hallZ ? [hallZ[0] - 0.6, hallZ[1] + 0.6] : NONE;
  const ZM = warp(zLo, zHi, (z) => (within(z, denseZ) ? 2.1 : within(z, hallBand) ? 0.75 : 0.45), 20, FW - 20);
  const XM = warp(xLo, xHi, (x) => (within(x, denseX) ? 2.3 : 0.62), 30, FH - 30);
  const XL = warp(xLo, xHi, () => 1, 30, FH - 30);
  const xm = (z: number) => (within(z, hallBand) ? XM : XL);
  const at = (x: number, z: number): [number, number] => [ZM(z) - FW / 2, xm(z)(x) - FH / 2];

  const boxes = new Map<string, Box>();
  for (const n of drawn) {
    const [X, Z] = at(n.pos3[0], n.pos3[2]);
    const cab = n.kind === "cabinet";
    const [sx, sy, sz] = n.size3;
    const m = xm(n.pos3[2]);
    const w = Math.max(10, ZM(n.pos3[2] + sz / 2) - ZM(n.pos3[2] - sz / 2)) - (cab ? 2 : 0);
    const d = Math.max(8, m(n.pos3[0] + sx / 2) - m(n.pos3[0] - sx / 2)) - (cab ? 3 : 0);
    const H = Math.max(3, sy * HS * (n.kind === "header" || n.kind === "loop" ? 2 : 1));
    boxes.set(n.id, { id: n.id, kind: n.kind, label: n.label, customer: n.customer, X, Z, w, d, H, cab, labelAbove: false });
  }
  for (const b of boxes.values()) {
    if (b.cab) continue;
    b.labelAbove =
      b.kind === "header" ||
      [...boxes.values()].some((o) => o !== b && Math.abs(o.X - b.X) < (o.w + b.w) / 2 && o.Z - o.d / 2 >= b.Z + b.d / 2 - 1 && o.Z - o.d / 2 < b.Z + b.d / 2 + 22);
  }
  return { boxes, zones, at };
}
