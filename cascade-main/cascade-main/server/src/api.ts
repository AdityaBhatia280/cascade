// HTTP shell. Every handler: boundary parse → ONE call (Workspace command or Analysis method) →
// toWire → JSON, with `{ error }` and 400/403/404/409. Handlers are a total map typed against
// ApiRoutes, so a route added to the contract fails the build until it is served here.
// Commands read an `Idempotency-Key` header (one per user intent); a repeat replays the result.

import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { addDays, assessWorkOrders, draftMop, parsePatchOps, planOfOps, replan, toWire, upcomingWorkOrders, type FixPlan } from '@cascade/core';
import type { ApiRouteKey, ApiRoutes, ServerEventDto, SseRouteKey } from '@cascade/core/contract';
import { humanFrom, nameOf, type HumanActor } from './actors.js';
import { companion } from './agent/companion.js';
import type { LlmClient } from './agent/llm.js';
import { messageDto, proposalDto } from './dto.js';
import { isError, parseAsOf, parseCompanionBody, parseGoal, parseScenario, parseSendBody, parseView, parseWindow } from './parse.js';
import type { ProposalCommand, ProposalId } from './proposals.js';
import { openSse } from './sse.js';
import type { UploadedFile, Uploads } from './uploads/uploads.js';
import { canonicalJson, type CommandResult, type MessageDraft, type Workspace } from './workspace.js';

type ErrorStatus = 400 | 403 | 404 | 409;
type Reply<K extends ApiRouteKey> = { readonly status: 200; readonly json: ApiRoutes[K]['res'] } | { readonly status: ErrorStatus; readonly json: { readonly error: string } };

interface HandlerInput {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
  readonly human: HumanActor;
  readonly key: string;
  /** Multipart files, for routes that take them. */
  readonly files: readonly UploadedFile[];
}

type Handler<K extends ApiRouteKey> = (input: HandlerInput) => Promise<Reply<K>>;
export type Handlers = { readonly [K in ApiRouteKey]: Handler<K> };

const bad = (error: string) => ({ status: 400 as const, json: { error } });
const notFound = (error: string) => ({ status: 404 as const, json: { error } });
const okJson = <T>(json: T) => ({ status: 200 as const, json });

function fromResult<T, R>(r: CommandResult<T>, map: (v: T) => R): { status: 200; json: R } | { status: ErrorStatus; json: { error: string } } {
  if (r.ok) return { status: 200, json: map(r.value) };
  const status: ErrorStatus = r.code === 'bad-request' ? 400 : r.code === 'not-found' ? 404 : r.code === 'forbidden' ? 403 : 409;
  return { status, json: { error: r.message } };
}

const conflict = (error: string) => ({ status: 409 as const, json: { error } });

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Registers every entry of ApiRoutes under its method and path, behind its body parser when it has its own. */
export function registerAll(api: Router, handlers: Handlers, parsers: Partial<Record<ApiRouteKey, RequestHandler>> = {}): void {
  for (const routeKey of Object.keys(handlers) as ApiRouteKey[]) {
    const [method, routePath] = routeKey.split(' ') as ['GET' | 'POST', string];
    const handler = handlers[routeKey] as Handler<ApiRouteKey>;
    const verb = method === 'GET' ? 'get' : 'post';
    const parse: RequestHandler = parsers[routeKey] ?? ((_req, _res, next) => next());
    api[verb](routePath, parse, (req: Request, res: Response) => {
      const files = Array.isArray(req.files) ? req.files : [];
      const input: HandlerInput = {
        params: req.params as Record<string, string>,
        query: req.query as Record<string, unknown>,
        body: req.body as unknown,
        human: humanFrom(req),
        key: req.header('idempotency-key')?.trim() || `anon:${randomUUID()}`,
        // Browsers send UTF-8 file names; multer decodes them as latin1.
        files: files.map((f) => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), bytes: f.buffer })),
      };
      handler(input).then(
        (r) => res.status(r.status).json(r.json),
        (e: unknown) => {
          console.error(`[cascade] ${routeKey} failed`, e);
          res.status(500).json({ error: 'internal error' });
        },
      );
    });
  }
}

const MAX_KNOWN_PLANS = 500;

const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024, files: 200 } }).array('files');
/** multer, with its refusals (too large, too many, wrong field) as 400s. */
const uploadParser: RequestHandler = (req, res, next) =>
  multipart(req, res, (e: unknown) => (e ? res.status(400).json({ error: `upload refused: ${(e as Error).message}` }) : next()));

