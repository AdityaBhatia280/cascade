// The typed facility: a discriminated union of entities. Topology lives IN the entities as typed
// reference facts (there is no generic Edge type). Each reference field states which kinds it may
// point at, and each supply semantics (series / transfer / UPS / any-cord / capacity pool) is fixed
// by the kind, so "what does this device need to be energized?" is answered by its type.

import type { EntityKind, Side } from '../contract.js';
import type { Fact } from './fact.js';
import type { Id } from './ids.js';

interface Base<K extends EntityKind> {
  readonly id: Id<K>;
  readonly kind: K;
  /** Human tag as written in the documents ("PDU-3B", "R12"). Identity, not a fact. */
  readonly tag: string;
}

/** Ratings come in whatever unit the document used; physics converts with the power factor and derate in constants.ts. */
export type Rating =
  | { readonly unit: 'kw'; readonly kw: number }
  | { readonly unit: 'kva'; readonly kva: number }
  | { readonly unit: 'amps'; readonly amps: number; readonly volts: number; readonly phases: 1 | 3 };

/** Where an entity physically sits, when a document says so. Absent → scene generates a position. */
export type Placement =
  | { readonly at: 'row-end'; readonly row: Id<'row'>; readonly end: 'start' | 'end' }
  | { readonly at: 'grid'; readonly hall: Id<'hall'>; readonly x: number; readonly z: number }
  | { readonly at: 'room'; readonly room: string };

/** Design intent as stated in a document ("N+1 chillers", "2N UPS"). Compared against reality by audit. */
export type RedundancyIntent =
  | { readonly scheme: 'N' }
  | { readonly scheme: 'N+K'; readonly k: number }
  | { readonly scheme: '2N' };

// ───────────────────────────── Electrical chain ─────────────────────────────
// Supply semantics by kind (encoded in physics/supply.ts via KIND_SPEC, exhaustively):
//   utility, generator   source
//   ats                  transfer: energized if normal OR alternate (alternate after transfer delay)
//   switchgear, breaker,
//   pdu, rpp, circuit    series: energized iff its single input is energized and it is not overloaded
//   ups                  input OR (battery for batteryMin) OR bypass (maintenance)
//   cord                 series from its circuit
//   cabinet              ANY cord energized (with load re-shared to surviving cords) AND zone cooled

export interface Utility extends Base<'utility'> {
  readonly rating: Fact<Rating>;
}

export interface Generator extends Base<'generator'> {
  readonly rating: Fact<Rating>;
  readonly startDelaySec: Fact<number>;
}

export interface Ats extends Base<'ats'> {
  readonly normal: Fact<Id<'utility' | 'breaker'>>;
  readonly alternate: Fact<Id<'generator' | 'breaker'>>;
  readonly rating: Fact<Rating>;
}

export interface Switchgear extends Base<'switchgear'> {
  readonly input: Fact<Id<'ats' | 'utility' | 'breaker'>>;
  readonly rating: Fact<Rating>;
  /** Side as labelled in documents. Audit never trusts labels for independence; topology decides. */
  readonly labelledSide: Fact<Side | null>;
}

/** A distribution breaker sitting in a bus (switchgear, UPS output board, PDU). Shared breakers are SPOFs. */
export interface Breaker extends Base<'breaker'> {
  readonly bus: Fact<Id<'switchgear' | 'ups' | 'pdu'>>;
  readonly rating: Fact<Rating>;
}

export interface Ups extends Base<'ups'> {
  readonly input: Fact<Id<'breaker'>>;
  /** Static/maintenance bypass source. null = no bypass (documented absence is itself a fact). */
  readonly bypass: Fact<Id<'breaker'> | null>;
  readonly batteryMin: Fact<number>;
  readonly rating: Fact<Rating>;
  readonly labelledSide: Fact<Side | null>;
}

export interface Pdu extends Base<'pdu'> {
  readonly input: Fact<Id<'ups' | 'breaker'>>;
  readonly rating: Fact<Rating>;
  readonly labelledSide: Fact<Side | null>;
  readonly placement: Fact<Placement>;
}

export interface Rpp extends Base<'rpp'> {
  readonly input: Fact<Id<'breaker'>>;
  readonly rating: Fact<Rating>;
  readonly labelledSide: Fact<Side | null>;
  readonly placement: Fact<Placement>;
}

/** A branch circuit (breaker + whip) in a PDU or RPP panel, feeding cabinet cords. */
export interface Circuit extends Base<'circuit'> {
  readonly panel: Fact<Id<'pdu' | 'rpp'>>;
  readonly position: Fact<string>;
  readonly rating: Fact<Rating>;
  readonly measuredKw: Fact<number>;
}

/**
 * A power cord: the first-class A/B path start. Belongs to a cabinet by identity
 * (id "cord:R12/B"), so membership is never in question; WHICH circuit it plugs into is a fact.
 */
