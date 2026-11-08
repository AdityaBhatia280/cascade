// The model's tools: thin adapters over ops.ts. Each parses the model's arguments (equipment by tag),
// calls one operation, and returns compact JSON in operator words (tags and customer names, no
// internal ids) plus the view actions the operation implies. No tool computes a fact itself.
//
// Deliberately absent: approve, reject, complete and send. Those Workspace commands take a HumanActor,
// which only `humanFrom(req)` can mint, and no tool ever sees a request. submit_fix submits planner
// output only: it runs the planner itself, so the model never authors a patch.

import type { AnyId } from '@cascade/core';
import { RISK_GRADES, type CompanionAction } from '@cascade/core/contract';
import { isError, type Parsed } from '../parse.js';
import type { ToolSchema } from './llm.js';
import { auditTop, draftNotices, handoff, inspect, names, planFix, submitFix, weekCheck, whatIf, type Done, type FixDraft, type Turn, type Who } from './ops.js';

export interface ToolResult {
  readonly ok: boolean;
  /** What the model sees, capped at SUMMARY_LIMIT characters. */
  readonly json: string;
  readonly actions: readonly CompanionAction[];
}

interface Tool {
  readonly schema: ToolSchema;
  run(t: Turn, args: Readonly<Record<string, unknown>>): Promise<ToolResult> | ToolResult;
}

export const SUMMARY_LIMIT = 4000;

const cap = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length <= SUMMARY_LIMIT ? s : `${s.slice(0, SUMMARY_LIMIT - 20)}…(truncated)`;
};
const ok = <T>(d: Done<T>, view: (v: T) => unknown = (v) => v): ToolResult => ({ ok: true, json: cap(view(d.value)), actions: d.actions });
const fail = (error: string): ToolResult => ({ ok: false, json: cap({ error }), actions: [] });

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;
const tag = (description: string) => ({ type: 'string', description });
const tags = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const entity = (t: Turn, raw: unknown): Parsed<AnyId> => {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'an equipment tag is required, e.g. "PDU-3A"' };
  return names(t.ws.analysis('planned').facility).entity(raw) ?? { error: `no equipment is tagged ${JSON.stringify(raw)}` };
};
const entities = (t: Turn, raw: unknown): Parsed<AnyId[]> => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: 'expected an array of tags' };
  const out: AnyId[] = [];
  for (const x of raw) {
    const id = entity(t, x);
    if (isError(id)) return id;
    out.push(id);
  }
  return out;
};

/** Customers as the model may repeat them: "Halcyon Health Partners E01–E05". */
const who = (ws: readonly Who[]) => ws.map((w) => `${w.name} ${w.label}`);

const fixView = (d: FixDraft) => {
  switch (d.kind) {
    case 'clear':
      return { equipment: d.equipment, result: 'no cabinet loses power with it off; nothing to fix' };
    case 'no-plan':
      return { equipment: d.equipment, result: 'no cord or feeder move keeps these cabinets powered', losePower: who(d.down) };
    case 'plan':
      return { equipment: d.equipment, losePowerToday: who(d.down), moves: d.moves, clears: d.clears, stillLosePowerAfterFix: who(d.stillDown) };
  }
};

const week_check = {
  schema: { name: 'week_check', description: "This week's scheduled maintenance, each job graded on the as-built model, plus the riskiest job. Shows the riskiest job's equipment switched off.", parameters: NO_ARGS },
  run: (t) =>
    ok(weekCheck(t), (v) => ({
      riskiest: v.riskiest?.wonum ?? null,
      jobs: v.jobs.map((j) => ({ job: j.wonum, what: j.what, when: j.when, equipment: j.equipment, risk: j.grade ? RISK_GRADES[j.grade] : 'not assessed', headline: j.headline, who: who(j.worst?.who ?? []) })),
    })),
} satisfies Tool;

const what_if = {
  schema: {
    name: 'what_if',
    description: 'Simulate equipment failing, together with whatever the view already has switched off. Shows it switched off.',
    parameters: { type: 'object', properties: { equipment: tags('Equipment tags, e.g. ["PDU-3A"]') }, required: ['equipment'] },
  },
  run: (t, a) => {
    const ids = entities(t, a['equipment']);
    if (isError(ids)) return fail(ids.error);
    if (ids.length === 0 && t.off.length === 0) return fail('name at least one piece of equipment');
    return ok(whatIf(t, ids), (v) => ({ off: v.off, losePower: who(v.down), onLastFeed: who(v.exposed), recordsCannotSay: who(v.unknown), monthlyRevenueUsd: { losePower: v.revenueUsd.down, onLastFeed: v.revenueUsd.exposed, recordsCannotSay: v.revenueUsd.unknown } }));
  },
} satisfies Tool;

const audit = {
  schema: { name: 'audit', description: 'Redundancy gaps in the model today, biggest revenue at risk first.', parameters: NO_ARGS },
  run: (t) => ok(auditTop(t), (v) => ({ total: v.total, top: v.top.map((x) => ({ gap: x.title, affects: who(x.who), revenueAtRiskUsdPerMonth: x.revenueUsd })) })),
} satisfies Tool;

