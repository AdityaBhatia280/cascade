// Handoff: the floor at a chosen moment for the incoming shift. Cabinets running without backup are
// tinted, active alarms sit as dots on their equipment, jobs in progress are in ink.

import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { HandoffDto, WorkAssessmentDto } from "@cascade/core/contract";
import { apiQuery } from "@/lib/api";
import { useFloor, RESTING, type FloorPaint, type Look } from "@/lib/floor";
import { useSite } from "@/lib/queries";
import { drawnOf, labelOf, type Site } from "@/lib/site";
import { localStamp, plural, span, when } from "@/lib/format";

export const Route = createFileRoute("/handoff")({
  validateSearch: (raw: Record<string, unknown>): { at?: string } =>
    typeof raw["at"] === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw["at"]) ? { at: raw["at"] } : {},
  component: HandoffView,
});

const assetOf = (a: WorkAssessmentDto) => (a.workOrder.asset?.resolved ? a.workOrder.asset.entity : null);
const gradeDot = (a: WorkAssessmentDto) => (!a.assessed ? "" : a.grade === "highest" ? "red" : a.grade === "high" ? "amber" : a.grade === "medium" ? "ring" : "");

/** Customers whose cabinets run without backup at the handoff, with those cabinets. */
function withoutBackup(site: Site, h: HandoffDto) {
  const cabs = new Set(h.lostRedundancy.flatMap((x) => x.finding.affected.flatMap((i) => i.cabinets)));
  const byCustomer = new Map<string, string[]>();
  for (const c of cabs) {
    const owner = site.node.get(c)?.customer;
    if (owner) byCustomer.set(owner, [...(byCustomer.get(owner) ?? []), c]);
  }
  return { cabs, byCustomer };
}

function HandoffView() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const { site } = useSite();
  const at = s.at ?? localStamp(new Date());
  const q = useQuery({ ...apiQuery("GET /handoff", { query: { at } }), staleTime: 60_000, placeholderData: (prev) => prev });
  const h = q.data ?? null;

  const paint = useMemo((): FloorPaint => {
    if (!site || !h) return RESTING;
    const looks = new Map<string, Look>();
    for (const c of withoutBackup(site, h).cabs) looks.set(c, "backup");
    const inProgress: string[] = [];
    for (const w of h.work) {
      const id = assetOf(w.assessment);
      if (!id) continue;
      const box = drawnOf(site, id);
      if (w.when === "in-progress") {
        looks.set(box, "serviced");
        inProgress.push(box);
      } else if (!looks.has(box)) looks.set(box, "lit");
    }
    const dots = [
      ...h.alarms.standing.map((e) => ({ id: drawnOf(site, e.entity), tone: "red" as const })),
      ...h.alarms.recent.filter((e) => e.phase !== "normal").map((e) => ({ id: drawnOf(site, e.entity), tone: "amber" as const })),
    ];
    return { ...RESTING, active: true, looks, pulse: inProgress, pulseTone: "gray", dots };
  }, [site, h]);
  const handlers = useMemo(() => ({}), []);
  useFloor(paint, handlers, { top: 12, right: 364, bottom: 12, left: 12 });
  if (!site) return null;

  const wb = h ? withoutBackup(site, h) : null;
  const alarms = h ? [...h.alarms.standing.map((e) => ({ e, tone: "red" })), ...h.alarms.recent.filter((e) => e.phase !== "normal").map((e) => ({ e, tone: "amber" }))] : [];
  return (
    <>
      <section className="sheet panel handoff">
        <h2>Handoff</h2>
        <div className="bar">
          <input type="datetime-local" value={at} onChange={(e) => e.target.value && void navigate({ search: { at: e.target.value }, replace: true })} />
        </div>
        {q.isError && <div className="empty">{(q.error as Error).message}</div>}
        {h && wb && (
          <div className="scroll">
            <div className="stat">
              <div>
                <b>{wb.cabs.size}</b>
                <span>
                  <i className="dot ring" />
                  {plural(wb.cabs.size, "cabinet")}
                </span>
              </div>
              <div>
                <b>{alarms.length}</b>
                <span>
                  <i className="dot red" />
                  {plural(alarms.length, "alarm")}
                </span>
              </div>
              <div>
                <b>{h.work.length}</b>
                <span>
                  <i className="dot ink" />
                  {plural(h.work.length, "job")}
                </span>
              </div>
            </div>
            {h.work.length > 0 && <div className="sub">Jobs</div>}
            {h.work.map((w) => {
              const id = assetOf(w.assessment);
              const wo = w.assessment.workOrder;
              return (
                <div className="row" key={wo.wonum} title={wo.description}>
                  <i className={`dot ${w.when === "in-progress" ? "ink" : gradeDot(w.assessment)}`} />
                  <b>{id ? labelOf(site, id) : wo.location}</b>
                  {w.when === "in-progress" && <span className="tag">Now</span>}
                  <span className="tm">{wo.scheduledStart ? span(wo.scheduledStart, wo.scheduledFinish) : ""}</span>
                </div>
              );
            })}
            {alarms.length > 0 && <div className="sub">Alarms</div>}
            {alarms.map(({ e, tone }, i) => (
              <div className="row" key={i} title={e.text}>
                <i className={`dot ${tone}`} />
                <b>{labelOf(site, drawnOf(site, e.entity))}</b>
                <span className="tm">{when(e.at)}</span>
              </div>
            ))}
            {wb.byCustomer.size > 0 && <div className="sub">Without backup</div>}
            {site.customerOrder
              .filter((c) => wb.byCustomer.has(c))
              .map((c) => (
                <div className="row" key={c}>
                  <i className="dot ring" />
                  {site.customers.get(c)!.name}
                  <span className="tm">{wb.byCustomer.get(c)!.length}</span>
                </div>
              ))}
          </div>
        )}
      </section>
    </>
  );
}
