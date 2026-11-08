// The slim top bar: the Cascade mark, and the views as one segmented control whose white indicator
// slides to the active view. Keys 1 to 5 switch views. Locked (no site yet), the views wait. The mark
// opens a small menu whose one item starts over from an empty site, for rehearsing the first run.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { newIntent } from "@/lib/api";
import { useProposals } from "@/lib/queries";
import { resetSite, uploadSession } from "@/lib/uploads";

export const VIEWS = [
  { to: "/site", label: "Site" },
  { to: "/week", label: "Week" },
  { to: "/handoff", label: "Handoff" },
  { to: "/procedures", label: "Procedures" },
  { to: "/approvals", label: "Approvals" },
] as const;

function BrandMenu() {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const reset = useMutation({
    mutationFn: () => resetSite(newIntent()),
    onSuccess: async () => {
      uploadSession.reset();
      setOpen(false);
      await qc.invalidateQueries();
      void navigate({ to: "/ingest" });
    },
  });
  useEffect(() => {
    if (!open) return setArmed(false);
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="brandwrap" ref={root}>
      <button className="brand" aria-expanded={open} onClick={() => setOpen(!open)}>
        <i>
          <b />
          <b />
          <b />
        </i>
        Cascade
      </button>
      <div className={`bmenu panel${open ? " open" : ""}`} aria-hidden={!open}>
        {armed ? (
          <div className="confirm">
            <button className="btn red" disabled={reset.isPending} title={reset.error?.message} onClick={() => reset.mutate()}>
              {reset.isError ? "Try again" : "Clear the site"}
            </button>
            <button className="btn ghost" onClick={() => setArmed(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="item" onClick={() => setArmed(true)}>
            Start over
          </button>
        )}
      </div>
    </div>
  );
}

export function Menubar({ locked }: { locked: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { pending } = useProposals();
  const seg = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const active = VIEWS.findIndex((v) => path.startsWith(v.to));

  useLayoutEffect(() => {
    const measure = () => {
      const a = seg.current?.querySelectorAll("a")[active];
      setInd(a ? { x: a.offsetLeft, w: a.offsetWidth } : null);
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, [active, pending.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || locked) return;
      const v = VIEWS[Number(e.key) - 1];
      if (v) void navigate({ to: v.to });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, locked]);

  return (
    <header className="menubar">
      <BrandMenu />
      <nav className={`seg${locked ? " locked" : ""}`} ref={seg} aria-disabled={locked}>
        {ind && <span className="ind" style={{ transform: `translateX(${ind.x - 3}px)`, width: ind.w, left: 3 }} />}
        {VIEWS.map((v, i) => (
          <Link key={v.to} to={v.to} className={i === active ? "on" : ""} tabIndex={locked ? -1 : undefined}>
            {v.label}
            {v.to === "/approvals" && pending.length > 0 && <span className="count">{pending.length}</span>}
          </Link>
        ))}
      </nav>
      <div />
    </header>
  );
}
