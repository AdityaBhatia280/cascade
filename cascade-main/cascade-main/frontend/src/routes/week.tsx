// Week: this week's jobs on a calendar, one column per day, blocks by scheduled time, coloured by risk
// grade. A click opens the job on Site. Under the calendar, the customer notices of the job in focus,
// each sendable only through the server's approval gate. The floor beside it shows the job in focus.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageDto, NoticeDto, WorkAssessmentDto } from "@cascade/core/contract";
import { api, apiQuery, newIntent } from "@/lib/api";
import { useFloor, RESTING, type FloorPaint, type Look } from "@/lib/floor";
import { impactOf } from "@/lib/impact";
import { useJobs, useScenario, useSite } from "@/lib/queries";
import { labelOf, type Site } from "@/lib/site";
import { hm, localStamp, span } from "@/lib/format";

export const Route = createFileRoute("/week")({ component: WeekView });

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const CAL_H = 300;
const GAP = 20;

/** The week panel's width; the floor takes the rest of the screen beside it. */
const panelWidth = () => Math.round(Math.min(860, Math.max(520, window.innerWidth * 0.52)));

function usePanelWidth(): number {
  const [w, setW] = useState(panelWidth);
  useEffect(() => {
    const on = () => setW(panelWidth());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}
const hours = (t: string) => Number(t.slice(11, 13)) + Number(t.slice(14, 16)) / 60;

const toneOfEffect = (k: NoticeDto["effects"][number]["kind"]) => (k === "loses-power" || k === "loses-cooling" ? "r" : "a");

function NoticeCard({ n, sent }: { n: NoticeDto; sent: MessageDto | undefined }) {
  const qc = useQueryClient();
  const [armed, setArmed] = useState(false);
  const send = useMutation({
    mutationFn: () => api("POST /messages", { body: { kind: "customer-notice", wonum: n.wonum, customer: n.customer, asOf: n.issuedOn, contentHash: n.contentHash }, intent: newIntent() }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["GET /messages"] }),
  });
  const worst = n.effects.some((e) => toneOfEffect(e.kind) === "r") ? "red" : n.effects.length ? "amber" : "";
  const late = n.period && n.period.givenBusinessDays < n.period.requiredBusinessDays;
  const delivered = send.data?.contentHash === n.contentHash ? send.data : sent;
  return (
    <div className="nc">
      <b>
        <i className={`dot ${worst}`} />
        {n.customerName}
      </b>
      {n.effects.length === 0 ? (
        <div className="ef">
          <i className="g" />
          Not affected
        </div>
      ) : (
        n.effects.map((e, i) => (
          <div className="ef" key={i}>
            <i className={toneOfEffect(e.kind)} />
            {e.cabinetsLabel}
          </div>
        ))
      )}
      {n.period && (
        <div className={`days${late ? " late" : ""}`} title={n.period.clause.display ?? undefined}>
          {n.period.givenBusinessDays} / {n.period.requiredBusinessDays} days
        </div>
      )}
      <div className="acts">
        {delivered ? (
          <span className="sent">
            <i className={`dot ${delivered.delivery.status === "failed" ? "red" : "calm"}`} />
            {delivered.delivery.status === "sent" ? "Sent" : delivered.delivery.status === "not-sent" ? "Saved to outbox" : "Failed"}
          </span>
        ) : (
          <>
            <button
              className={`btn ${armed ? "calm" : ""}`}
              disabled={!!n.blocked || send.isPending}
              title={n.blocked?.reason ?? (send.error as Error | null)?.message ?? undefined}
              onClick={() => (armed ? send.mutate() : setArmed(true))}
            >
              {armed ? "Confirm send" : "Send"}
            </button>
            {armed && (
              <button className="btn ghost" onClick={() => setArmed(false)}>
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Notices({ wonum }: { wonum: string }) {
  const notices = useQuery({ ...apiQuery("GET /work-orders/:wonum/notices", { params: { wonum } }), staleTime: 60_000 });
  const messages = useQuery({ ...apiQuery("GET /messages"), staleTime: Infinity });
  const set = notices.data;
  if (notices.isError) return <div className="empty">{(notices.error as Error).message}</div>;
  if (!set) return null;
  if (!set.assessed) return <div className="empty">{set.why}</div>;
  const sentFor = (n: NoticeDto) => [...(messages.data ?? [])].reverse().find((m) => m.ref === n.id && m.contentHash === n.contentHash);
  const ordered = [...set.notices].sort((a, b) => Number(b.effects.length > 0) - Number(a.effects.length > 0));
  return (
    <div className="notices">
      {ordered.map((n) => (
        <NoticeCard key={n.id} n={n} sent={sentFor(n)} />
      ))}
    </div>
  );
}

function Block({ site, a, onOpen, onFocus, focus, top, height }: { site: Site; a: WorkAssessmentDto; onOpen: () => void; onFocus: () => void; focus: boolean; top: number; height: number }) {
  const w = a.workOrder;
  const id = w.asset?.resolved ? w.asset.entity : null;
  return (
    <button
      className={`blk ${a.assessed ? a.grade : "unassessed"}${focus ? " focus" : ""}`}
      style={{ top, height }}
      onClick={onOpen}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      title={w.description}
    >
      <b>{id ? labelOf(site, id) : w.location}</b>
      <span className="tm">
        {hm(w.scheduledStart!)}
        {w.scheduledFinish && height >= 64 ? `–\u200b${hm(w.scheduledFinish)}` : ""}
      </span>
    </button>
  );
}

function WeekView() {
  const { site } = useSite();
  const { jobs, all } = useJobs();
  const navigate = useNavigate();
  const [focusId, setFocusId] = useState<string | null>(null);
  const today = localStamp(new Date()).slice(0, 10);
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
      }),
    [today],
  );
  const scheduled = all.filter((a) => a.workOrder.scheduledStart);
  const busy = new Set(scheduled.map((a) => a.workOrder.scheduledStart!.slice(0, 10)));
  const columns = `44px ${days.map((d) => (busy.has(d) ? "minmax(0, 1fr)" : "30px")).join(" ")}`;
  const starts = scheduled.map((a) => hours(a.workOrder.scheduledStart!));
  const ends = scheduled.map((a) => (a.workOrder.scheduledFinish && a.workOrder.scheduledFinish.slice(0, 10) === a.workOrder.scheduledStart!.slice(0, 10) ? hours(a.workOrder.scheduledFinish) : 24));
  const h0 = Math.max(0, Math.floor(Math.min(6, ...starts)));
  const h1 = Math.min(24, Math.ceil(Math.max(20, ...ends)));
  const y = (h: number) => ((h - h0) / (h1 - h0)) * CAL_H;
  const ticks = Array.from({ length: Math.floor((h1 - h0) / 3) + 1 }, (_, i) => h0 + i * 3);

  const focus = jobs.find((j) => j.wonum === focusId) ?? jobs.find((j) => j.grade === "highest") ?? jobs[0] ?? null;
  const scenario = useScenario(focus?.scenario ?? null);
  const impact = useMemo(() => (focus && scenario.data ? impactOf(scenario.data) : null), [focus, scenario.data]);
  const paint = useMemo((): FloorPaint => {
    if (!focus || !impact) return RESTING;
    const looks = new Map<string, Look>(impact.states);
    looks.set(focus.asset, "serviced");
    return { ...RESTING, active: true, looks, origin: focus.asset, cables: true, pulse: [focus.asset], pulseTone: impact.grade };
  }, [focus, impact]);
  const handlers = useMemo(() => ({}), []);
  const width = usePanelWidth();
  useFloor(paint, handlers, { top: 12, right: 12, bottom: 12, left: width + GAP * 2 });
  if (!site) return null;

  const open = (wonum: string) => void navigate({ to: "/site", search: { job: wonum } });
  return (
    <section className="sheet panel week" style={{ width }}>
      <div className="cal" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((d) => (
          <div key={d} className={`dh${d === today ? " today" : ""}${busy.has(d) ? "" : " quiet"}`}>
            {busy.has(d) && DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]}
            <small>{Number(d.slice(8, 10))}</small>
          </div>
        ))}
        <div className="hours" style={{ height: CAL_H }}>
          {ticks.map((t) => (
            <span key={t} style={{ top: y(t) }}>
              {String(t).padStart(2, "0")}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="col" style={{ height: CAL_H }}>
            {scheduled
              .filter((a) => a.workOrder.scheduledStart!.slice(0, 10) === d)
              .map((a) => {
                const w = a.workOrder;
                const s0 = hours(w.scheduledStart!);
                const s1 = w.scheduledFinish && w.scheduledFinish.slice(0, 10) === d ? hours(w.scheduledFinish) : 24;
                const job = jobs.find((j) => j.wonum === w.wonum);
                const height = Math.max(44, y(s1) - y(s0) - 2);
                return (
                  <Block
                    key={w.wonum}
                    site={site}
                    a={a}
                    top={Math.min(y(s0), CAL_H - height)}
                    height={height}
                    focus={focus?.wonum === w.wonum}
                    onFocus={() => job && setFocusId(w.wonum)}
                    onOpen={() => (job ? open(w.wonum) : undefined)}
                  />
                );
              })}
          </div>
        ))}
        {ticks.map((t) => (
          <div key={t} className="gl" style={{ top: y(t) + 26 }} />
        ))}
      </div>
      {focus && (
        <>
          <h2 style={{ marginTop: 16 }}>
            <span className={`mark ${focus.grade}`} />
            {labelOf(site, focus.asset)}
            <span className="tm">{span(focus.start, focus.finish)}</span>
          </h2>
          <Notices wonum={focus.wonum} />
        </>
      )}
    </section>
  );
}
