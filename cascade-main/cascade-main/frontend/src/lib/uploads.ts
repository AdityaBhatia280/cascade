// First run: the operator drops the site's own files, the server reads each one, and the floor grows as
// it does. One batch is a
// state machine fed by the POST reply, the upload events on GET /events, and a slow poll that recovers
// events missed while the stream reconnects. A file's status only moves forward, so replays are harmless.

import { useSyncExternalStore } from "react";
import type { ServerEventDto, UploadBatchDto, UploadFileDto, UploadStatus } from "@cascade/core/contract";
import { api, newIntent, type Intent } from "./api";

export type UploadEventDto = Extract<ServerEventDto, { type: "upload-file" | "upload-done" }>;
export const UPLOAD_EVENTS = ["upload-file", "upload-done"] as const satisfies readonly UploadEventDto["type"][];

export function postUploads(files: readonly File[]): Promise<UploadBatchDto> {
  const body = new FormData();
  for (const f of files) body.append("files", f, f.name);
  return api("POST /uploads", { body, intent: newIntent() });
}
export const getUploadBatch = (batchId: string) => api("GET /uploads/:batchId", { params: { batchId } });
export const getSiteStatus = () => api("GET /site/status");
export const resetSite = (intent: Intent) => api("POST /site/reset", { body: {}, intent });

/** Keyed like a contract route, so a model change (which invalidates every query) refetches it. */
export const siteStatusQuery = { queryKey: ["GET /site/status"] as const, queryFn: getSiteStatus, staleTime: Infinity };

/** One batch, from the drop to the hand-off to Site. `done` holds the short beat before `landed`. */
export type Session =
  | { phase: "idle" }
  | { phase: "sending"; files: UploadFileDto[] }
  | { phase: "reading"; batchId: string; files: UploadFileDto[] }
  | { phase: "done"; batchId: string; files: UploadFileDto[] }
  | { phase: "landed"; batchId: string; files: UploadFileDto[] }
  | { phase: "failed"; files: UploadFileDto[]; message: string };

type Input =
  | { type: "picked"; names: readonly string[] }
  | { type: "batch"; batch: UploadBatchDto }
  | { type: "failed"; message: string }
  | { type: "landed" }
  | UploadEventDto;

const RANK: Record<UploadStatus, number> = { queued: 0, reading: 1, classified: 2, ingested: 3, rejected: 3 };

/** Newer reports win unless they would move a file backwards; files the server adds join at the end. */
function merge(files: readonly UploadFileDto[], incoming: readonly UploadFileDto[]): UploadFileDto[] {
  const byId = new Map(incoming.map((f) => [f.id, f]));
  const out = files.map((f) => {
    const n = byId.get(f.id);
    byId.delete(f.id);
    return n && RANK[n.status] >= RANK[f.status] ? n : f;
  });
  return [...out, ...byId.values()];
}

const placeholder = (name: string, i: number): UploadFileDto => ({ id: `local:${i}`, name, kind: "unknown", status: "queued", title: "", detail: "", customer: null, reason: null });

function advance(s: Session, e: Input): Session {
  switch (e.type) {
    case "picked":
      return s.phase === "idle" || s.phase === "failed" || s.phase === "landed" ? { phase: "sending", files: e.names.map(placeholder) } : s;
    case "failed":
      return s.phase === "sending" ? { phase: "failed", files: s.files, message: e.message } : s;
    case "batch":
      if (s.phase === "sending") return { phase: e.batch.done ? "done" : "reading", batchId: e.batch.batchId, files: e.batch.files };
      if ((s.phase === "reading" || s.phase === "done") && s.batchId === e.batch.batchId) {
        return { phase: e.batch.done ? "done" : s.phase, batchId: s.batchId, files: merge(s.files, e.batch.files) };
      }
      return s;
    case "upload-file":
      return (s.phase === "reading" || s.phase === "done") && s.batchId === e.batchId ? { ...s, files: merge(s.files, [e.file]) } : s;
    case "upload-done":
      return s.phase === "reading" && s.batchId === e.batchId ? { ...s, phase: "done" } : s;
    case "landed":
      return s.phase === "done" ? { ...s, phase: "landed" } : s;
  }
}

export interface SessionDeps {
  send: (files: readonly File[]) => Promise<UploadBatchDto>;
  poll: (batchId: string) => Promise<UploadBatchDto>;
  /** The beat between the last file and the hand-off to Site. */
  beatMs?: number;
  pollMs?: number;
}

export type UploadSession = ReturnType<typeof createUploadSession>;

export function createUploadSession({ send, poll, beatMs = 800, pollMs = 2000 }: SessionDeps) {
  let s: Session = { phase: "idle" };
  const listeners = new Set<() => void>();
  /** Events that beat the POST reply: the batch id is not known yet. */
  let early: UploadEventDto[] = [];
  let beat: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  const stopPolling = () => {
    if (ticker) clearInterval(ticker);
    ticker = null;
  };
  const dispatch = (e: Input) => {
    const next = advance(s, e);
    if (next === s) return;
    const was = s.phase;
    s = next;
    if (s.phase === "reading" && !ticker) {
      const id = s.batchId;
      ticker = setInterval(() => void poll(id).then((batch) => dispatch({ type: "batch", batch }), () => {}), pollMs);
    }
    if (s.phase !== "reading") stopPolling();
    if (s.phase === "done" && was !== "done") beat = setTimeout(() => dispatch({ type: "landed" }), beatMs);
    for (const l of listeners) l();
  };

  return {
    get: () => s,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async pick(files: readonly File[]) {
      if (!files.length) return;
      const before = s;
      dispatch({ type: "picked", names: files.map((f) => f.name) });
      if (s === before) return;
      early = [];
      try {
        const batch = await send(files);
        dispatch({ type: "batch", batch });
        for (const e of early) dispatch(e);
      } catch (err) {
        dispatch({ type: "failed", message: err instanceof Error ? err.message : String(err) });
      }
      early = [];
    },
    receive(e: UploadEventDto) {
      if (s.phase === "sending") early.push(e);
      else dispatch(e);
    },
    reset() {
      stopPolling();
      if (beat) clearTimeout(beat);
      beat = null;
      early = [];
      s = { phase: "idle" };
      for (const l of listeners) l();
    },
  };
}

export const uploadSession = createUploadSession({ send: postUploads, poll: getUploadBatch });
export const useUploadSession = () => useSyncExternalStore(uploadSession.subscribe, uploadSession.get, uploadSession.get);
/** A batch is between the drop and the hand-off to Site. */
export const inFlight = (s: Session) => s.phase === "sending" || s.phase === "reading" || s.phase === "done";
