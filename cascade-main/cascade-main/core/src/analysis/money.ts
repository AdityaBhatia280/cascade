// THE ONLY PLACE MONEY IS COMPUTED. `Usd` is minted only here; every dollar figure anywhere in the
// system (findings, scenarios, exposure) is a `Usd` produced by a RevenueBook method.
// Framing: colo SLAs usually exclude maintenance and pay only if BOTH feeds fail, so we report
// "monthly revenue exposed" (revenue of cabinets on a single path / affected), never "credits you will pay".

import type { Facility } from '../facility/facility.js';
import type { AnyId, Id } from '../facility/ids.js';

declare const USD: unique symbol;
export type Usd = number & { readonly [USD]: true };

export interface RevenueBook {
  customerMonthly(customer: Id<'customer'>): Usd;
  /**
   * Monthly fee of a set of cabinets (deduplicated). A contract's fee is split over its cabinets by
   * committed kW when every cabinet has one, else equally. The one aggregation used by every caller.
   */
  exposed(cabinets: Iterable<Id<'cabinet'>>): Usd;
}

const cents = (n: number) => (Math.round(n * 100) / 100) as Usd;

export function revenueBook(f: Facility): RevenueBook {
  const perCabinet = new Map<AnyId, number>();
  const perCustomer = new Map<AnyId, number>();

  for (const c of f.list('contract')) {
    if (c.monthlyFeeUsd.kind === 'missing') continue;
    const fee = c.monthlyFeeUsd.value;
    if (c.customer.kind === 'known') perCustomer.set(c.customer.value, (perCustomer.get(c.customer.value) ?? 0) + fee);
    const cabinets = c.cabinets.kind === 'known' ? c.cabinets.value : [];
    if (cabinets.length === 0) continue;

    const committed = new Map<AnyId, number>();
    for (const t of c.terms) {
      if (t.kind === 'known' && t.value.term === 'committed-kw' && cabinets.includes(t.value.cabinet)) committed.set(t.value.cabinet, t.value.kw);
    }
    const byKw = committed.size === cabinets.length;
    const total = byKw ? [...committed.values()].reduce((s, v) => s + v, 0) : cabinets.length;
    for (const cab of cabinets) {
      const w = byKw ? committed.get(cab)! : 1;
      perCabinet.set(cab, (perCabinet.get(cab) ?? 0) + (fee * w) / total);
    }
  }

  return {
    customerMonthly: (customer) => cents(perCustomer.get(customer) ?? 0),
    exposed: (cabinets) => {
      let sum = 0;
      for (const c of new Set(cabinets)) sum += perCabinet.get(c) ?? 0;
      return cents(sum);
    },
  };
}
