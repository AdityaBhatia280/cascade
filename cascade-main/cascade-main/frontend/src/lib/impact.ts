// What a scenario does, as the screen shows it: which entities go dark (red) or lose their backup
// (orange) at a moment of the timeline, which customers that hits, and the server's revenue figures.

import type { ScenarioResultDto } from "@cascade/core/contract";

export type Tone = "dark" | "backup";
/** The headline color: someone goes dark, someone only loses backup, or nobody is hit. */
export type Grade = "red" | "amber" | "gray";

export interface CustomerHit {
  id: string;
  name: string;
  state: Tone;
  /** Monthly revenue exposed, as the server computed it. */
  risk: number;
}

export interface Impact {
  /** Distinct minutes of the timeline, ascending. */
  times: number[];
  /** Index into `times` the states are read at. */
  at: number;
  states: ReadonlyMap<string, Tone>;
  customers: CustomerHit[];
  /** Monthly revenue of the customers that go dark, the headline. */
  darkRevenue: number;
  /** Monthly revenue of the customers that only lose backup. */
  backupRevenue: number;
  dark: number;
  backup: number;
  grade: Grade;
}

const toneOf = (s: ScenarioResultDto["timeline"][number]["state"]): Tone | null =>
  s === "down" || s === "unknown" ? "dark" : s === "exposed" ? "backup" : null;

/** Reads a scenario at one moment (default: the end of its timeline). Dark wins over backup. */
export function impactOf(result: ScenarioResultDto, at?: number): Impact {
  const times = [...new Set(result.timeline.map((t) => t.tMin))].sort((a, b) => a - b);
  const i = at === undefined ? times.length - 1 : Math.max(0, Math.min(at, times.length - 1));
  const now = times[i] ?? 0;
  const states = new Map<string, Tone>();
  for (const t of result.timeline) {
    if (t.tMin > now) continue;
    const tone = toneOf(t.state);
    if (tone && states.get(t.entity) !== "dark") states.set(t.entity, tone);
  }
  const customers: CustomerHit[] = [];
  for (const c of result.customers) {
    const tones = c.cabinets.map((x) => states.get(x));
    const state: Tone | null = tones.includes("dark") ? "dark" : tones.includes("backup") ? "backup" : null;
    if (state) customers.push({ id: c.customer, name: c.customerName, state, risk: c.revenueExposedUsd });
  }
  customers.sort((a, b) => Number(a.state !== "dark") - Number(b.state !== "dark") || b.risk - a.risk);
  const dark = customers.filter((c) => c.state === "dark").length;
  return {
    times,
    at: i,
    states,
    customers,
    darkRevenue: customers.filter((c) => c.state === "dark").reduce((s, c) => s + c.risk, 0),
    backupRevenue: customers.filter((c) => c.state === "backup").reduce((s, c) => s + c.risk, 0),
    dark,
    backup: customers.length - dark,
    grade: dark > 0 ? "red" : customers.length ? "amber" : "gray",
  };
}