/** `now` is the site clock (tests pin it). */
export function apiRouter(ws: Workspace, uploads: Uploads, llm: LlmClient | null, opts: { readonly now?: () => Date } = {}): Router {
  const api = Router();
  const now = opts.now ?? (() => new Date());
  const ask = companion({ ws, llm, now });
  /** Plans this server computed, by (base, ops), so a planner plan keeps its search explanation when submitted. */
  const knownPlans = new Map<string, FixPlan>();
  const planKey = (base: string, ops: unknown) => canonicalJson({ base, ops });

  const viewed = (q: Readonly<Record<string, unknown>>) => {
    const view = parseView(q['view']);
    return isError(view) ? view : { view, an: ws.analysis(view) };
  };

  const handlers: Handlers = {
    'GET /model': async ({ query }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      return okJson(toWire.summary(v.an.facility, v.view));
    },
    'GET /entities/:id': async ({ params, query }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      const id = v.an.facility.parseId(params['id'] ?? '');
      if (!id) return notFound(`no such entity: ${params['id']}`);
      return okJson(toWire.entity(v.an.explain(id), v.an.facility));
    },
    'POST /uploads': async ({ files, human, key }) => {
      if (files.length === 0) return bad("attach one or more files in the multipart field 'files'");
      return okJson(await uploads.start(files, human, key));
    },
    'GET /uploads/:batchId': async ({ params }) => {
      const b = uploads.get(params['batchId'] ?? '');
      return b ? okJson(b) : notFound(`no such upload batch: ${params['batchId']}`);
    },
    'POST /site/reset': async ({ human, key }) => fromResult(await ws.reset(nameOf(human), key), (x) => x),
    'GET /site/status': async () => okJson({ empty: ws.documentCount() === 0, documents: ws.documentCount(), revision: ws.revision() }),
    'GET /audit': async ({ query }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      return okJson(toWire.audit(v.an.audit(), v.an.facility));
    },
    'GET /scenario': async ({ query }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      const s = parseScenario(query['e'], v.an.facility);
      if (isError(s)) return bad(s.error);
      return okJson(toWire.scenario(v.an.whatIf(s), v.an.facility));
    },
    'GET /exposure': async ({ query }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      const raw = query['customer'];
      if (raw === undefined || raw === '') return okJson(toWire.exposure(v.an.exposure(), v.an.facility));
      const id = typeof raw === 'string' ? v.an.facility.parseId(raw, ['customer']) : null;
      if (!id) return notFound(`no such customer: ${String(raw)}`);
      return okJson(toWire.exposure(v.an.exposure(id), v.an.facility));
    },
    'GET /scene': async ({ query }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      return okJson(v.an.scene());
    },
    'GET /work-orders': async ({ query }) => {
      const status = query['status'];
      if (status !== undefined && status !== '' && status !== 'upcoming') return bad("status must be 'upcoming' or absent");
      const asOf = parseAsOf(query['asOf'], now());
      if (isError(asOf)) return bad(asOf.error);
      const orders = status === 'upcoming' ? upcomingWorkOrders(ws.workOrders(), asOf) : ws.workOrders();
      return okJson(orders.map(toWire.workOrder));
    },
    'GET /work-orders/assessment': async ({ query }) => {
      const asOf = parseAsOf(query['asOf'], now());
      if (isError(asOf)) return bad(asOf.error);
      const an = ws.analysis('documented');
      const all = ws.workOrders();
      return okJson(assessWorkOrders(an, upcomingWorkOrders(all, asOf, addDays(asOf, 7)), all).map((x) => toWire.assessment(x, an.facility)));
    },
    'GET /work-orders/:wonum/mop': async ({ params, query }) => {
      const asOf = parseAsOf(query['asOf'], now());
      if (isError(asOf)) return bad(asOf.error);
      const all = ws.workOrders();
      const order = all.find((o) => o.wonum === params['wonum']);
      if (!order) return notFound(`no such work order: ${params['wonum']}`);
      const an = ws.analysis('documented');
      const m = draftMop({ an, order, history: all, site: ws.siteHistory(), asOf });
      return 'why' in m ? { status: 409, json: { error: `cannot draft a MOP for ${order.wonum}: ${m.why}` } } : okJson(toWire.mop(m, an.facility));
    },
    'GET /work-orders/:wonum/replan': async ({ params, query }) => {
      const asOf = parseAsOf(query['asOf'], now());
      if (isError(asOf)) return bad(asOf.error);
      const all = ws.workOrders();
      const order = all.find((o) => o.wonum === params['wonum']);
      if (!order) return notFound(`no such work order: ${params['wonum']}`);
      const an = ws.analysis('documented');
      const fault = typeof query['fault'] === 'string' ? an.facility.parseId(query['fault']) : null;
      if (!fault) return bad(`fault must be an entity id from the MOP's contingencies, e.g. chiller:CH-1`);
      const r = replan({ an, order, history: all, site: ws.siteHistory(), asOf, fault });
      return 'why' in r ? bad(r.why) : okJson(toWire.replan(r));
    },
    'GET /history': async ({ query }) => {
      const raw = query['entity'];
      if (typeof raw !== 'string' || raw === '') return bad('entity is required (an entity id, e.g. chiller:CH-2)');
      const entity = ws.analysis('documented').facility.parseId(raw);
      if (!entity) return notFound(`no such entity: ${raw}`);
      const window = parseWindow(query['from'], query['to']);
      if (isError(window)) return bad(window.error);
      return okJson(toWire.history(ws.history(entity, window)));
    },
    'GET /work-orders/:wonum/notices': async ({ params, query }) => {
      const asOf = parseAsOf(query['asOf'], now());
      if (isError(asOf)) return bad(asOf.error);
      const wonum = params['wonum'] ?? '';
      const set = ws.notices(wonum, asOf);
      if (!set) return notFound(`no such work order: ${wonum}`);
      return okJson(toWire.notices(wonum, set, ws.analysis('documented').facility));
    },
    'GET /handoff': async ({ query }) => {
      const at = parseAsOf(query['at'], now());
      if (isError(at)) return bad(at.error);
      return okJson(toWire.handoff(ws.handoff(at), ws.analysis('documented').facility));
    },
    'GET /messages': async () => okJson(ws.messages().map(messageDto)),
    'POST /messages': async ({ body, human, key }) => {
      const b = parseSendBody(body);
      if (isError(b)) return bad(b.error);
      let draft: MessageDraft;
      if (b.kind === 'customer-notice') {
        const set = ws.notices(b.wonum, b.asOf);
        if (!set) return notFound(`no such work order: ${b.wonum}`);
        if (!set.assessed) return conflict(`Cascade cannot tell who ${b.wonum} affects: ${set.why}`);
        const n = set.notices.find((x) => x.customer === b.customer);
        if (!n) return notFound(`no such customer: ${b.customer}`);
        draft = { kind: b.kind, ref: n.id, contentHash: n.contentHash, subject: n.subject, text: n.body, intendedFor: `${n.customerName} (account ${n.id.split('/')[1]})`, blocked: n.blocked?.reason ?? null };
      } else {
        const brief = ws.handoff(b.at);
        draft = { kind: b.kind, ref: `handoff/${b.at}`, contentHash: brief.contentHash, subject: brief.subject, text: brief.text, intendedFor: `the incoming shift at ${ws.siteId.toUpperCase()}`, blocked: null };
      }
      if (draft.contentHash !== b.contentHash) return conflict('the records changed since this was prepared, so its words changed; prepare it again and review it before sending');
      return fromResult(await ws.send(draft, human, key), messageDto);
    },
    'POST /plans': async ({ query, body }) => {
      const v = viewed(query);
      if (isError(v)) return bad(v.error);
      const goal = parseGoal(body, v.an);
      if (isError(goal)) return bad(goal.error);
      const outcome = v.an.planOutcome(goal);
      for (const p of outcome.plans) knownPlans.set(planKey(p.patch.base, p.patch.ops), p);
      while (knownPlans.size > MAX_KNOWN_PLANS) knownPlans.delete(knownPlans.keys().next().value!);
      return okJson({
        plans: outcome.plans.map(toWire.plan),
        unplanned: outcome.unplanned.map((u) => ({ finding: u.finding, reason: u.reason, detail: u.detail })),
      });
    },
    'GET /proposals': async () => okJson(ws.proposals().map(proposalDto)),
    'POST /proposals': async ({ body, human, key }) => {
      const b = obj(body);
      if (typeof b['base'] !== 'string' || typeof b['rationale'] !== 'string' || b['rationale'].trim() === '') return bad('base and a non-empty rationale are required');
      const an = ws.analysis('planned');
      const ops = parsePatchOps(b['ops'], an.facility);
      if ('error' in ops) return bad(ops.error);
      if (ops.length === 0) return bad('ops must name at least one move');
      // A planner plan, or a human's own edit on the current model, re-audited the same way.
      const plan = knownPlans.get(planKey(b['base'], ops)) ?? (b['base'] === an.facility.revision ? planOfOps(an, ops) : null);
      if (!plan) return conflict(`these moves do not apply to the current model (revision ${an.facility.revision}); refresh and edit again`);
      return fromResult(await ws.submit(plan, b['rationale'], human, key), proposalDto);
    },
    'POST /proposals/:id/decision': async ({ params, body, human, key }) => {
      const b = obj(body);
      let cmd: ProposalCommand;
      if (b['type'] === 'approve' || b['type'] === 'complete') cmd = { type: b['type'] };
      else if (b['type'] === 'reject' && typeof b['reason'] === 'string' && b['reason'].trim() !== '') cmd = { type: 'reject', reason: b['reason'] };
      else return bad("type must be 'approve', 'complete', or 'reject' with a reason");
      return fromResult(await ws.decide((params['id'] ?? '') as ProposalId, cmd, human, key), proposalDto);
    },
    'POST /companion': async ({ body, key }) => {
      const b = parseCompanionBody(body, ws.analysis().facility);
      if (isError(b)) return bad(b.error);
      const r = await ask(b, key);
      return r.ok ? okJson(r.value) : conflict(r.message);
    },
  };
  registerAll(api, handlers, { 'POST /uploads': uploadParser });
  const ssePath = (k: SseRouteKey) => k.slice(k.indexOf(' ') + 1);

  api.get(ssePath('GET /events'), (_req, res) => {
    const out = openSse(res);
    const send = (e: ServerEventDto) => out.send(e.type, e);
    send({ type: 'model-changed', revision: ws.revision() });
    out.onClose(ws.subscribe(send));
    out.onClose(uploads.subscribe(send));
  });

  return api;
}