export interface Cord extends Base<'cord'> {
  readonly cabinet: Id<'cabinet'>;
  readonly labelledSide: Fact<Side>;
  readonly circuit: Fact<Id<'circuit'>>;
}

// ───────────────────────────── IT space ─────────────────────────────

export interface Hall extends Base<'hall'> {
  readonly dimensionsM: Fact<{ readonly width: number; readonly depth: number }>;
  readonly coolingIntent: Fact<RedundancyIntent>;
  readonly maxInletC: Fact<number>;
}

export interface Row extends Base<'row'> {
  readonly hall: Fact<Id<'hall'>>;
  readonly index: Fact<number>;
}

export interface Cabinet extends Base<'cabinet'> {
  readonly row: Fact<Id<'row'>>;
  readonly slot: Fact<number>;
  readonly customer: Fact<Id<'customer'>>;
  readonly measuredKw: Fact<number>;
  /** Whether the IT gear can take a second cord. Gates the planner's add-cord move. */
  readonly dualPsu: Fact<boolean>;
}

// ───────────────────────────── Cooling plant ─────────────────────────────
// Cooling is a capacity pool, not a k-of-n count:
//   chiller → header → loop; pumps → loop; CRAH ← loop, CRAH → hall (zone).
//   loop capacity = min(Σ live chillers on live headers, Σ live pumps)
//   zone capacity = Σ live CRAH capacity, capped by its loop's capacity share
//   demand        = Σ heat of energized cabinets in the zone
// "N+1" is DERIVED (how many largest members can be lost while capacity ≥ demand) and compared
// against the documented RedundancyIntent by the cooling-capacity rule.

export interface Chiller extends Base<'chiller'> {
  readonly header: Fact<Id<'header'>>;
  readonly power: Fact<Id<'breaker' | 'circuit'>>;
  readonly capacityKw: Fact<number>;
  readonly role: Fact<'duty' | 'standby'>;
}

export interface Header extends Base<'header'> {
  readonly loop: Fact<Id<'loop'>>;
}

export interface Loop extends Base<'loop'> {
  readonly intent: Fact<RedundancyIntent>;
}

export interface Pump extends Base<'pump'> {
  readonly loop: Fact<Id<'loop'>>;
  readonly power: Fact<Id<'breaker' | 'circuit'>>;
  readonly capacityKw: Fact<number>;
}

export interface Crah extends Base<'crah'> {
  readonly loop: Fact<Id<'loop'>>;
  readonly hall: Fact<Id<'hall'>>;
  readonly power: Fact<Id<'breaker' | 'circuit'>>;
  readonly capacityKw: Fact<number>;
  readonly placement: Fact<Placement>;
}

// ───────────────────────────── Commercial ─────────────────────────────

export interface Customer extends Base<'customer'> {
  readonly name: Fact<string>;
}

export type ContractTerm =
  | { readonly term: 'power-redundancy'; readonly level: '2N' | 'A+B' | 'N+1' | 'N' }
  | { readonly term: 'cooling-redundancy'; readonly level: 'N+1' | 'N' }
  | { readonly term: 'committed-kw'; readonly cabinet: Id<'cabinet'>; readonly kw: number }
  | { readonly term: 'availability'; readonly pct: number; readonly excludesMaintenance: boolean }
  /** Written notice owed before Scheduled Maintenance, in business days. */
  | { readonly term: 'maintenance-notice'; readonly businessDays: number };

export interface Contract extends Base<'contract'> {
  readonly customer: Fact<Id<'customer'>>;
  readonly monthlyFeeUsd: Fact<number>;
  readonly cabinets: Fact<readonly Id<'cabinet'>[]>;
  /** One fact per clause. */
  readonly terms: readonly Fact<ContractTerm>[];
}

// ───────────────────────────── The union ─────────────────────────────

export type Entity =
  | Utility | Generator | Ats | Switchgear | Breaker | Ups | Pdu | Rpp | Circuit | Cord
  | Hall | Row | Cabinet
  | Chiller | Header | Loop | Pump | Crah
  | Customer | Contract;

export type EntityOf<K extends EntityKind> = Extract<Entity, { readonly kind: K }>;

/** Compile-time guard: the union covers every EntityKind in the contract, and nothing else. */
type _Exhaustive = [EntityKind] extends [Entity['kind']]
  ? [Entity['kind']] extends [EntityKind]
    ? true
    : never
  : never;
export const ENTITY_UNION_IS_EXHAUSTIVE: _Exhaustive = true;

/** Keys of E whose value is a Fact (the fields assembly must populate and patches may address). */
export type FactField<E> = {
  [P in keyof E]-?: E[P] extends Fact<unknown> ? P : never;
}[keyof E] & string;
