import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE, ApiError, api, newIntent, urlFor } from "./api";
import { invalidateFor } from "./events";

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe("api client", () => {
  it("builds paths from the route key, encoding ids and repeating array queries", () => {
    expect(urlFor("GET /entities/:id", { params: { id: "cord:D03/B" } })).toBe(`${API_BASE}/entities/cord%3AD03%2FB`);
    expect(urlFor("GET /scenario", { query: { view: "planned", e: ["fails:ups:UPS-A@0", "maintenance:ups:UPS-B@5"] } })).toBe(
      `${API_BASE}/scenario?view=planned&e=fails%3Aups%3AUPS-A%400&e=maintenance%3Aups%3AUPS-B%405`,
    );
  });

  it("sends one idempotency key per intent and the fixed user", async () => {
    const fetch = reply(200, { id: "P-1" });
    vi.stubGlobal("fetch", fetch);
    const intent = newIntent();
    await api("POST /proposals/:id/decision", { params: { id: "P-1" }, body: { type: "approve" }, intent });
    await api("POST /proposals/:id/decision", { params: { id: "P-1" }, body: { type: "approve" }, intent });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0]!;
    const again = calls[1]![1];
    expect(url).toBe(`${API_BASE}/proposals/P-1/decision`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Idempotency-Key": intent.key, "X-Cascade-User": "facilities-manager" });
    expect((again.headers as Record<string, string>)["Idempotency-Key"]).toBe(intent.key);
    expect(newIntent().key).not.toBe(intent.key);
  });

  it("turns the server's { error } into an ApiError carrying the status", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "plan no longer applies" }));
    const err = await api("GET /proposals").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "plan no longer applies", status: 409 });
  });
});

describe("server events", () => {
  const keys = { proposals: ["GET /proposals"], scene: ["GET /scene", { view: "documented" }] } as const;
  const seeded = () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.proposals, []);
    qc.setQueryData(keys.scene, {});
    return qc;
  };
  const stale = (qc: QueryClient) => ({ proposals: qc.getQueryState(keys.proposals)!.isInvalidated, scene: qc.getQueryState(keys.scene)!.isInvalidated });

  it("refetches nothing when the revision is the one already loaded", async () => {
    const qc = seeded();
    await invalidateFor(qc, { type: "model-changed", revision: "r1" }, "r1");
    expect(stale(qc)).toEqual({ proposals: false, scene: false });
  });

  it("refetches everything on a new revision", async () => {
    const qc = seeded();
    await invalidateFor(qc, { type: "model-changed", revision: "r2" }, "r1");
    expect(stale(qc)).toEqual({ proposals: true, scene: true });
  });

  it("refetches only proposals on a proposal change", async () => {
    const qc = seeded();
    await invalidateFor(qc, { type: "proposal-changed", id: "P-1" }, "r1");
    expect(stale(qc)).toEqual({ proposals: true, scene: false });
  });
});
