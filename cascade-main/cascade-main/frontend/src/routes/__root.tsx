import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { Floor } from "@/components/floor/Floor";
import { Menubar } from "@/components/Menubar";
import { Companion } from "@/components/Companion";
import { useServerEvents } from "@/lib/events";
import { useSite } from "@/lib/queries";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
});

function ServerEvents() {
  useServerEvents();
  return null;
}

/** The menubar, the one floor and the companion stay mounted; only the view over the floor changes. */
function Shell() {
  const { site, error } = useSite();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="app">
      <Menubar />
      {site ? (
        <>
          <Floor site={site} />
          <div className="view" key={path}>
            <Outlet />
          </div>
          <Companion site={site} />
        </>
      ) : (
        <div className="boot">{error ? <div className="panel">{error.message}</div> : null}</div>
      )}
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
