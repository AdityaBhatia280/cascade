// Work orders: the site's planned and past work, as its CMMS exported it. They are schedule and
// history records, not facts about topology, so they never enter assembly. Each one's asset is
// joined to the model through the equipment register (ASSETNUM → register row → entity), the way
// the CMMS itself keys assets.

import type { WorkOrderStatus, WorkType } from '../contract.js';
import type { Facility } from '../facility/facility.js';
import type { AnyId } from '../facility/ids.js';
import type { SourceDocument } from '../ingest/documents.js';
import { parseDocument, registerAssets, type RegisterAsset } from '../ingest/sources.js';

/**
 * Site-local wall-clock time "YYYY-MM-DDTHH:mm", with ":ss" or ":ss.fff" when the export carries
 * them. Exports carry no zone; lexical order is chronological across precisions.
 */
export type LocalDateTime = string;

/** One work order exactly as the export states it. */
export interface WorkOrderRecord {
  readonly wonum: string;
  readonly description: string;
  readonly status: WorkOrderStatus;
  readonly workType: WorkType;
  readonly priority: number | null;
  readonly location: string;
  readonly assetNum: string | null;
  readonly scheduledStart: LocalDateTime | null;
  readonly scheduledFinish: LocalDateTime | null;
  readonly actualStart: LocalDateTime | null;
  readonly actualFinish: LocalDateTime | null;
  readonly reported: LocalDateTime;
  readonly statusDate: LocalDateTime | null;
  readonly pm: string | null;
  readonly jobPlan: string | null;
  readonly ownerGroup: string | null;
  readonly lead: string | null;
  readonly vendor: string | null;
}

export type AssetLink =
  | { readonly resolved: true; readonly assetNum: string; readonly entity: AnyId }
  | { readonly resolved: false; readonly assetNum: string; readonly why: string };

export interface WorkOrder extends WorkOrderRecord {
  /** null when the work order names only a location. */
  readonly asset: AssetLink | null;
}

const OPEN: { readonly [S in WorkOrderStatus]: boolean } = {
  WAPPR: true, APPR: true, WSCH: true, WMATL: true, WPCOND: true, INPRG: true, COMP: false, CLOSE: false, CAN: false,
};

/**
 * Every work order in the current version of each document, in schedule order (unscheduled last).
 * A WONUM exported twice keeps the row from the later-registered document.
 */
export function workOrdersOf(documents: readonly SourceDocument[], facility: Facility): readonly WorkOrder[] {
  const current = [...new Map(documents.map((d) => [d.path, d])).values()];
  const assets = new Map(current.flatMap(registerAssets).map((a) => [a.assetNum, a]));
  const byWonum = new Map(current.flatMap((d) => parseDocument(d)?.workOrders ?? []).map((r) => [r.wonum, r]));
  return [...byWonum.values()]
    .map((r): WorkOrder => ({ ...r, asset: r.assetNum === null ? null : link(r.assetNum, assets, facility) }))
    .sort(bySchedule);
}

/** Open work scheduled to start in [asOf, until), in schedule order. */
export function upcomingWorkOrders(orders: readonly WorkOrder[], asOf: LocalDateTime, until?: LocalDateTime): readonly WorkOrder[] {
  return orders.filter((o) => OPEN[o.status] && o.scheduledStart !== null && o.scheduledStart >= asOf && (until === undefined || o.scheduledStart < until));
}

/** Wall-clock arithmetic on a site-local time; the calendar is the only thing that moves. */
export function addDays(t: LocalDateTime, days: number): LocalDateTime {
  const [y, m, d] = t.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10) + t.slice(10);
}

/** Wall-clock hours on a site-local time, to the minute. A DST shift inside the span is not applied. */
export function addHours(t: LocalDateTime, hours: number): LocalDateTime {
  const [y, m, d] = t.slice(0, 10).split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d, Number(t.slice(11, 13) || 0), Number(t.slice(14, 16) || 0) + Math.round(hours * 60));
  return new Date(ms).toISOString().slice(0, 16);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const dayIndex = (t: LocalDateTime) => new Date(`${t.slice(0, 10)}T00:00:00Z`).getUTCDay();

/** "Tue 2026-11-10". */
export const siteDay = (t: LocalDateTime): string => `${WEEKDAYS[dayIndex(t)]} ${t.slice(0, 10)}`;

/** Weekdays strictly after `from`'s date and strictly before `to`'s date. Holidays are not known. */
export function businessDaysBetween(from: LocalDateTime, to: LocalDateTime): number {
  let n = 0;
  for (let d = addDays(from.slice(0, 10), 1); d < to.slice(0, 10); d = addDays(d, 1)) {
    const w = dayIndex(d);
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** The date `n` weekdays after (or, negative, before) `day`'s date. Holidays are not known. */
export function addBusinessDays(day: LocalDateTime, n: number): string {
  let d = day.slice(0, 10);
  for (let left = Math.abs(n); left > 0; ) {
    d = addDays(d, Math.sign(n));
    const w = dayIndex(d);
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

/** Open work: not completed, closed or cancelled. */
export const isOpen = (o: WorkOrder): boolean => OPEN[o.status];

function link(assetNum: string, assets: ReadonlyMap<string, RegisterAsset>, facility: Facility): AssetLink {
  const a = assets.get(assetNum);
  if (!a) return { resolved: false, assetNum, why: `${assetNum} is not in the equipment register` };
  if (!a.kind) return { resolved: false, assetNum, why: `the register lists ${assetNum} as ${a.tag} (${a.assetClass}), which the model does not include` };
  const entity = facility.parseId(`${a.kind}:${a.tag}`);
  if (!entity) return { resolved: false, assetNum, why: `the register lists ${assetNum} as ${a.tag} (status ${a.status}), which is not in the model` };
  return { resolved: true, assetNum, entity };
}

const bySchedule = (a: WorkOrder, b: WorkOrder) =>
  (a.scheduledStart ?? '￿').localeCompare(b.scheduledStart ?? '￿') || a.reported.localeCompare(b.reported) || a.wonum.localeCompare(b.wonum);
