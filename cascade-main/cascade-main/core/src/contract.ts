// THE SHARED CONTRACT: vocabulary + wire DTOs.
//
// Rules (enforced, not conventional):
// - Self-contained: this file has NO imports, so the browser bundle pulls in nothing else from core.
// - server/ and frontend/ both import it as `@cascade/core/contract`; there is no copy.
// - core/ domain types import their vocabulary (EntityKind, Side, RuleId...) FROM here, so every
//   closed list exists exactly once in the repo. Per-kind tables elsewhere are mapped types over
//   these unions, so adding a kind/rule fails the build until every table handles it.
// - DTOs are JSON-shaped: ids are plain strings, no Maps, no class instances, no brands.

// ───────────────────────────── Vocabulary ─────────────────────────────

export const ENTITY_KINDS = [
  // electrical chain, upstream → downstream
  'utility', 'generator', 'ats', 'switchgear', 'breaker', 'ups', 'pdu', 'rpp', 'circuit', 'cord',
  // IT space
  'hall', 'row', 'cabinet',
  // cooling plant
  'chiller', 'header', 'loop', 'pump', 'crah',
  // commercial
  'customer', 'contract',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const SIDES = ['A', 'B'] as const;
export type Side = (typeof SIDES)[number];

export type Layer = 'power' | 'cooling' | 'it' | 'tenant' | 'space';

export const RULE_IDS = [
  'single-corded',              // cabinet has < 2 cords, or all cords on one circuit
  'ab-convergence',             // A and B paths share a single point of failure upstream
  'failover-overload',          // losing one side overloads the other side's chain
  'circuit-overcommit',         // committed / measured kW exceeds continuous rating
  'cooling-capacity',           // zone cannot lose its largest unit and still meet demand
  'cooling-common-cause',       // redundant cooling members share a header / loop / power SPOF
  'contract-topology-mismatch', // contract promises 2N / A+B / N+1 that topology does not deliver
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Three-valued supply state. `unknown` = depends on a fact no document states. */
export type SupplyState = 'up' | 'unknown' | 'down';
export type Certainty = 'definite' | 'contingent';

/**
 * IBM Maximo work order statuses (out-of-the-box synonyms). Open work is everything before COMP;
 * COMP / CLOSE / CAN are terminal.
 */
export const WORK_ORDER_STATUSES = ['WAPPR', 'APPR', 'WSCH', 'WMATL', 'WPCOND', 'INPRG', 'COMP', 'CLOSE', 'CAN'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Each status as an operator would say it. */
export const WORK_ORDER_STATUS_WORDS: { readonly [S in WorkOrderStatus]: string } = {
  WAPPR: 'waiting on approval', APPR: 'approved', WSCH: 'waiting to be scheduled', WMATL: 'waiting on materials',
  WPCOND: 'waiting on plant conditions', INPRG: 'in progress', COMP: 'completed', CLOSE: 'closed', CAN: 'cancelled',
};

/** Maximo work types: preventive, corrective, emergency, capital project. */
export const WORK_TYPES = ['PM', 'CM', 'EM', 'CP'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/**
 * A planned work order's risk grade, worst first, with the label operators see. Graded by exposure
 * and consequence, not effort (Anvilfield field guide, docs/research/03 §1):
 *   highest  a customer loses all power or cooling paths, or the records cannot show it keeps one.
 *   high     a customer's load sits on its last path (one cord or one source) for the window.
 *   medium   plant redundancy is reduced (a credible single fault would short cooling); every
 *            customer keeps two power paths.
 *   low      the unit is backed up and margins hold.
 */
export const RISK_GRADES = { highest: 'STOP', high: 'High', medium: 'Medium', low: 'Low' } as const;
export type RiskGrade = keyof typeof RISK_GRADES;

/**
 * Why a planned work order is not low risk. loses-*: cabinets lose all power / cooling during the
 * work. one-cord-left / new-single-fault: cabinets left on their last cord or their last source.
 * cooling-margin: the plant's spare cooling used up.
 */
export const WORK_REASON_KINDS = ['loses-power', 'loses-cooling', 'one-cord-left', 'cooling-margin', 'new-single-fault'] as const;
export type WorkReasonKind = (typeof WORK_REASON_KINDS)[number];

/** Members of a cooling pool counted for N+k: chillers and pumps per loop, CRAHs per hall. */
export const COOLING_UNITS = ['chillers', 'pumps', 'crahs'] as const;
export type CoolingUnits = (typeof COOLING_UNITS)[number];

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'stale' | 'completed';
export type ModelView = 'documented' | 'planned';

// ───────────────────────────── Facts ─────────────────────────────

export interface FactDto {
  ref: string;
  field: string;
  /** null when no document states it. */
  display: string | null;
}

// ───────────────────────────── Model ─────────────────────────────

export interface EntityDto {
  id: string;
  kind: EntityKind;
  tag: string;
  layer: Layer;
  facts: FactDto[];
  /** Entities this one supplies / serves. */
  dependents: string[];
}

export type ActorDto =
  | { kind: 'human'; name: string }
  | { kind: 'agent'; runId: string; model: string }
  | { kind: 'playbook'; name: string };

export interface ModelSummaryDto {
  site: string;
  revision: string;
  view: ModelView;
  counts: Record<EntityKind, number>;
}

// ───────────────────────────── Analysis ─────────────────────────────

export interface CustomerImpactDto {
  customer: string;
  customerName: string;
  cabinets: string[];
  state: SupplyState | 'exposed';
  revenueExposedUsd: number;
}

export interface FindingDto {
  id: string;
  rule: RuleId;
  severity: Severity;
  subject: string;
  title: string;
  /** Rule-specific structured detail, rendered by the UI per rule. */
  detail: Record<string, string | number | string[]>;
  affected: CustomerImpactDto[];
  revenueExposedUsd: number;
}

export interface AuditDto {
  revision: string;
  findings: FindingDto[];
}

export interface ScenarioEventDto {
  target: string;
  how: 'fails' | 'maintenance';
  atMin: number;
}

export type CauseDto =
  | { kind: 'initiating'; how: 'fails' | 'maintenance' }
  | { kind: 'no-supply'; lost: string[] }
  | { kind: 'overload'; loadKw: number; ratedKw: number }
  | { kind: 'battery-exhausted'; runtimeMin: number }
  | { kind: 'thermal'; deficitKw: number }
  | { kind: 'lost-redundancy'; remaining: string[] };

export interface TimelineEventDto {
  tMin: number;
  entity: string;
  state: SupplyState | 'exposed';
  cause: CauseDto;
}

export interface ScenarioResultDto {
  revision: string;
  events: ScenarioEventDto[];
  timeline: TimelineEventDto[];
  customers: CustomerImpactDto[];
  revenueExposedUsd: number;
}

export interface PathDto {
  cord: string;
  side: Side | null;
  /** Ordered cord → circuit → panel → … → source; alternates (ATS inputs) flattened in order. */
  chain: string[];
}

export interface CustomerExposureDto {
  customer: string;
  name: string;
  cabinets: { id: string; paths: PathDto[]; spofs: string[]; redundancy: 'redundant' | 'single-path' | 'unknown' }[];
  terms: FactDto[];
  compliance: { term: string; met: boolean | null; why: string }[];
  monthlyRevenueUsd: number;
  revenueExposedUsd: number;
}

export type PatchOpDto =
  | { op: 'rehome-cord'; cord: string; from: string; to: string }
  | { op: 'add-cord'; cabinet: string; side: Side; circuit: string }
  | { op: 'refeed'; device: string; from: string; to: string };

/** A requested finding no returned plan clears, and why (code-generated sentence, never model text). */
export interface UnplannedDto {
  finding: string;
  reason: 'record-missing' | 'not-fixable' | 'no-move' | 'not-in-plan';
  detail: string;
}

export interface FixOutcomeDto {
  plans: FixPlanDto[];
  unplanned: UnplannedDto[];
}

export interface FixPlanDto {
  id: string;
  /** Model revision the plan was computed against; a proposal of it must name the same base. */
  base: string;
  ops: PatchOpDto[];
  moves: number;
  cleared: string[];
  introduced: string[];
  minHeadroomKw: number;
  optimal: boolean;
  explanation: string[];
}

export interface ProposalDto {
  id: string;
  plan: FixPlanDto;
  rationale: string;
  submittedBy: ActorDto;
  status: ProposalStatus;
  /** Why the proposal is stale (its patch no longer applies or would introduce findings); null otherwise. */
  staleReason: string | null;
  history: { status: ProposalStatus; by: ActorDto; at: string; note: string }[];
}

// ───────────────────────────── Work orders ─────────────────────────────

/** How a work order's ASSETNUM maps onto the model, through the equipment register. */
export type WorkOrderAssetDto =
  | { assetNum: string; resolved: true; entity: string; tag: string }
  | { assetNum: string; resolved: false; why: string };

/**
 * One row of a CMMS work order export. Times are site-local wall clock ("2026-11-10T14:00"), as
 * the export printed them; the export carries no time zone.
 */
export interface WorkOrderDto {
  wonum: string;
  description: string;
  status: WorkOrderStatus;
  workType: WorkType;
  /** 1 is highest; null when the export left it blank. */
  priority: number | null;
  location: string;
  /** null when the work order names only a location. */
  asset: WorkOrderAssetDto | null;
  scheduledStart: string | null;
  scheduledFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  reported: string;
  statusDate: string | null;
  pm: string | null;
  jobPlan: string | null;
  ownerGroup: string | null;
  lead: string | null;
  vendor: string | null;
}

// ───────────────────────────── Planned work assessment ─────────────────────────────

/** Power: the labelled sides of the cords still carrying a cabinet ("A+B", "B", "none"). Cooling: spare units ("N+1", "N", "short"). */
export type RedundancyDto =
  | { kind: 'cords'; sides: Side[]; label: string }
  | { kind: 'cooling'; units: CoolingUnits; spare: number; label: string };

export interface AffectedCustomerDto {
  customer: string;
  customerName: string;
  cabinets: string[];
  /** The cabinets as operators write them: "E01–E05", "D01, D02, D04–D10". */
  cabinetsLabel: string;
  /** null when the change is upstream of the cabinets and their cords look the same before and after. */
  before: RedundancyDto | null;
  after: RedundancyDto | null;
  /** Monthly revenue of these cabinets: lost for a stop, exposed if a second fault hits during the window for a risk. */
  revenueExposedUsd: number;
  /** The contract clause promising the redundancy at stake. */
  promise: FactDto | null;
}

/** Spare units in one pool, today and during the work. -1 = short of load. */
export interface PoolLevelDto {
  pool: string;
  units: CoolingUnits;
  before: number;
  after: number;
  label: string;
}

/** A panel or cord documented as one side whose feeds reach the other side. */
export interface ContradictionDto {
  entity: string;
  fedFrom: string;
  labelledSide: Side;
  tracedSide: Side;
  /** The record that labels it. */
  label: FactDto;
  /** Its feeds, up to the UPS or switchgear that decides the side, then that source's label. */
  trace: FactDto[];
  /** Work orders on that entity, oldest first. */
  workOrders: WorkOrderDto[];
}

/** A unit of the same pool on the same feed as the asset under work. */
export interface SharedFeedDto {
  unit: string;
  feed: string;
  facts: FactDto[];
}

export interface WorkReasonDto {
  kind: WorkReasonKind;
  grade: Exclude<RiskGrade, 'low'>;
  /** One sentence in operator words, computed by core. */
  text: string;
  customers: AffectedCustomerDto[];
  revenueExposedUsd: number;
  /** Single further faults that would cause the outage during the work and do not today. */
  secondFaults: string[];
  /** Single faults that already cause it today and still do. */
  standingFaults: string[];
  pools: PoolLevelDto[];
  sharedFeeds: SharedFeedDto[];
  contradictions: ContradictionDto[];
}

export type WorkAssessmentDto =
  | { workOrder: WorkOrderDto; assessed: false; why: string }
  | {
      workOrder: WorkOrderDto;
      assessed: true;
      grade: RiskGrade;
      headline: string;
      /** The asset the work takes out and how ("shut down", "on maintenance bypass"). */
      asset: string;
      says: string;
      /** The work as what-if events (`how:entity@min`), for the facility view's `e` parameter. */
      scenario: string[];
      reasons: WorkReasonDto[];
      /** Pools whose spare count changes, or that the asset belongs to. */
      pools: PoolLevelDto[];
      /** Plant that changes mode without costing a customer anything (a UPS on bypass). */
      plant: string[];
    };

// ───────────────────────────── Method of procedure ─────────────────────────────

export interface MopStepDto {
  n: number;
  phase: 'prerequisite' | 'work' | 'back-out';
  /** How many prerequisite moves are made in the model this step's expected result is computed on (0 = as built). */
  applied: number;
  /** "Open PDU-3A-SF-3 → RPP-4B de-energized → Halcyon Health Partners E01–E05 A+B → A". */
  text: string;
  /** A customer cabinet loses its last feed at this step (or may, where a record is missing). */
  hold: boolean;
  /** The plant after this step as what-if events (`how:entity@min`) on that model. */
  state: string[];
  deenergized: string[];
  reenergized: string[];
  customers: { customer: string; customerName: string; cabinets: string[]; cabinetsLabel: string; before: string; after: string }[];
  pools: PoolLevelDto[];
}

export interface MopNoticeDto {
  customer: string;
  customerName: string;
  cabinets: string[];
  cabinetsLabel: string;
  impact: string;
  noticeDays: number | null;
  /** Last site-local day ("YYYY-MM-DD") notice can be given; null without a notice clause. */
  deadline: string | null;
  status: 'on-time' | 'deadline-passed' | 'no-clause';
  text: string;
}

/**
 * A method of procedure drafted from the engine for one work order. Every step's expected result is
 * `propagate` on the model as it stands at that step. No model text.
 */
export interface MopDto {
  wonum: string;
  title: string;
  asOf: string;
  revision: string;
  /** The planned-work assessment's grade for the work as scheduled. */
  grade: RiskGrade;
  /** The grade with the prerequisite moves made; null when there are none. */
  preparedGrade: RiskGrade | null;
  prerequisite: { ops: PatchOpDto[]; clears: string[] } | null;
  header: string[];
  approvals: string[];
  scope: string[];
  affected: string[];
  notifications: MopNoticeDto[];
  prechecks: string[];
  steps: MopStepDto[];
  stopConditions: string[];
  backout: MopStepDto[];
  verification: string[];
  /** The engine's second faults for the window: the choices for GET /work-orders/:wonum/replan. */
  contingencies: { id: string; tag: string; kind: EntityKind }[];
}

export interface ThermalPhaseDto {
  label: string;
  coolingKw: number;
  deficitKw: number;
  /** Modeled minutes to the limit at the headline capacitance, and at the ends of its range; null = no deficit. */
  minutes: number | null;
  low: number | null;
  high: number | null;
}

export interface ReplanDto {
  wonum: string;
  fault: string;
  headline: string;
  /** The work plus the fault as what-if events, for the facility view's `e` parameter. */
  scenario: string[];
  countdown: { hall: string; heatKw: number; limitF: number; startF: number; startLabel: string; startAt: string; phases: ThermalPhaseDto[] } | null;
  affected: string[];
  actions: string[];
  parameters: { name: string; value: string; basis: 'record' | 'engine' | 'modeled'; source: string }[];
}

// ───────────────────────────── Operating history ─────────────────────────────

/** Which system logged a record: the building automation system or the electrical power monitoring system. */
export type HistorySystem = 'bms' | 'epms';

/** One event-log row. `phase`: a condition going active, returning to normal, or a one-off (command, acknowledgement, transfer). */
export interface HistoryEventDto {
  system: HistorySystem;
  /** Site-local wall clock to the second or millisecond ("2026-08-24T16:04:12"). */
  at: string;
  /** The point or device name as the system writes it. */
  source: string;
  text: string;
  category: string;
  phase: 'active' | 'normal' | 'instant';
  detail: string | null;
}

/** `entity` is the entity the record is on: the requested one, or one it directly refers to (its feeder breaker, its header). */
export type TimelineEntryDto =
  | { kind: 'event'; at: string; entity: string; event: HistoryEventDto }
  | { kind: 'work-order'; at: string; entity: string; workOrder: WorkOrderDto };

/** One point's samples from one export. */
export interface TrendSeriesDto {
  system: HistorySystem;
  source: string;
  label: string;
  unit: string;
  entity: string;
  samples: { at: string; value: number | null }[];
}

export interface EntityHistoryDto {
  entity: string;
  from: string | null;
  to: string | null;
  timeline: TimelineEntryDto[];
  trends: TrendSeriesDto[];
}

// ───────────────────────────── Customer maintenance notices ─────────────────────────────

/** What the work does to some of one customer's cabinets. `line` is the sentence the notice uses. */
export interface NoticeEffectDto {
  kind: 'loses-power' | 'loses-cooling' | 'loses-feed' | 'second-fault' | 'cooling-margin';
  cabinets: string[];
  cabinetsLabel: string;
  line: string;
}

/** One customer's notice for one work order. `effects: []` means unaffected, and the body says so. */
export interface NoticeDto {
  /** `<wonum>/<customer tag>`. */
  id: string;
  wonum: string;
  customer: string;
  customerName: string;
  effects: NoticeEffectDto[];
  /** Why no honest notice can be sent yet; sending is refused while this is set. */
  blocked: { reason: string; workOrders: WorkOrderDto[] } | null;
  /** The contract's notice clause against the issue date (business days, holidays not known). */
  period: { requiredBusinessDays: number; givenBusinessDays: number; clause: FactDto } | null;
  issuedOn: string;
  subject: string;
  body: string;
  /** Names these exact words; sending must repeat it, so what is sent is what the human approved. */
  contentHash: string;
}

export type NoticeSetDto =
  | { wonum: string; assessed: false; why: string }
  | { wonum: string; assessed: true; notices: NoticeDto[] };

// ───────────────────────────── Shift handoff ─────────────────────────────

/** An alarm threshold configured on a BMS point. */
export interface AlarmLimitDto {
  system: HistorySystem;
  source: string;
  entity: string;
  bound: 'high' | 'low';
  value: number;
  unit: string;
}

export type SiteEventDto = HistoryEventDto & { entity: string };

export type WatchItemDto =
  | { kind: 'limit'; limit: AlarmLimitDto }
  | { kind: 'during-work'; wonum: string; scheduledStart: string | null; scheduledFinish: string | null; text: string; faults: string[] };

export interface HandoffDto {
  /** Site-local time of the brief; work runs to `until` (24 h on), alarms from `since` (12 h back). */
  at: string;
  since: string;
  until: string;
  /** Open work in progress or starting before `until`, each with its assessment. */
  work: { when: 'in-progress' | 'due'; assessment: WorkAssessmentDto }[];
  /** Audit findings that mean redundancy is missing today, with the open work on them. */
  lostRedundancy: { finding: FindingDto; openWork: WorkOrderDto[] }[];
  alarms: {
    recent: SiteEventDto[];
    /** Went active and has no return to normal logged before `at`. */
    standing: SiteEventDto[];
    /** Newest record per system: anything after it is not in the exports. */
    coverage: { system: HistorySystem; latest: string | null }[];
  };
  /** Open work orders waiting on materials (WMATL) or plant conditions (WPCOND). */
  waiting: WorkOrderDto[];
  watch: WatchItemDto[];
  /** Vendor and lead per open job in the brief, as Maximo lists them. */
  calls: { workOrder: WorkOrderDto; vendor: string | null; lead: string | null; ownerGroup: string | null }[];
  subject: string;
  /** The brief as one plain page. */
  text: string;
  contentHash: string;
}

// ───────────────────────────── Outgoing messages ─────────────────────────────

export type MessageKind = 'customer-notice' | 'handoff-brief';

/** What happened to one approved message. `not-sent` is never a send: the email is only on disk. */
export type DeliveryDto =
  | { status: 'sent'; via: 'resend'; providerId: string; deliveredTo: string }
  | { status: 'not-sent'; reason: string; file: string }
  | { status: 'failed'; reason: string };

export interface MessageDto {
  id: string;
  kind: MessageKind;
  /** The notice id (`<wonum>/<customer tag>`) or `handoff/<at>`. */
  ref: string;
  contentHash: string;
  subject: string;
  /** Who the message is for. In this demo every email goes to one configured inbox. */
  intendedFor: string;
  approvedBy: ActorDto;
  at: string;
  delivery: DeliveryDto;
}

export type SendMessageBody =
  | { kind: 'customer-notice'; wonum: string; customer: string; asOf: string; contentHash: string }
  | { kind: 'handoff-brief'; at: string; contentHash: string };

// ───────────────────────────── Scene (3D + 2D view model) ─────────────────────────────

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/**
 * Units: `pos3`/`size3` are a box CENTRE and its size in metres (y up, floor at y = 0).
 * `pos2` is the CENTRE of a one-line node box in pixels (top-left origin, y down); boxes are at most 176x36 px.
 * Cords are not nodes: each cord is a SceneLinkDto whose id is the cord id.
 */
export interface SceneNodeDto {
  id: string;              // == entity id; the selection key for BOTH views
  kind: EntityKind;
  layer: Layer;
  label: string;
  side: Side | null;
  customer: string | null;
  pos3: Vec3;
  size3: Vec3;
  pos2: Vec2;
  /** False for nodes the one-line view does not draw (space layer: halls, rows). */
  in2d: boolean;
  findings: string[];
  placed: 'documented' | 'generated' | 'unplaced';
}

export interface SceneLinkDto {
  /** For a cord link this is the cord's entity id (selectable like a node); otherwise `${from}->${to}`. */
  id: string;
  from: string;
  to: string;
  layer: Layer;
  side: Side | null;
  path3: Vec3[];
  path2: Vec2[];
}

export interface SceneDto {
  revision: string;
  bounds3: { min: Vec3; max: Vec3 };
  /** Bounds of every in2d node box and link path (pixels). */
  bounds2: { min: Vec2; max: Vec2 };
  nodes: SceneNodeDto[];
  links: SceneLinkDto[];
  /** Per cabinet: link ids on each side's path, and the convergence nodes (pulsing). */
  xray: Record<string, { A: string[]; B: string[]; convergence: string[] }>;
}

// ───────────────────────────── Companion ─────────────────────────────

/**
 * What the companion tells the UI to show. Ids are scene node ids ("pdu:PDU-3A", "rpp:RPP-4B",
 * "cabinet:E01") or cord link ids ("cord:D03/B"). `proposal` names a proposal the companion submitted.
 */
export type CompanionAction =
  | { kind: 'switch-off'; id: string }
  | { kind: 'switch-on'; id: string }
  | { kind: 'select'; id: string }
  | { kind: 'highlight'; ids: string[] }
  | { kind: 'proposal'; proposalId: string };

export interface CompanionMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What the facilities manager is looking at: the selected node and the equipment switched off in the view. */
export interface CompanionContext {
  selected: string | null;
  off: string[];
}

export interface CompanionBody {
  /** The conversation so far, oldest first; the last message is the user's. */
  messages: CompanionMessage[];
  context: CompanionContext;
}

export interface CompanionReply {
  /** One or two short plain sentences. */
  reply: string;
  actions: CompanionAction[];
}

/** Workspace change notifications on GET /events (SSE event name == `type`). Sent so clients refetch; they carry no state. */
export type ServerEventDto =
  | { type: 'model-changed'; revision: string }
  | { type: 'proposal-changed'; id: string };

// ───────────────────────────── HTTP route table ─────────────────────────────
// One list of endpoints. The server registers handlers via `registerAll(api, handlers)`, a total map typed against
// this map (missing/extra keys fail the build); frontend/src/lib/api.ts builds its client from the same
// keys. Paths are never restated by hand on either side.

export interface ApiRoutes {
  'GET /model': { query: { view?: ModelView }; body: null; res: ModelSummaryDto };
  'GET /entities/:id': { query: { view?: ModelView }; body: null; res: EntityDto };
  'POST /documents': { query: Record<string, never>; body: { path: string }; res: { revision: string; valuesRead: number; valuesRejected: number } };
  'GET /audit': { query: { view?: ModelView }; body: null; res: AuditDto };
  'GET /scenario': { query: { view?: ModelView; e: string[] }; body: null; res: ScenarioResultDto };
  'GET /exposure': { query: { view?: ModelView; customer?: string }; body: null; res: CustomerExposureDto[] };
  'GET /scene': { query: { view?: ModelView }; body: null; res: SceneDto };
  /**
   * Work orders from the site's CMMS exports, in schedule order. `status=upcoming`: open work whose
   * scheduled start is at or after `asOf` (site-local "YYYY-MM-DDTHH:mm"; default the server clock).
   */
  'GET /work-orders': { query: { status?: 'upcoming'; asOf?: string }; body: null; res: WorkOrderDto[] };
  /**
   * Open work orders scheduled in the 7 days from `asOf` (default the server clock), in schedule
   * order, each with the engine's risk grade on the as-built model.
   */
  'GET /work-orders/assessment': { query: { asOf?: string }; body: null; res: WorkAssessmentDto[] };
  /** A draft method of procedure for one work order, as of `asOf` (notice deadlines; default the server clock). */
  'GET /work-orders/:wonum/mop': { query: { asOf?: string }; body: null; res: MopDto };
  /** A second fault during the work order's window, one of the MOP's `contingencies`: countdown, who is affected, immediate actions. */
  'GET /work-orders/:wonum/replan': { query: { fault: string; asOf?: string }; body: null; res: ReplanDto };
  /**
   * One entity's operating history in [from, to) (site-local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"; either
   * may be omitted): BMS events, power monitoring events and work orders on one timeline, on the entity
   * and on what it directly refers to, plus its trend series clipped to the window.
   */
  'GET /history': { query: { entity: string; from?: string; to?: string }; body: null; res: EntityHistoryDto };
  /** One notice per customer for an open work order, issued `asOf` (site-local; default the server clock). */
  'GET /work-orders/:wonum/notices': { query: { asOf?: string }; body: null; res: NoticeSetDto };
  /** The shift handoff brief at `at` (site-local "YYYY-MM-DDTHH:mm"; default the server clock). */
  'GET /handoff': { query: { at?: string }; body: null; res: HandoffDto };
  'GET /messages': { query: Record<string, never>; body: null; res: MessageDto[] };
  /**
   * Human-only. Recomputes the notice or brief, refuses if it is blocked or its words changed since
   * `contentHash`, then emails it (or writes it to the outbox without an email key) and logs the result.
   */
  'POST /messages': { query: Record<string, never>; body: SendMessageBody; res: MessageDto };
  'POST /plans': { query: { view?: ModelView }; body: { clear: string[] | 'all-fixable'; maxMoves: number; alternatives: number }; res: FixOutcomeDto };
  'GET /proposals': { query: Record<string, never>; body: null; res: ProposalDto[] };
  'POST /proposals': { query: Record<string, never>; body: { base: string; ops: PatchOpDto[]; rationale: string }; res: ProposalDto };
  'POST /proposals/:id/decision': { query: Record<string, never>; body: { type: 'approve' | 'complete' } | { type: 'reject'; reason: string }; res: ProposalDto };
  /**
   * Ask the companion. It answers from the engine (this week's work, what-ifs, the audit, the fix planner,
   * customer notices, the shift handoff) and may submit a fix for human approval; it never approves or sends.
   * A repeated Idempotency-Key replays the first reply.
   */
  'POST /companion': { query: Record<string, never>; body: CompanionBody; res: CompanionReply };
}
export type ApiRouteKey = keyof ApiRoutes;

/**
 * Server-sent event streams, keyed like ApiRoutes; the value is the event payload and each SSE event name is its `type`.
 * - GET /events: model-changed on connect, then every workspace change.
 */
export interface SseRoutes {
  'GET /events': ServerEventDto;
}
export type SseRouteKey = keyof SseRoutes;
