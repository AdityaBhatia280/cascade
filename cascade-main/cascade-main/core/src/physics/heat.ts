// Lumped single-node heat model for a hall that is short of cooling (docs/research/06-cooling-physics.md
// §4.3): dT/dt = (P_IT − Q_cool) / C_eff, with C_eff scaled by IT load. The deficit P_IT − Q_cool comes
// from `propagate`'s cooling balance; this module only turns kW of deficit into minutes. It is modeled,
// not measured: every caller labels its output that way.

export interface HeatModelParameter {
  readonly name: string;
  readonly value: string;
  readonly source: string;
}

/**
 * Effective thermal capacitance per MW of IT load (air plus server and rack mass), MJ/K. 06 §4.3 gives
 * 30–50 MJ/K per MW as the calibrated range: it reproduces the 1–2 °C/min measured on total cooling loss
 * (06 P7 Hosting365, P8 UPPMAX). The midpoint is the headline; the ends bound it.
 */
export const CAPACITANCE_MJ_PER_K_PER_MW = { low: 30, mid: 40, high: 50 } as const;

export const HEAT_MODEL_PARAMETERS: readonly HeatModelParameter[] = [
  {
    name: 'Effective thermal capacitance',
    value: `${CAPACITANCE_MJ_PER_K_PER_MW.low}–${CAPACITANCE_MJ_PER_K_PER_MW.high} MJ/K per MW of IT load (${CAPACITANCE_MJ_PER_K_PER_MW.mid} for the headline)`,
    source: 'docs/research/06-cooling-physics.md §4.3, calibrated to 1–2 °C/min on total cooling loss (P7, P8)',
  },
  {
    name: 'Cooling removed',
    value: 'Fixed at the engine’s remaining live capacity; no credit for chilled-water loop storage (loop volume is not in the records)',
    source: 'docs/research/06-cooling-physics.md §4.1–4.2 (fixed Q_cool, as in the §4.2 table); conservative',
  },
];

export interface Countdown {
  /** Minutes at the headline capacitance; null when there is no deficit. */
  readonly minutes: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minutes for a hall carrying `heatKw` of IT load, short `deficitKw` of cooling, to rise `headroomK`. */
export function minutesToLimit(headroomK: number, heatKw: number, deficitKw: number): Countdown {
  if (deficitKw <= 1e-6 || heatKw <= 0) return { minutes: null, low: null, high: null };
  if (headroomK <= 0) return { minutes: 0, low: 0, high: 0 };
  // C_eff [kJ/K] = c [MJ/K per MW] × P [kW], so t [s] = ΔT · c · P / deficit.
  const at = (c: number) => round1((headroomK * c * heatKw) / deficitKw / 60);
  return { minutes: at(CAPACITANCE_MJ_PER_K_PER_MW.mid), low: at(CAPACITANCE_MJ_PER_K_PER_MW.low), high: at(CAPACITANCE_MJ_PER_K_PER_MW.high) };
}

export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
