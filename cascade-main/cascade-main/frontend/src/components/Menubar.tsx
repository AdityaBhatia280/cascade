// The slim top bar: the Cascade mark, and the views as one segmented control whose white indicator
// slides to the active view. Keys 1 to 5 switch views.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useProposals } from "@/lib/queries";

export const VIEWS = [
  { to: "/site", label: "Site" },
  { to: "/week", label: "Week" },
  { to: "/handoff", label: "Handoff" },
  { to: "/procedures", label: "Procedures" },
  { to: "/approvals", label: "Approvals" },
] as const;

export function Menubar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { pending } = useProposals();
  const seg = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const active = VIEWS.findIndex((v) => path.startsWith(v.to));

  useLayoutEffect(() => {
    const measure = () => {
      const a = seg.current?.querySelectorAll("a")[active];
      if (a) setInd({ x: a.offsetLeft, w: a.offsetWidth });
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, [active, pending.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VIEWS[Number(e.key) - 1];
      if (v) void navigate({ to: v.to });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <header className="menubar">
      <div className="brand">
        <i>
          <b />
          <b />
          <b />
        </i>
        Cascade
      </div>
      <nav className="seg" ref={seg}>
        {ind && <span className="ind" style={{ transform: `translateX(${ind.x - 3}px)`, width: ind.w, left: 3 }} />}
        {VIEWS.map((v, i) => (
          <Link key={v.to} to={v.to} className={i === active ? "on" : ""}>
            {v.label}
            {v.to === "/approvals" && pending.length > 0 && <span className="count">{pending.length}</span>}
          </Link>
        ))}
      </nav>
      <div />
    </header>
  );
}
