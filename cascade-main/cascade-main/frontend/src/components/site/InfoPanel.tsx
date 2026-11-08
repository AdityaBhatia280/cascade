import { useRef, useState } from "react";
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

/** The floating panel: which cabinets go dark or lose backup, whose, the way to a fix, and, folded away, what it costs a month. */
export function InfoPanel({ site, impact, name, window, grade, shift, onScrub, fix }: InfoProps) {
  const hit = new Map(impact?.customers.map((c) => [c.id, c]) ?? []);
  const [money, setMoney] = useState(false);
  const fold = useRef<HTMLDivElement>(null);
  if (!impact && site.customerOrder.length === 0) return null;
  const toggle = () => {
    setMoney(!money);
    if (!money) setTimeout(() => fold.current?.scrollIntoView({ block: "end", behavior: "smooth" }), 230);
  };
  return (
    <aside className={`info panel${shift ? " shift" : ""}`}>
      {impact && name && (
        <>
          <div className="who">
            <span className={`mark ${grade ?? markOf(impact)}`} />
            <span className="nm">{name}</span>
            {window && <span className="tm">{window}</span>}
          </div>
          <div className={`num ${impact.darkCabinets > 0 ? "red" : "gray"}`}>
            {impact.darkCabinets}
            <small>{plural(impact.darkCabinets, "cabinet")} dark</small>
          </div>
          <div className="counts">
            <span className="cb">
              <i />
              <b>{impact.backupCabinets}</b> losing backup
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
              <span className="cn">
                {c.name}
                {h?.dark && <small className="cd">{h.dark.label} dark</small>}
                {h?.backup && <small className="cb">{h.backup.label} losing backup</small>}
              </span>
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
      {impact && impact.customers.length > 0 && (
        <div ref={fold} className={`money${money ? " open" : ""}`}>
          <button className="toggle" aria-expanded={money} onClick={toggle}>
            Revenue
            <i />
          </button>
          <div className="fold">
            <div>
              <div className="tot cd">
                Dark<b>{usd(impact.darkRevenue)}/mo</b>
              </div>
              <div className="tot cb">
                Losing backup<b>{usd(impact.backupRevenue)}/mo</b>
              </div>
              {impact.customers.map((h) => (
                <div key={h.id} className="row">
                  <span>{h.name}</span>
                  <em className="cd">{h.dark && usd(h.dark.usd)}</em>
                  <em className="cb">{h.backup && usd(h.backup.usd)}</em>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
