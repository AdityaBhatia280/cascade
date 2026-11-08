// Operating history: what the building automation system (BMS) and the electrical power monitoring
// system (EPMS) logged, as their exports state it. Like work orders these are time-based records,
// not facts about topology, so they never enter assembly. Each source name is joined to the model
// through the equipment register.

import type { Facility } from '../facility/facility.js';
import { kindOf, type AnyId } from '../facility/ids.js';
import type { SourceDocument } from '../ingest/documents.js';
import { normalizeTag, parseDocument, registerAssets, type RegisterAsset } from '../ingest/sources.js';
import type { LocalDateTime, WorkOrder } from '../maintenance/work-orders.js';

export type HistorySystem = 'bms' | 'epms';

/** What a row records: a condition going active, one returning to normal, or a one-off (command, acknowledgement, transfer). */
export type EventPhase = 'active' | 'normal' | 'instant';

/** One event-log row exactly as the export states it. */
export interface EventRecord {
  readonly system: HistorySystem;
  readonly at: LocalDateTime;
  /** The point or device name as the system writes it ("DFW1.Bldg1.CHW_Plant.CH-2.Disch_Press", "DFW1.SWGR-B-CB3"). */
  readonly source: string;
  readonly text: string;
  /** The system's own classification (Desigo event category, PME priority band). */
  readonly category: string;
  readonly phase: EventPhase;
  /** The reading or action the row carries, as written ("648.3 psig", "Current A 16.036; Below 25 A for 5 s"). */
  readonly detail: string | null;
}

/** One logged sample. `value` is null when the system marked the reading unreliable or left it blank. */
export interface TrendSample {
  readonly at: LocalDateTime;
  readonly value: number | null;
}

/** One point's (or one device measurement's) samples in one export, in file order. */
export interface TrendSeries {
  readonly system: HistorySystem;
  readonly source: string;
  readonly label: string;
  readonly unit: string;
  readonly samples: readonly TrendSample[];
}

/** An alarm threshold configured on one BMS point, as the point table states it. */
export interface AlarmLimit {
  readonly system: HistorySystem;
  /** The point's designation, as the point table, event log and trends write it ("DFW1.Bldg1.CHW_Plant.CH-1.CHWS_Temp"). */
  readonly source: string;
  readonly bound: 'high' | 'low';
  readonly value: number;
  readonly unit: string;
}

export interface SiteHistory {
  readonly events: readonly (EventRecord & { readonly entity: AnyId })[];
  readonly trends: readonly (TrendSeries & { readonly entity: AnyId })[];
  readonly limits: readonly (AlarmLimit & { readonly entity: AnyId })[];
  /** Each source name no model entity could be found for, with the reason and how many records it carries. */
  readonly unresolved: readonly UnresolvedSource[];
}

export interface UnresolvedSource {
  readonly system: HistorySystem;
  readonly source: string;
  readonly why: string;
  readonly records: number;
}

type SourceLink = { readonly resolved: true; readonly entity: AnyId } | { readonly resolved: false; readonly why: string };

/**
 * Every event, trend series and alarm limit in the current version of each document, each joined to the entity
 * its source names. A source names an entity when one of its dot-separated parts (read from the end)
 * is a register tag, or a register tag followed by a hyphenated suffix ("SWGR-A-MAIN" is SWGR-A).
 */
export function historyOf(documents: readonly SourceDocument[], facility: Facility): SiteHistory {
  const current = [...new Map(documents.map((d) => [d.path, d])).values()];
  const assets = current.flatMap(registerAssets);
  const parsed = current.map((d) => parseDocument(d));
  const links = new Map<string, SourceLink>();
  const counts = new Map<string, { readonly system: HistorySystem; readonly source: string; records: number }>();
  const linkOf = (system: HistorySystem, source: string, records: number): SourceLink => {
    let link = links.get(source);
    if (!link) links.set(source, (link = resolveSource(source, assets, facility)));
    if (!link.resolved) {
      const c = counts.get(source) ?? { system, source, records: 0 };
      c.records += records;
      counts.set(source, c);
    }
    return link;
  };
  const events: (EventRecord & { entity: AnyId })[] = [];
  const trends: (TrendSeries & { entity: AnyId })[] = [];
  const limits: (AlarmLimit & { entity: AnyId })[] = [];
  for (const r of parsed) {
    for (const e of r?.events ?? []) {
      const link = linkOf(e.system, e.source, 1);
      if (link.resolved) events.push({ ...e, entity: link.entity });
    }
    for (const s of r?.trends ?? []) {
      const link = linkOf(s.system, s.source, s.samples.length);
      if (link.resolved) trends.push({ ...s, entity: link.entity });
    }
    for (const l of r?.limits ?? []) {
      const link = linkOf(l.system, l.source, 1);
      if (link.resolved) limits.push({ ...l, entity: link.entity });
    }
  }
  const unresolved = [...counts.values()].map((c) => ({ ...c, why: (links.get(c.source) as Extract<SourceLink, { resolved: false }>).why }));
  return { events, trends, limits, unresolved };
}

