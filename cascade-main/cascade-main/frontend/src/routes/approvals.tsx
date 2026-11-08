// Approvals: changes waiting for a human, each as the moves it makes on the equipment, with Approve and
// Reject; then the recent decisions. Hovering a change draws it on the floor.

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ActorDto, ProposalDto } from "@cascade/core/contract";
import { useFloor, RESTING, type FloorPaint } from "@/lib/floor";
import { changeOf } from "@/lib/edits";
import { useDecide, useProposals, useSite } from "@/lib/queries";
import type { Site } from "@/lib/site";
import { Change } from "@/components/Change";

export const Route = createFileRoute("/approvals")({ component: ApprovalsView });

const STATUS = { applied: "Approved", completed: "Complete", rejected: "Rejected", stale: "Out of date", pending: "Waiting" } as const;
const who = (a: ActorDto) => (a.kind === "human" ? a.name : "Cascade");
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const decidedAt = (p: ProposalDto) => p.history.at(-1)?.at ?? "";

function ProposalCard({ site, p, focus, onFocus }: { site: Site; p: ProposalDto; focus: boolean; onFocus: (id: string | null) => void }) {
  const decide = useDecide();
  const last = p.history.at(-1)!;
  const waiting = p.status === "pending";
  return (
    <div className={`pcard${waiting ? "" : " past"}${focus ? " focus" : ""}`} onMouseEnter={() => onFocus(p.id)} onMouseLeave={() => onFocus(null)}>
      {p.plan.ops.map((op, i) => (
        <Change key={i} site={site} op={op} />
      ))}
      <div className="meta">
        {!waiting && <span className={`status ${p.status}`}>{STATUS[p.status]}</span>}
        <span>{who(waiting ? p.submittedBy : last.by)}</span>
        <span>{stamp(last.at)}</span>
      </div>
      {waiting && (
        <div className="acts">
          <button className={`btn calm${decide.error ? " refused" : ""}`} title={decide.error?.message} disabled={decide.isPending} onClick={() => decide.mutate({ ids: [p.id], type: "approve" })}>
            Approve
          </button>
          <button className="btn ghost" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [p.id], type: "reject" })}>
            Reject
          </button>
        </div>
      )}
      {p.status === "applied" && (
        <div className="acts">
          <button className={`btn${decide.error ? " refused" : ""}`} title={decide.error?.message} disabled={decide.isPending} onClick={() => decide.mutate({ ids: [p.id], type: "complete" })}>
            Complete
          </button>
        </div>
      )}
    </div>
  );
}

function ApprovalsView() {
  const { site } = useSite();
  const { proposals, pending } = useProposals();
  const [focus, setFocus] = useState<string | null>(null);
  const recent = useMemo(() => proposals.filter((p) => p.status !== "pending").sort((a, b) => (decidedAt(a) < decidedAt(b) ? 1 : -1)).slice(0, 12), [proposals]);

  const shown = focus ? proposals.filter((p) => p.id === focus) : pending;
  const paint = useMemo((): FloorPaint => {
    if (!site) return RESTING;
    const changes = shown.flatMap((p) => p.plan.ops.map((op) => changeOf(site, op)));
    return { ...RESTING, arcs: changes.map((c) => c.arc), highlight: new Set(changes.map((c) => c.arc.to)) };
  }, [site, shown]);
  const handlers = useMemo(() => ({}), []);
  useFloor(paint, handlers, { top: 12, right: 444, bottom: 12, left: 12 });
  if (!site) return null;

  return (
    <section className="sheet panel appr">
      <h2>
        Approvals
        {pending.length > 0 && <span className="tm">{pending.length}</span>}
      </h2>
      <div className="scroll">
        <div className="sub" style={{ marginTop: 14 }}>Waiting</div>
        {pending.length === 0 && <div className="empty">None</div>}
        {pending.map((p) => (
          <ProposalCard key={p.id} site={site} p={p} focus={focus === p.id} onFocus={setFocus} />
        ))}
        {recent.length > 0 && <div className="sub">Recent</div>}
        {recent.map((p) => (
          <ProposalCard key={p.id} site={site} p={p} focus={focus === p.id} onFocus={setFocus} />
        ))}
      </div>
    </section>
  );
}
