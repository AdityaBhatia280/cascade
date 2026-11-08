// The companion: a thick ring fixed bottom-right on every view. It breathes calmly, and pulses red while
// the week holds a job that takes a customer dark. A click opens a floating panel anchored to it.
// Answers come from POST /companion; their actions drive the screen (switch, select, highlight, propose).

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { CompanionAction, CompanionMessage } from "@cascade/core/contract";
import { api, newIntent } from "@/lib/api";
import { useDecide, useJobs, useProposals, type Job } from "@/lib/queries";
import { drawnOf, labelOf, type Site } from "@/lib/site";
import { uiStore, useUi } from "@/lib/ui";
import { useViewPath } from "@/lib/viewPath";
import { Change } from "./Change";
import { readSiteSearch, type SiteSearch } from "@/routes/site";

type Line =
  | { kind: "say"; role: "user" | "assistant"; text: string }
  | { kind: "act"; tone: "red" | "calm" | "gray"; text: string }
  | { kind: "proposal"; id: string }
  | { kind: "error"; text: string };

const partOfDay = (h: number) => (h < 12 ? "Morning." : h < 18 ? "Afternoon." : "Evening.");

function worstJob(jobs: readonly Job[]): Job | null {
  return jobs.find((j) => j.grade === "highest") ?? jobs.find((j) => j.grade === "high") ?? null;
}

function suggestions(site: Site, jobs: readonly Job[]): string[] {
  const out = ["Is this week safe?"];
  const worst = worstJob(jobs);
  if (!worst) return out;
  out.push(`Fix ${labelOf(site, worst.asset)}`);
  const hit = worst.assessment.reasons.flatMap((r) => r.customers).find((c) => c.customerName);
  if (hit) out.push(`Draft ${hit.customerName.split(" ")[0]} notice`);
  return out;
}

