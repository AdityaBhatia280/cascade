import type { ProposalDto } from "@cascade/core/contract";
import { useDecide } from "@/lib/queries";
import { plural } from "@/lib/format";
import type { Site } from "@/lib/site";
import type { Insets } from "@/lib/floor";
import { Change } from "../Change";

/** Changes waiting for approval, floating over the floor, with one Approve and one Discard for all. */
export function PendingBar({ site, pending, insets }: { site: Site; pending: readonly ProposalDto[]; insets: Insets }) {
  const decide = useDecide();
  if (!pending.length) return null;
  const ops = pending.flatMap((p) => p.plan.ops);
  const all = (type: "approve" | "reject") => decide.mutate({ ids: pending.map((p) => p.id), type });
  const refused = decide.error?.message;
  return (
    <div
      className="tray"
      style={{ left: `calc(${insets.left}px + (100% - ${insets.left + insets.right}px) / 2)`, maxWidth: `calc(100% - ${insets.left + insets.right + 24}px)` }}
    >
      <span className="ttl">
        {ops.length} {plural(ops.length, "change")} waiting for approval
      </span>
      <span className="items">
        {ops.map((op, i) => (
          <Change key={i} site={site} op={op} />
        ))}
      </span>
      <button className={`btn calm${refused ? " refused" : ""}`} title={refused} disabled={decide.isPending} onClick={() => all("approve")}>
        Approve
      </button>
      <button className="btn ghost" disabled={decide.isPending} onClick={() => all("reject")}>
        Discard
      </button>
    </div>
  );
}
