// Fact<T>: one field of one entity. Either the value the site's documents give, or missing when
// no document states it. When documents disagree, assembly has already picked one by source
// precedence (ingest/sources.ts), so a fact never holds more than one value.

import type { FactRef } from './ids.js';

export type Fact<T> =
  | { readonly ref: FactRef; readonly kind: 'known'; readonly value: T }
  | { readonly ref: FactRef; readonly kind: 'missing' };

/** Field type helper used by the schema table: `FactValue<Fact<number>>` = number. */
export type FactValue<F> = F extends { readonly kind: 'known'; readonly value: infer T } ? T : never;

export const knownFact = <T>(ref: FactRef, value: T): Fact<T> => Object.freeze({ ref, kind: 'known', value });

export const missingFact = <T>(ref: FactRef): Fact<T> => Object.freeze({ ref, kind: 'missing' });
