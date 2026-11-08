// Engineering numbers no site document states.

/** For kVA and amps to kW. */
export const POWER_FACTOR = 0.95;
/** NEC 80% continuous-load derate for breakers and panels. */
export const CONTINUOUS_DERATE = 0.8;
export const BREAKER_TRIP_DELAY_MIN = 0;
/** Used when the register gives no generator start delay. */
export const GENERATOR_START_MIN_DEFAULT = 0.25;
/** Minutes from total cooling loss to inlet max at full IT load; scales with the deficit fraction. */
export const RIDE_THROUGH_MIN_AT_FULL_LOSS = 6;
/** Relative effort of each move kind; the fix planner minimizes the sum. */
export const MOVE_COST = { 'rehome-cord': 1, 'add-cord': 1, refeed: 3 } as const;
export const PLANNER_SEARCH_NODE_LIMIT = 50_000;
