import type { RiskGrade } from "@cascade/core/contract";
import type { Impact } from "@/lib/impact";
import type { Site } from "@/lib/site";
import { plural, usd } from "@/lib/format";

export interface InfoProps {
  site: Site;
  impact: Impact | null;
  /** The headline: equipment switched off, and the job window when it is a scheduled job. */
  name: string | null;
  window: string | null;
  /** The job's own grade while nothing else has changed. */
  grade: RiskGrade | null;
  shift: boolean;
  onScrub: (i: number) => void;
  fix: { label: string; disabled: boolean; run: () => void } | null;
}

const markOf = (impact: Impact): RiskGrade => (impact.grade === "red" ? "highest" : impact.grade === "amber" ? "high" : "low");

/** The floating panel: what goes dark, whose, what it costs a month, and the way to a fix. */
export function InfoPanel({ site, impact, name, window, grade, shift, onScrub, fix }: InfoProps) {
  const hit = new Map(impact?.customers.map((c) => [c.id, c]) ?? []);
  return (
    <aside className={`info panel${shift ? " shift" : ""}`}>
      {impact && name && (
        <>
          <div className="who">
            <span className={`mark ${grade ?? markOf(impact)}`} />
            <span className="nm">{name}</span>
            {window && <span className="tm">{window}</span>}
          </div>
          <div className={`num ${impact.darkRevenue > 0 ? "red" : "gray"}`}>
            {usd(impact.darkRevenue)}
            <small>/mo</small>
          </div>
          <div className="counts">
            <span className="cd">
              <i />
              <b>{impact.dark}</b> {plural(impact.dark, "customer")} dark
              {impact.dark > 0 && <em>{usd(impact.darkRevenue)}</em>}
            </span>
            <span className="cb">
              <i />
              <b>{impact.backup}</b> losing backup
              {impact.backup > 0 && <em>{usd(impact.backupRevenue)}</em>}
            </span>
          </div>
          {impact.times.length > 1 && (
            <div className="scrub">
              <div className="track">
                <div className="fill" style={{ width: `${(impact.at / (impact.times.length - 1)) * 100}%` }} />
                {impact.times.map((t, i) => (
                  <button
                    key={t}
                    className={`tick${i <= impact.at ? " on" : ""}${i === impact.at ? " cur" : ""}`}
                    style={{ left: `${(i / (impact.times.length - 1)) * 100}%` }}
                    onClick={() => onScrub(i)}
                  >
                    <i />
                    <span>{t === 0 ? "0" : `+${Math.round(t)} min`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <div className="legend">
        {site.customerOrder.map((id) => {
          const c = site.customers.get(id)!;
          const h = hit.get(id);
          const sw = !impact
            ? { background: c.tint[0], boxShadow: `inset 0 0 0 1px ${c.tint[1]}` }
            : h
              ? h.state === "dark"
                ? { background: "var(--red)" }
                : { background: "transparent", boxShadow: "inset 0 0 0 2.5px var(--amber)" }
              : { background: "#e3e6e9" };
          return (
            <div key={id} className={impact && !h ? "fade" : ""}>
              <span className="sw" style={sw} />
              {c.name}
              {h && <span className="rk">{usd(h.risk)}</span>}
            </div>
          );
        })}
      </div>
      {impact && fix && (
        <div className="cta">
          <button disabled={fix.disabled} onClick={fix.run}>
            {fix.label}
          </button>
        </div>
      )}
    </aside>
  );
}
