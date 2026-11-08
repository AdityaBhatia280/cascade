import type { Job } from "@/lib/queries";
import { labelOf, type Site } from "@/lib/site";
import { when } from "@/lib/format";

/** This week's jobs as chips: a dot by risk grade, the equipment, the day and start time. */
export function JobsStrip({ site, jobs, active, onPick }: { site: Site; jobs: readonly Job[]; active: string | null; onPick: (wonum: string) => void }) {
  return (
    <div className="chips">
      {jobs.map((j) => (
        <button key={j.wonum} className={`chip${j.wonum === active ? " on" : ""}`} onClick={() => onPick(j.wonum)}>
          <span className={`mark ${j.grade}`} />
          <span className="nm">{labelOf(site, j.asset)}</span>
          <span className="tm">{when(j.start)}</span>
        </button>
      ))}
    </div>
  );
}
