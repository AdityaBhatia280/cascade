// @cascade/core public surface. package.json "exports" maps ONLY "." → this file and
// "./contract" → contract.ts, so deep imports of internals (supply graph, buildFacility, rule
// registry) fail to resolve from outside the package.

// Model
export type { Facility } from './facility/facility.js';
export type { Entity, EntityOf, Rating, Placement, RedundancyIntent, ContractTerm } from './facility/entities.js';
export type { Fact } from './facility/fact.js';
export { displayFact } from './facility/kinds.js';
export type { Id, AnyId, FactRef, Revision, SiteId } from './facility/ids.js';
export { siteId, kindOf, tagOf } from './facility/ids.js';

// Building the model
export { assemble } from './facility/assemble.js';
export type { Assembly, AssemblyInput, AssemblyIssue, CompletedChange } from './facility/assemble.js';
export { applyPatch, parsePatchOps, describeOp } from './facility/patch.js';
export type { Patch, PatchOp, PatchResult, PatchConflict } from './facility/patch.js';

// Ingest
export type { SourceDocument, Statement, DocFormat, DocId } from './ingest/documents.js';
export { sourceDocument, docIdFor } from './ingest/documents.js';
export type { Parser, ParseResult, ParserId, FactSource } from './ingest/sources.js';
export { PARSERS, SOURCE_PRECEDENCE, parserFor, parseDocument, normalizeTag } from './ingest/sources.js';
export { checkReading, contractStatements, CONTRACT_READING_SCHEMA } from './ingest/reading.js';
export type { ContractReading, CheckedReading, ReadingField } from './ingest/reading.js';
export { UPLOAD_KIND_SPECS, classifyByRules, readsAs, renameColumns, uploadSummary } from './ingest/classify.js';
export type { UploadSummary } from './ingest/classify.js';

// Maintenance (CMMS work orders: schedule and history records, joined to the model by the register)
export { workOrdersOf, upcomingWorkOrders, addDays } from './maintenance/work-orders.js';
export type { WorkOrder, WorkOrderRecord, AssetLink, LocalDateTime } from './maintenance/work-orders.js';
export { assessWorkOrders, cabinetRange, plannedWork, WORK_EFFECTS } from './maintenance/assessment.js';
export type { WorkAssessment, WorkReason, AffectedCustomer, Contradiction, PoolLevel, PlannedWork, Redundancy } from './maintenance/assessment.js';
export { maintenanceNotices } from './maintenance/notices.js';
export type { MaintenanceNotice, NoticeSet, NoticeEffect, NoticeBlock, NoticePeriod } from './maintenance/notices.js';

// Shift handoff (one moment's brief for the incoming shift)
export { shiftHandoff } from './handoff/handoff.js';
export type { HandoffBrief, HandoffWork, LostRedundancy, HandoffAlarms, WatchItem, CallItem } from './handoff/handoff.js';
export { draftMop, contingenciesOf } from './maintenance/mop.js';
export type { Mop, MopStep, MopNotice, SwitchAction, Prerequisite } from './maintenance/mop.js';
export { replan } from './maintenance/replan.js';
export type { Replan, ThermalCountdown, ThermalPhase, ModelParameter } from './maintenance/replan.js';

// Operating history (BMS and power monitoring exports: events and trends, joined to the model by the register)
export { historyOf, entityHistory } from './history/history.js';
export type {
  SiteHistory, EntityHistory, HistoryWindow, TimelineEntry, EventRecord, TrendSeries, TrendSample, UnresolvedSource, HistorySystem, EventPhase, AlarmLimit,
} from './history/history.js';

// Analysis (the read side)
export { analyze } from './analysis/analysis.js';
export type {
  Analysis, Scenario, ScenarioResult, CabinetPaths, CordPath, CustomerExposure, PatchVerification,
  Explanation, SpofEntry, TermCompliance,
} from './analysis/analysis.js';
export type { Finding, FindingId, FindingDetail, AuditReport, AuditDelta, CustomerImpact } from './analysis/audit.js';
export { findingEntities } from './analysis/audit.js';
export type { FixGoal, FixOutcome, FixPlan, PlanId, Unplanned } from './analysis/planner.js';
export { planOfOps } from './analysis/planner.js';
export type { Usd } from './analysis/money.js';
export type { Initiator, Transition, Cause } from './physics/supply.js';

// Wire
export { toWire } from './wire.js';