function resolveSource(source: string, assets: readonly RegisterAsset[], facility: Facility): SourceLink {
  for (const part of source.split('.').reverse()) {
    const name = normalizeTag(part);
    const asset = assets
      .filter((a) => name === a.tag || name.startsWith(`${a.tag}-`))
      .reduce<RegisterAsset | null>((best, a) => (best && best.tag.length >= a.tag.length ? best : a), null);
    if (!asset) continue;
    if (!asset.kind) return { resolved: false, why: `${source} names ${asset.tag} (${asset.assetClass}), which the model does not include` };
    const entity = facility.parseId(`${asset.kind}:${asset.tag}`);
    if (!entity) return { resolved: false, why: `${source} names ${asset.tag} (status ${asset.status}), which is not in the model` };
    return { resolved: true, entity };
  }
  return { resolved: false, why: `no part of ${source} is a tag in the equipment register` };
}

/** [from, to) in site-local time; null leaves that side open. */
export interface HistoryWindow {
  readonly from: LocalDateTime | null;
  readonly to: LocalDateTime | null;
}

export type TimelineEntry =
  | { readonly kind: 'event'; readonly at: LocalDateTime; readonly entity: AnyId; readonly event: EventRecord }
  | { readonly kind: 'work-order'; readonly at: LocalDateTime; readonly entity: AnyId; readonly workOrder: WorkOrder };

export interface EntityHistory {
  readonly entity: AnyId;
  readonly window: HistoryWindow;
  /** BMS events, EPMS events and work orders on one timeline, in time order. */
  readonly timeline: readonly TimelineEntry[];
  readonly trends: readonly (TrendSeries & { readonly entity: AnyId })[];
}

/**
 * One entity's history in a window: its own records and those of the entities it directly refers
 * to (its feeder breaker, its header), so a chiller's history shows the power monitoring event on
 * the breaker that feeds it. A work order sits at its actual start (else scheduled start, else
 * report date) and is included while its span overlaps the window. Trends are clipped to the window.
 */
export function entityHistory(site: SiteHistory, workOrders: readonly WorkOrder[], facility: Facility, entity: AnyId, window: HistoryWindow): EntityHistory {
  const relevant = new Map<AnyId, boolean>();
  // A panel or transformer passes its feed straight through, so a meter on the breaker feeding MCC-B is about CH-2.
  const feeds = (e: AnyId): boolean => facility.dependents(e).some((d) => d === entity || ((kindOf(d) === 'panel' || kindOf(d) === 'transformer') && feeds(d)));
  const about = (e: AnyId) => {
    let r = relevant.get(e);
    if (r === undefined) relevant.set(e, (r = e === entity || feeds(e)));
    return r;
  };
  const inWindow = (t: LocalDateTime) => (window.from === null || t >= window.from) && (window.to === null || t < window.to);
  const timeline: TimelineEntry[] = [];
  for (const { entity: on, ...event } of site.events) {
    if (about(on) && inWindow(event.at)) timeline.push({ kind: 'event', at: event.at, entity: on, event });
  }
  for (const w of workOrders) {
    if (!w.asset?.resolved || !about(w.asset.entity)) continue;
    const start = w.actualStart ?? w.scheduledStart ?? w.reported;
    const end = w.actualFinish ?? w.scheduledFinish ?? start;
    if ((window.to === null || start < window.to) && (window.from === null || end >= window.from)) timeline.push({ kind: 'work-order', at: start, entity: w.asset.entity, workOrder: w });
  }
  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const trends = site.trends
    .filter((s) => about(s.entity))
    .map((s) => ({ ...s, samples: s.samples.filter((x) => inWindow(x.at)) }))
    .filter((s) => s.samples.length > 0);
  return { entity, window, timeline, trends };
}
