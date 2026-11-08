import { store } from '../db/store.js';
import type { ParityResult } from '../db/schema.js';
import { computeMonthlyCamPic } from '../services/modernization.js';

/**
 * Run parity checks against GnuCOBOL golden outputs.
 */
export function runParityChecks(): ParityResult[] {
  const results: ParityResult[] = [];

  for (const pc of store.parityCases) {
    const baseOpexCents = Math.round(pc.base_usd_per_sf * 100);
    const currentOpexCents = Math.round(pc.current_usd_per_sf * 100);

    const actual = computeMonthlyCamPic({
      areaSf: pc.area_sf,
      baseOpexCents,
      currentOpexCents,
    });

    results.push({
      case_id: pc.id,
      description: pc.description,
      input: {
        area_sf: pc.area_sf,
        base_usd_per_sf: pc.base_usd_per_sf,
        current_usd_per_sf: pc.current_usd_per_sf,
      },
      expected: pc.expected_formatted,
      actual,
      pass: actual === pc.expected_formatted,
    });
  }

  return results;
}
