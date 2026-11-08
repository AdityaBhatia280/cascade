import type { PatchOpDto } from "@cascade/core/contract";
import { changeOf } from "@/lib/edits";
import type { Site } from "@/lib/site";

export const LeftArrow = () => (
  <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
    <path d="M13 5H2M5.5 1.5L2 5l3.5 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const RightArrow = () => (
  <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
    <path d="M1 5h11M8.5 1.5L12 5 8.5 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One move: what changes, its old feed struck through, its new feed in the calm accent. */
export function Change({ site, op }: { site: Site; op: PatchOpDto }) {
  const c = changeOf(site, op);
  return (
    <span className="chg">
      {c.subject}
      {c.side && <span className="side">{c.side}</span>}
      {c.from && <s>{c.from}</s>}
      <RightArrow />
      <span className="to">{c.to}</span>
    </span>
  );
}
