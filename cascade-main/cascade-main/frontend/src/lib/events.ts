// GET /events tells the client when to refetch (it carries no state). The stream reconnects with capped
// exponential backoff, and a reconnect refetches proposals in case a change was missed while offline.

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ApiRouteKey, ServerEventDto } from "@cascade/core/contract";
import { urlFor } from "./api";
import { UPLOAD_EVENTS, uploadSession, type UploadEventDto } from "./uploads";

const SERVER_EVENTS = ["model-changed", "proposal-changed", "upload-file", "upload-done"] as const satisfies readonly ServerEventDto["type"][];

const byRoute = (qc: QueryClient, ...routes: ApiRouteKey[]) => Promise.all(routes.map((r) => qc.invalidateQueries({ queryKey: [r] })));

/** What each workspace change makes stale. A model change can touch every derived read, so it refetches all. */
export function invalidateFor(qc: QueryClient, e: ServerEventDto, lastRevision: string | null): Promise<unknown> {
  switch (e.type) {
    case "model-changed":
      return e.revision === lastRevision ? Promise.resolve() : qc.invalidateQueries();
    case "proposal-changed":
      return byRoute(qc, "GET /proposals");
    case "upload-file":
      return byRoute(qc, "GET /uploads/:batchId", "GET /site/status");
    case "upload-done":
      return qc.invalidateQueries();
  }
}

/** Subscribes once (in the root) to GET /events and keeps TanStack Query fresh. */
export function useServerEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1000;
    let closed = false;
    let lastRevision: string | null = null;
    let connectedBefore = false;
    const connect = () => {
      es = new EventSource(urlFor("GET /events"));
      es.onopen = () => {
        delay = 1000;
        if (connectedBefore) void byRoute(qc, "GET /proposals");
        connectedBefore = true;
      };
      es.onerror = () => {
        es?.close();
        if (closed) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
      for (const name of UPLOAD_EVENTS) {
        es.addEventListener(name, (msg) => {
          const e = JSON.parse((msg as MessageEvent<string>).data) as UploadEventDto;
          uploadSession.receive(e);
          if (e.type === "upload-done") void qc.invalidateQueries();
        });
      }
      for (const name of SERVER_EVENTS) {
        es.addEventListener(name, (msg) => {
          const e = JSON.parse((msg as MessageEvent<string>).data) as ServerEventDto;
          void invalidateFor(qc, e, lastRevision ?? (e.type === "model-changed" ? e.revision : null));
          if (e.type === "model-changed") lastRevision = e.revision;
        });
      }
    };
    // A page kept in the back-forward cache would hold its stream open, and enough of them take every
    // connection the browser allows the server, which stalls the next request.
    const hide = () => {
      if (timer) clearTimeout(timer);
      es?.close();
    };
    const show = (e: PageTransitionEvent) => e.persisted && !closed && connect();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    connect();
    return () => {
      closed = true;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [qc]);
}
