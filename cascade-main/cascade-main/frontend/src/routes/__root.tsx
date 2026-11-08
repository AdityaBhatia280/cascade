import { useEffect } from "react";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useNavigate } from "@tanstack/react-router";
import { Floor } from "@/components/floor/Floor";
import { Menubar } from "@/components/Menubar";
import { Companion } from "@/components/Companion";
import { useServerEvents } from "@/lib/events";
import { useSite } from "@/lib/queries";
import { inFlight, siteStatusQuery, useUploadSession } from "@/lib/uploads";
import { useViewPath } from "@/lib/viewPath";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
});

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
      <Shell />
    </QueryClientProvider>
  );
}
