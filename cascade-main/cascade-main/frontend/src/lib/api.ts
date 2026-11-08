// The only module that talks to the Cascade server. Every request is keyed by a route of the shared
// contract (`ApiRoutes`, `SseRoutes`), so a path is never typed by hand and a response is typed by its route.
// There is no fallback data: if the server is down, calls throw ApiError and pages show it.

import type { ApiRouteKey, ApiRoutes, SseRouteKey } from "@cascade/core/contract";

const env = import.meta.env as Record<string, string | undefined>;
// No auth yet: the server records this name on approvals.
const USER = "facilities-manager";

export const API_BASE = env["VITE_API_BASE"] ?? "http://127.0.0.1:5002/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * One user intent (a click on Approve, Submit, Save). The server replays the recorded result for a repeated
 * key, so a retry of the same intent is safe; a new click must mint a new intent.
 */
export interface Intent {
  readonly key: string;
}
export const newIntent = (): Intent => ({ key: crypto.randomUUID() });

type Method<K> = K extends `${infer M} ${string}` ? M : never;
type PathOf<K> = K extends `${string} ${infer P}` ? P : never;
type ParamNames<P> = P extends `${string}:${infer N}/${infer R}`
  ? N | ParamNames<R>
  : P extends `${string}:${infer N}`
    ? N
    : never;
type ParamsPart<P> = [ParamNames<P>] extends [never]
  ? unknown
  : { params: Record<ParamNames<P>, string> };
type QueryPart<Q> = {} extends Q ? { query?: Q } : { query: Q };
type BodyPart<B> = [B] extends [null] ? unknown : { body: B };
type IntentPart<K> = Method<K> extends "GET" ? unknown : { intent: Intent };

export type RequestOf<K extends ApiRouteKey> = ParamsPart<PathOf<K>> &
  QueryPart<ApiRoutes[K]["query"]> &
  BodyPart<ApiRoutes[K]["body"]> &
  IntentPart<K>;
export type ResponseOf<K extends ApiRouteKey> = ApiRoutes[K]["res"];
type Args<K extends ApiRouteKey> = {} extends RequestOf<K> ? [req?: RequestOf<K>] : [req: RequestOf<K>];

interface LooseRequest {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  intent?: Intent;
}

/** Fills `:name` segments (URL-encoded: cord ids contain `/`) and appends the query; arrays repeat the key. */
export function urlFor(key: ApiRouteKey | SseRouteKey, req: Pick<LooseRequest, "params" | "query"> = {}): string {
  const path = key
    .slice(key.indexOf(" ") + 1)
    .replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(req.params?.[name] ?? ""));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined && item !== null) q.append(k, String(item));
  }
  const qs = q.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
}

export async function api<K extends ApiRouteKey>(key: K, ...[req]: Args<K>): Promise<ResponseOf<K>> {
  const r = (req ?? {}) as LooseRequest;
  const method = key.slice(0, key.indexOf(" "));
  const headers: Record<string, string> = { "X-Cascade-User": USER };
  if (r.body !== undefined) headers["Content-Type"] = "application/json";
  if (r.intent) headers["Idempotency-Key"] = r.intent.key;
  let res: Response;
  try {
    res = await fetch(urlFor(key, r), {
      method,
      headers,
      ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
    });
  } catch {
    throw new ApiError(
      `The Cascade server is not reachable at ${API_BASE}. Start it with \`npm run dev:server\` from the repo root.`,
      null,
    );
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const msg = (json as { error?: unknown } | null)?.error;
    throw new ApiError(typeof msg === "string" ? msg : `Request failed (${res.status})`, res.status);
  }
  return json as ResponseOf<K>;
}

/** TanStack Query options for a GET route. The key starts with the route, so invalidation can target a route. */
export function apiQuery<K extends ApiRouteKey & `GET ${string}`>(key: K, ...[req]: Args<K>) {
  const r = (req ?? {}) as LooseRequest;
  return {
    queryKey: [key, r.params ?? null, r.query ?? null] as const,
    queryFn: () => api(key, ...([req] as Args<K>)),
  };
}
