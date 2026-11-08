export interface EwmaState {
  mean: number;
  variance: number;
  count: number;
}

/**
 * Update EWMA state with a new value.
 */
export function updateEwma(state: EwmaState, value: number, alpha = 0.3): EwmaState {
  if (state.count === 0) {
    return { mean: value, variance: 0, count: 1 };
  }

  const diff = value - state.mean;
  const newMean = alpha * value + (1 - alpha) * state.mean;
  const newVariance = alpha * diff * diff + (1 - alpha) * state.variance;

  return {
    mean: newMean,
    variance: newVariance,
    count: state.count + 1,
  };
}

/**
 * Compute z-score for a value against an EWMA state.
 */
export function computeZScore(state: EwmaState, value: number): number {
  const stdDev = Math.sqrt(state.variance);
  if (stdDev === 0) return 0;
  return (value - state.mean) / stdDev;
}

/**
 * Determine if a value is anomalous given an EWMA state.
 */
export function isAnomalous(
  state: EwmaState,
  value: number,
  threshold = 2.0
): { anomalous: boolean; zScore: number; severity: 'info' | 'warning' | 'critical' } {
  const zScore = computeZScore(state, value);
  const absZ = Math.abs(zScore);

  return {
    anomalous: absZ >= threshold,
    zScore,
    severity: absZ >= 3 ? 'critical' : absZ >= 2 ? 'warning' : 'info',
  };
}

/**
 * Create a fresh EWMA state.
 */
export function createEwmaState(): EwmaState {
  return { mean: 0, variance: 0, count: 0 };
}
