// What a scenario does, as the screen shows it: which entities go dark (red) or lose their backup
// (orange) at a moment of the timeline, which customers' cabinets that hits, and the server's
// revenue figures for each, kept apart so a backup dollar is never shown as a dark one.

import type { CustomerImpactDto, ScenarioResultDto } from "@cascade/core/contract";

export type Tone = "dark" | "backup";
/** The headline color: a cabinet goes dark, cabinets only lose backup, or nothing is hit. */
export type Grade = "red" | "amber" | "gray";

export interface Hit {
  cabinets: string[];
  /** "E01–E05", as the server wrote it. */
  label: string;
  /** Monthly revenue of exactly these cabinets, as the server computed it. */
  usd: number;
}

export interface CustomerHit {
  id: string;
  name: string;
  /** Dark when any of its cabinets is. */
  state: Tone;
  dark: Hit | null;
  backup: Hit | null;
}

export interface Impact {
  /** Distinct minutes of the timeline, ascending. */
  times: number[];
  /** Index into `times` the states are read at. */
  at: number;
  states: ReadonlyMap<string, Tone>;
  customers: CustomerHit[];
  darkCabinets: number;
  backupCabinets: number;
  /** Monthly revenue of the cabinets that go dark. */
  darkRevenue: number;
  /** Monthly revenue of the cabinets that only lose backup. */
  backupRevenue: number;
  grade: Grade;
}

type State = ScenarioResultDto["timeline"][number]["state"];
const toneOf = (s: State): Tone | null => (s === "down" || s === "unknown" ? "dark" : s === "exposed" ? "backup" : null);

const merge = (a: Hit | null, c: CustomerImpactDto): Hit =>
  a ? { cabinets: [...a.cabinets, ...c.cabinets], label: `${a.label}, ${c.cabinetsLabel}`, usd: a.usd + c.revenueExposedUsd } : { cabinets: [...c.cabinets], label: c.cabinetsLabel, usd: c.revenueExposedUsd };

/** Reads a scenario at one moment (default: the end of its timeline). Dark wins over backup. */
export function impactOf(result: ScenarioResultDto, at?: number): Impact {
  const times = result.moments.map((m) => m.tMin);
  const i = at === undefined ? times.length - 1 : Math.max(0, Math.min(at, times.length - 1));
  const now = times[i] ?? 0;
  const states = new Map<string, Tone>();
  for (const t of result.timeline) {
    if (t.tMin > now) continue;
    const tone = toneOf(t.state);
    if (tone && states.get(t.entity) !== "dark") states.set(t.entity, tone);
  }
  const byId = new Map<string, CustomerHit>();
  for (const c of result.moments[i]?.customers ?? []) {
    const tone = toneOf(c.state);
    if (!tone) continue;
    const h = byId.get(c.customer) ?? { id: c.customer, name: c.customerName, state: tone, dark: null, backup: null };
    h[tone] = merge(h[tone], c);
    if (tone === "dark") h.state = "dark";
    byId.set(c.customer, h);
  }
  const customers = [...byId.values()].sort((a, b) => (b.dark?.cabinets.length ?? 0) - (a.dark?.cabinets.length ?? 0) || (b.backup?.cabinets.length ?? 0) - (a.backup?.cabinets.length ?? 0) || a.name.localeCompare(b.name));
  const cabinets = (tone: Tone) => [...states].filter(([id, t]) => t === tone && id.startsWith("cabinet:")).length;
  const darkCabinets = cabinets("dark");
  const backupCabinets = cabinets("backup");
  return {
    times,
    at: i,
    states,
    customers,
    darkCabinets,
    backupCabinets,
    darkRevenue: customers.reduce((s, c) => s + (c.dark?.usd ?? 0), 0),
    backupRevenue: customers.reduce((s, c) => s + (c.backup?.usd ?? 0), 0),
    grade: darkCabinets > 0 ? "red" : backupCabinets > 0 ? "amber" : "gray",
  };
}
