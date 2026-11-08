// Procedures: the method of procedure the engine drafts for a job, as a checklist. The current step is
// the first one not ticked; the floor shows what is de-energized by then.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { MopDto, MopStepDto } from "@cascade/core/contract";
import { apiQuery } from "@/lib/api";
import { useFloor, RESTING, type FloorPaint, type Look } from "@/lib/floor";
import { changeOf } from "@/lib/edits";
import { useJobs, useSite } from "@/lib/queries";
import { drawnOf, labelOf, type Site } from "@/lib/site";
import { span } from "@/lib/format";
import { JobsStrip } from "@/components/site/JobsStrip";

export const Route = createFileRoute("/procedures")({
  validateSearch: (raw: Record<string, unknown>): { job?: string } => (typeof raw["job"] === "string" && raw["job"] ? { job: raw["job"] } : {}),
  component: ProceduresView,
});

const PHASES: { phase: MopStepDto["phase"]; label: string }[] = [
  { phase: "prerequisite", label: "Before" },
  { phase: "work", label: "Work" },
  { phase: "back-out", label: "Back out" },
];

const storeKey = (m: MopDto) => `cascade.mop.${m.wonum}.${m.revision}`;
function readChecked(m: MopDto): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storeKey(m)) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

const sides = (s: string) => (s === "none" ? 0 : s.split("+").length);
const toneOf = (before: string, after: string) => (sides(after) === 0 ? "red" : sides(after) < sides(before) ? "amber" : "calm");

function Step({ site, s, done, current, onToggle }: { site: Site; s: MopStepDto; done: boolean; current: boolean; onToggle: () => void }) {
  return (
    <div className={`step${done ? " done" : ""}${current ? " cur" : ""}${s.hold ? " hold" : ""}`} onClick={onToggle}>
      <span className="n">{s.n}</span>
      <input type="checkbox" checked={done} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={`Step ${s.n}`} />
      <div>
        <div className="tx">{s.text.split(" → ")[0]}</div>
        {(s.deenergized.length > 0 || s.reenergized.length > 0 || s.customers.length > 0) && (
          <div className="fx">
            {s.deenergized.map((id) => (
              <span key={id} className="tag red">
                {labelOf(site, id)}
              </span>
            ))}
            {s.reenergized.map((id) => (
              <span key={id} className="tag calm">
                {labelOf(site, id)}
              </span>
            ))}
            {s.customers.map((c) => (
              <span key={c.customer} className={`tag ${toneOf(c.before, c.after)}`}>
                {c.cabinetsLabel} {c.before}→{c.after}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProceduresView() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const { site } = useSite();
  const { jobs } = useJobs();
  const job = jobs.find((j) => j.wonum === s.job) ?? jobs.find((j) => j.grade === "highest") ?? jobs[0] ?? null;
  const mop = useQuery({ ...apiQuery("GET /work-orders/:wonum/mop", { params: { wonum: job?.wonum ?? "" } }), enabled: !!job, staleTime: 60_000 });
  const m = mop.data ?? null;
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => setChecked(m ? readChecked(m) : new Set()), [m]);
  const toggle = (n: number) => {
    if (!m) return;
    const next = new Set(checked);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setChecked(next);
    try {
      localStorage.setItem(storeKey(m), JSON.stringify([...next]));
    } catch {
      // A private window keeps the ticks for this visit only.
    }
  };
  const reset = () => {
    if (!m) return;
    setChecked(new Set());
    try {
      localStorage.removeItem(storeKey(m));
    } catch {
      // Nothing stored where storage is blocked.
    }
  };
  const forward = m?.steps ?? [];
  const current = forward.find((x) => !checked.has(x.n)) ?? null;

  const paint = useMemo((): FloorPaint => {
    if (!site || !m || !job) return RESTING;
    const looks = new Map<string, Look>();
    const upTo = current ? forward.filter((x) => x.n <= current.n) : forward;
    for (const x of upTo) {
      for (const id of x.deenergized) looks.set(drawnOf(site, id), "dark");
      for (const id of x.reenergized) looks.delete(drawnOf(site, id));
    }
    looks.set(job.asset, "serviced");
    const prereq = current?.phase === "prerequisite" ? (m.prerequisite?.ops ?? []) : [];
    return {
      ...RESTING,
      active: true,
      looks,
      origin: job.asset,
      pulse: current ? current.deenergized.map((id) => drawnOf(site, id)) : [],
      pulseTone: "red",
      arcs: prereq.map((op) => changeOf(site, op).arc),
    };
  }, [site, m, job, current, forward]);
  const handlers = useMemo(() => ({}), []);
  useFloor(paint, handlers, { top: 52, right: 444, bottom: 12, left: 12 });
  if (!site) return null;

  return (
    <>
      <JobsStrip site={site} jobs={jobs} active={job?.wonum ?? null} onPick={(w) => void navigate({ search: { job: w } })} />
      <section className="sheet panel mop">
        {job && (
          <h2>
            <span className={`mark ${m?.grade ?? job.grade}`} />
            {labelOf(site, job.asset)}
            <span className="tm">{span(job.start, job.finish)}</span>
          </h2>
        )}
        <div className="bar" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn ghost" onClick={reset} disabled={!m || checked.size === 0}>
            Reset
          </button>
        </div>
        {mop.isError && <div className="empty">{(mop.error as Error).message}</div>}
        {m && (
          <div className="scroll steps">
            {PHASES.map(({ phase, label }) => {
              const list = phase === "back-out" ? m.backout : m.steps.filter((x) => x.phase === phase);
              if (!list.length) return null;
              return (
                <div key={phase}>
                  <div className="sub">{label}</div>
                  {list.map((x) => (
                    <Step key={x.n} site={site} s={x} done={checked.has(x.n)} current={current?.n === x.n} onToggle={() => toggle(x.n)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
