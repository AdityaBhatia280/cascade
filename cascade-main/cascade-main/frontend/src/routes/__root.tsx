import { useEffect, useRef } from "react";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useNavigate, useRouterState } from "@tanstack/react-router";
import { Floor } from "@/components/floor/Floor";
import { Menubar } from "@/components/Menubar";
import { Companion } from "@/components/Companion";
import { useServerEvents } from "@/lib/events";
import { useSite } from "@/lib/queries";
import { inFlight, siteStatusQuery, useUploadSession } from "@/lib/uploads";
import { useViewPath } from "@/lib/viewPath";
import type { SiteSearch } from "./site";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
});

function ShareSiteUnitWithHost() {
  const navigate = useNavigate();
  const path = useViewPath();
  const off = useRouterState({ select: (s) => (s.location.search as SiteSearch).off ?? null });
  const current = useRef(off);
  current.current = path === "/site" ? off : null;
  const embedded = window.parent !== window;

  useEffect(() => {
    if (!embedded) return;
    const onMessage = (e: MessageEvent<{ type?: string; unit?: string | null }>) => {
      if (e.origin !== window.location.origin || e.source !== window.parent || e.data?.type !== "cascade:off") return;
      const unit = e.data.unit ?? null;
      if (unit === current.current) return;
      void navigate({ to: "/site", search: (prev: SiteSearch) => ({ ...prev, off: unit ?? undefined, job: undefined }) });
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "cascade:ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, navigate]);

  const shown = useRef({ path, off });
  useEffect(() => {
    const was = shown.current;
    shown.current = { path, off };
    const switchedOnSite = was.path === "/site" && path === "/site" && was.off !== off;
    if (embedded && switchedOnSite)
      window.parent.postMessage({ type: "cascade:off", unit: off }, window.location.origin);
  }, [embedded, path, off]);
  return null;
}

function ServerEvents() {
  useServerEvents();
  return null;
}

/**
 * The menubar, the one floor and the companion stay mounted; only the view over the floor changes.
 * Ingest is the screen only while the site is empty or a batch is being read; once the batch lands
 * (and the site holds something), the screen moves on to Site.
 */
function Shell() {
  const { site, error } = useSite();
  const status = useQuery(siteStatusQuery);
  const session = useUploadSession();
  const path = useViewPath();
  const navigate = useNavigate();
  const empty = status.data?.empty ?? false;
  const firstRun = empty || inFlight(session);
  const ingest = path === "/ingest";

  useEffect(() => {
    if (empty && !ingest) void navigate({ to: "/ingest", replace: true });
    else if (status.data && !firstRun && ingest) void navigate({ to: "/site", replace: true });
  }, [empty, ingest, firstRun, status.data, navigate]);

  const ready = site && (!empty || ingest);
  return (
    <div className="app">
      <Menubar locked={firstRun} />
      {site && <Floor site={site} />}
      {ready || ingest ? (
        <div className="view" key={path}>
          <Outlet />
        </div>
      ) : (
        <div className="boot">{error ? <div className="panel">{error.message}</div> : null}</div>
      )}
      {site && !firstRun && <Companion site={site} />}
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ServerEvents />
      <ShareSiteUnitWithHost />
      <Shell />
    </QueryClientProvider>
  );
}
