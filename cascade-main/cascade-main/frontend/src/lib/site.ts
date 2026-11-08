// The site as the screen reads it: the scene's nodes and links as a supply graph, plus each customer's
// name, monthly revenue and cabinets from GET /exposure. Pure; built once per model revision.

import type { CustomerExposureDto, SceneDto, SceneLinkDto, SceneNodeDto } from "@cascade/core/contract";

export interface Customer {
  id: string;
  name: string;
  monthly: number;
  cabinets: string[];
  /** Resting fill and edge of its cabinets on the floor. */
  tint: readonly [string, string];
}

export interface Site {
  revision: string;
  scene: SceneDto;
  node: ReadonlyMap<string, SceneNodeDto>;
  /** Supply direction: what each entity feeds (power, cooling) and, for space, what it contains. */
  kids: ReadonlyMap<string, readonly string[]>;
  pars: ReadonlyMap<string, readonly string[]>;
  power: readonly SceneLinkDto[];
  customers: ReadonlyMap<string, Customer>;
  /** Customers by id, the order the legend and chain use. */
  customerOrder: readonly string[];
}

const TINTS: readonly (readonly [string, string])[] = [
  ["#dde5ee", "#c3cfdc"],
  ["#e7e2d8", "#d3cbbb"],
  ["#dfe7dd", "#c5d2c2"],
  ["#e6dfea", "#d0c5d8"],
  ["#dbe7e7", "#bfd3d3"],
  ["#eadfdd", "#d8c6c2"],
];

/** Kinds the floor and chain never draw as a stop of their own. */
export const PASS_THROUGH = new Set(["breaker", "circuit", "row", "customer"]);
/** Kinds a click selects. */
export const SELECTABLE = new Set(["utility", "generator", "ats", "switchgear", "ups", "pdu", "transformer", "rpp", "panel", "chiller", "crah", "pump", "header", "loop", "cabinet"]);

function push(m: Map<string, string[]>, k: string, v: string) {
  const xs = m.get(k);
  if (xs) xs.push(v);
  else m.set(k, [v]);
}

export function buildSite(scene: SceneDto, exposure: readonly CustomerExposureDto[]): Site {
  const kids = new Map<string, string[]>();
  const pars = new Map<string, string[]>();
  for (const l of scene.links) {
    if (l.layer === "power" || l.layer === "cooling") {
      push(kids, l.from, l.to);
      push(pars, l.to, l.from);
    } else if (l.layer === "space") push(kids, l.to, l.from);
  }
  const ordered = [...exposure].sort((a, b) => (a.customer < b.customer ? -1 : 1));
  const customers = new Map<string, Customer>(
    ordered.map((c, i) => [
      c.customer,
      { id: c.customer, name: c.name, monthly: c.monthlyRevenueUsd, cabinets: c.cabinets.map((x) => x.id), tint: TINTS[i % TINTS.length]! },
    ]),
  );
  return {
    revision: scene.revision,
    scene,
    node: new Map(scene.nodes.map((n) => [n.id, n])),
    kids,
    pars,
    power: scene.links.filter((l) => l.layer === "power"),
    customers,
    customerOrder: ordered.map((c) => c.customer),
  };
}

export const labelOf = (site: Site, id: string) => site.node.get(id)?.label ?? id.slice(id.indexOf(":") + 1);
export const kindOf = (id: string) => id.slice(0, id.indexOf(":"));

/** The nearest drawn entities one supply step up (dir -1) or down (dir 1), skipping pass-through kinds. */
export function visibleStep(site: Site, ids: readonly string[], dir: 1 | -1): string[] {
  const next = (x: string) => (dir > 0 ? site.kids : site.pars).get(x) ?? [];
  const out: string[] = [];
  const seen = new Set(ids);
  const q = ids.flatMap(next);
  while (q.length) {
    const x = q.shift()!;
    if (seen.has(x)) continue;
    seen.add(x);
    const n = site.node.get(x);
    if (!n) continue;
    if (PASS_THROUGH.has(n.kind)) q.push(...next(x));
    else out.push(x);
  }
  return out;
}

/** Every cabinet the entity supplies, through any depth. */
export function downCabinets(site: Site, id: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set([id]);
  const q = [id];
  while (q.length) {
    for (const k of site.kids.get(q.shift()!) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (site.node.get(k)?.kind === "cabinet") out.add(k);
      else q.push(k);
    }
  }
  return out;
}

/** Cabinets the entity reaches without passing another drawn stop (its own circuits and rows). */
export function directCabinets(site: Site, id: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const q = [...(site.kids.get(id) ?? [])];
  while (q.length) {
    const x = q.shift()!;
    if (seen.has(x)) continue;
    seen.add(x);
    const k = site.node.get(x)?.kind;
    if (k === "cabinet") out.add(x);
    else if (k && PASS_THROUGH.has(k)) q.push(...(site.kids.get(x) ?? []));
  }
  return out;
}

/** Supply depth from an entity, for the ripple stagger. */
export function depthFrom(site: Site, id: string): Map<string, number> {
  const d = new Map([[id, 0]]);
  const q = [id];
  while (q.length) {
    const x = q.shift()!;
    for (const k of site.kids.get(x) ?? []) {
      if (d.has(k)) continue;
      d.set(k, d.get(x)! + 1);
      q.push(k);
    }
  }
  return d;
}

/** A cabinet's cords, as power links keyed by the cord id. */
export const cordsOf = (site: Site, cabinet: string) => site.power.filter((l) => l.to === cabinet && l.id.startsWith("cord:"));

/** The drawn entity a pass-through id belongs to: a circuit's or breaker's panel. */
export function ownerOf(site: Site, id: string): string {
  let x = id;
  for (let i = 0; i < 4; i++) {
    const n = site.node.get(x);
    if (n && !PASS_THROUGH.has(n.kind)) return x;
    const p = site.pars.get(x)?.[0];
    if (!p) return x;
    x = p;
  }
  return x;
}

/** The box on the floor that stands for an id: a cord's cabinet, a circuit's or breaker's panel. */
export function drawnOf(site: Site, id: string): string {
  if (id.startsWith("cord:")) return site.power.find((l) => l.id === id)?.to ?? id;
  return ownerOf(site, id);
}
