import { useRouterState } from "@tanstack/react-router";

// The router keeps its basepath in location.pathname, so a parent app mounting this one at /dynamic-app/
// would see "/dynamic-app/site". Views compare against route paths, so strip it once here.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The current route path ("/site"), whatever path prefix the app is served under. */
export const useViewPath = (): string => useRouterState({ select: (s) => s.location.pathname.slice(BASE.length) || "/" });