const plan_fix = {
  schema: {
    name: 'plan_fix',
    description: 'Preview the fewest cord and feeder moves that keep every cabinet powered with this equipment off. Submits nothing.',
    parameters: { type: 'object', properties: { equipment: tag('Equipment tag, e.g. "PDU-3A"') }, required: ['equipment'] },
  },
  run: (t, a) => {
    const id = entity(t, a['equipment']);
    return isError(id) ? fail(id.error) : ok(planFix(t, id), fixView);
  },
} satisfies Tool;

const submit_fix = {
  schema: {
    name: 'submit_fix',
    description: 'Plan the fix for this equipment and submit it for human approval. A person approves it in the UI; you cannot.',
    parameters: { type: 'object', properties: { equipment: tag('Equipment tag, e.g. "PDU-3A"') }, required: ['equipment'] },
  },
  run: async (t, a) => {
    const id = entity(t, a['equipment']);
    if (isError(id)) return fail(id.error);
    const r = await submitFix(t, id);
    return ok(r, (v) => ({ ...fixView(v.draft), submitted: v.proposalId !== null, status: 'status' in v ? v.status : null, error: 'error' in v ? v.error : null }));
  },
} satisfies Tool;

const draft_notices = {
  schema: {
    name: 'draft_notices',
    description: "Draft customer maintenance notices for a job. Give a job number, an equipment tag, or a customer name; with none, this week's riskiest job. Drafts only: a person reviews and sends.",
    parameters: { type: 'object', properties: { job: tag('Work order number, e.g. "WO-26-1230"'), equipment: tag('Equipment tag'), customer: tag('Customer name') } },
  },
  run: (t, a) => {
    const n = names(t.ws.analysis('documented').facility);
    let target: Parameters<typeof draftNotices>[1] = null;
    if (typeof a['job'] === 'string' && a['job'].trim() !== '') target = { wonum: a['job'].trim().toUpperCase() };
    else if (typeof a['equipment'] === 'string' && a['equipment'].trim() !== '') {
      const id = entity(t, a['equipment']);
      if (isError(id)) return fail(id.error);
      target = { equipment: id };
    } else if (typeof a['customer'] === 'string' && a['customer'].trim() !== '') {
      const c = n.customerIn(a['customer']);
      if (!c) return fail(`no customer matches ${JSON.stringify(a['customer'])}`);
      target = { customer: c };
    }
    return ok(draftNotices(t, target), (v) =>
      v.kind === 'none' ? { drafted: false, why: v.why } : { drafted: true, job: v.job.wonum, what: v.job.what, when: v.job.when, notices: v.notices.map((x) => ({ customer: x.name, cabinets: x.label, effects: x.effects, readyForReview: x.blocked === null, blocked: x.blocked })) },
    );
  },
} satisfies Tool;

const shift_handoff = {
  schema: { name: 'shift_handoff', description: 'The shift handoff brief now: work in progress or due in 24 h, redundancy lost, jobs waiting, standing alarms.', parameters: NO_ARGS },
  run: (t) => ok(handoff(t)),
} satisfies Tool;

const look_up = {
  schema: {
    name: 'look_up',
    description: 'Facts about one piece of equipment, cabinet or customer, and what it feeds. Selects it in the view.',
    parameters: { type: 'object', properties: { equipment: tag('Tag, e.g. "RPP-4B" or "E01"') }, required: ['equipment'] },
  },
  run: (t, a) => {
    const id = entity(t, a['equipment']);
    return isError(id) ? fail(id.error) : ok(inspect(t, id));
  },
} satisfies Tool;

const show = {
  schema: {
    name: 'show',
    description: 'Point at things in the view: select one, highlight some, switch equipment off or back on. Changes nothing real.',
    parameters: { type: 'object', properties: { select: tag('Tag to select'), highlight: tags('Tags to highlight'), switchOff: tags('Tags to show switched off'), switchOn: tags('Tags to show back on') } },
  },
  run: (t, a) => {
    const actions: CompanionAction[] = [];
    if (a['select'] !== undefined) {
      const id = entity(t, a['select']);
      if (isError(id)) return fail(id.error);
      actions.push({ kind: 'select', id });
    }
    for (const [field, kind] of [['switchOff', 'switch-off'], ['switchOn', 'switch-on']] as const) {
      const ids = entities(t, a[field]);
      if (isError(ids)) return fail(ids.error);
      for (const id of ids) actions.push({ kind, id });
    }
    const hl = entities(t, a['highlight']);
    if (isError(hl)) return fail(hl.error);
    if (hl.length > 0) actions.push({ kind: 'highlight', ids: hl });
    return { ok: true, json: cap({ shown: actions.length }), actions };
  },
} satisfies Tool;

/** The single registry: the model's tool list is derived from it, never restated. */
export const TOOLS: Readonly<Record<string, Tool>> = { week_check, what_if, audit, plan_fix, submit_fix, draft_notices, shift_handoff, look_up, show };