function ProposalLine({ site, id }: { site: Site; id: string }) {
  const { proposals } = useProposals();
  const decide = useDecide();
  const p = proposals.find((x) => x.id === id);
  if (!p) return null;
  const done = p.status !== "pending";
  return (
    <div className={`pc${done ? " done" : ""}`}>
      {p.plan.ops.map((op, i) => (
        <Change key={i} site={site} op={op} />
      ))}
      {done ? (
        <div className="ok">{p.status === "applied" || p.status === "completed" ? "Approved" : p.status === "rejected" ? "Discarded" : "Out of date"}</div>
      ) : (
        <div className="acts">
          <button className={`btn calm${decide.error ? " refused" : ""}`} title={decide.error?.message} disabled={decide.isPending} onClick={() => decide.mutate({ ids: [id], type: "approve" })}>
            Approve
          </button>
          <button className="btn ghost" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [id], type: "reject" })}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

export function Companion({ site }: { site: Site }) {
  const { companionOpen: open, greet } = useUi();
  const { jobs } = useJobs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useRouterState({ select: (s) => s.location });
  const path = useViewPath();
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const msgs = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alert = jobs.some((j) => j.grade === "highest");
  const needing = jobs.filter((j) => j.grade === "highest").length;
  const greeting = `${partOfDay(new Date().getHours())} ${needing === 0 ? "The week looks safe." : needing === 1 ? "One job this week needs you." : `${needing} jobs this week need you.`}`;
  const chips = useMemo(() => suggestions(site, jobs), [site, jobs]);

  useEffect(() => {
    if (!greet) return;
    const t = setTimeout(() => uiStore.set({ greet: false }), 1600);
    return () => clearTimeout(t);
  }, [greet]);
  useEffect(() => {
    msgs.current?.scrollTo({ top: 1e6 });
  }, [lines, busy]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus({ preventScroll: true }), 260);
  }, [open]);

  const siteSearch: SiteSearch = path.startsWith("/site") ? readSiteSearch(location.search as Record<string, unknown>) : {};
  const offNow = (): string[] => {
    if (siteSearch.off) return [siteSearch.off];
    const job = jobs.find((j) => j.wonum === siteSearch.job);
    return job ? [job.asset] : [];
  };

  const apply = (actions: readonly CompanionAction[]): Line[] => {
    const out: Line[] = [];
    const steps: ((s: SiteSearch) => SiteSearch)[] = [];
    for (const a of actions) {
      switch (a.kind) {
        case "switch-off":
          steps.push((s) => ({ ...s, off: a.id, job: undefined, edit: undefined, pick: undefined }));
          out.push({ kind: "act", tone: "red", text: `${labelOf(site, a.id)} off` });
          break;
        case "switch-on":
          steps.push((s) => ({
            ...s,
            off: s.off === a.id ? undefined : s.off,
            job: jobs.find((j) => j.wonum === s.job)?.asset === a.id ? undefined : s.job,
          }));
          out.push({ kind: "act", tone: "gray", text: `${labelOf(site, a.id)} on` });
          break;
        case "select":
          steps.push((s) => ({ ...s, sel: drawnOf(site, a.id) }));
          break;
        case "highlight":
          uiStore.set({ highlight: new Set(a.ids.map((id) => drawnOf(site, id))) });
          out.push({ kind: "act", tone: "calm", text: a.ids.map((id) => labelOf(site, id)).join(" · ") });
          break;
        case "proposal":
          void qc.invalidateQueries({ queryKey: ["GET /proposals"] });
          out.push({ kind: "proposal", id: a.proposalId });
          break;
      }
    }
    if (steps.length) {
      void navigate({
        to: "/site",
        search: (prev: Record<string, unknown>) => steps.reduce((s, step) => step(s), path.startsWith("/site") ? readSiteSearch(prev) : {}),
      });
    }
    return out;
  };

  const ask = async (q: string) => {
    if (busy || !q.trim()) return;
    const history: CompanionMessage[] = lines.flatMap((l) => (l.kind === "say" ? [{ role: l.role, content: l.text }] : []));
    const asked: Line = { kind: "say", role: "user", text: q.trim() };
    setLines((ls) => [...ls, asked]);
    setBusy(true);
    try {
      const r = await api("POST /companion", {
        body: { messages: [...history, { role: "user", content: q.trim() }], context: { selected: siteSearch.sel ?? null, off: offNow() } },
        intent: newIntent(),
      });
      uiStore.set({ highlight: new Set() });
      const acted = apply(r.actions);
      setLines((ls) => [...ls, { kind: "say", role: "assistant", text: r.reply }, ...acted]);
    } catch (e) {
      setLines((ls) => [...ls, { kind: "error", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`co${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="msgs" ref={msgs}>
          <div className="m">{greeting}</div>
          {lines.map((l, i) => {
            switch (l.kind) {
              case "say":
                return (
                  <div key={i} className={`m${l.role === "user" ? " me" : ""}`}>
                    {l.text}
                  </div>
                );
              case "act":
                return (
                  <div key={i} className={`m act ${l.tone}`}>
                    {l.text}
                  </div>
                );
              case "proposal":
                return <ProposalLine key={i} site={site} id={l.id} />;
              case "error":
                return (
                  <div key={i} className="m err">
                    {l.text}
                  </div>
                );
            }
          })}
          {busy && (
            <div className="m typing">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <div className="sugg">
          {chips.map((c) => (
            <button key={c} onClick={() => void ask(c)} disabled={busy}>
              {c}
            </button>
          ))}
        </div>
        <form
          className="inp"
          onSubmit={(e) => {
            e.preventDefault();
            const q = draft;
            setDraft("");
            void ask(q);
          }}
        >
          <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Cascade" autoComplete="off" onKeyDown={(e) => e.stopPropagation()} />
          <button type="submit" aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M7 12V2M2.5 6.5L7 2l4.5 4.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
      <button className={`orb${alert ? " alert" : ""}${open ? " open" : ""}${greet ? " greet" : ""}`} aria-label="Cascade" aria-expanded={open} onClick={() => uiStore.set({ companionOpen: !open })} />
    </>
  );
}
