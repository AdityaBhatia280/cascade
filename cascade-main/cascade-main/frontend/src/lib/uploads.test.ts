import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadBatchDto, UploadFileDto, UploadStatus } from "@cascade/core/contract";
import { createUploadSession } from "./uploads";

const file = (id: string, name: string, status: UploadStatus, extra: Partial<UploadFileDto> = {}): UploadFileDto => ({
  id,
  name,
  kind: "unknown",
  status,
  title: "",
  detail: "",
  customer: null,
  reason: null,
  ...extra,
});
const batch = (files: UploadFileDto[], done = false): UploadBatchDto => ({ batchId: "B1", files, done });
const dropped = (...names: string[]) => names.map((n) => new File(["x"], n));
const statuses = (s: { get: () => { phase: string } & Partial<{ files: UploadFileDto[] }> }) => (s.get().files ?? []).map((f) => `${f.name}:${f.status}`);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(reply: UploadBatchDto = batch([file("f1", "register.csv", "queued"), file("f2", "halcyon.pdf", "queued")])) {
  const send = vi.fn().mockResolvedValue(reply);
  const poll = vi.fn<(id: string) => Promise<UploadBatchDto>>().mockImplementation(() => new Promise(() => {}));
  const session = createUploadSession({ send, poll });
  const landed = vi.fn();
  session.subscribe(() => session.get().phase === "landed" && landed());
  return { session, send, poll, landed };
}

describe("upload session", () => {
  it("shows a queued card per dropped file at once, then the server's files", async () => {
    const { session, send } = setup();
    const sent = session.pick(dropped("register.csv", "halcyon.pdf"));
    expect(session.get().phase).toBe("sending");
    expect(statuses(session)).toEqual(["register.csv:queued", "halcyon.pdf:queued"]);
    await sent;
    expect(send).toHaveBeenCalledOnce();
    expect(session.get()).toMatchObject({ phase: "reading", batchId: "B1" });
  });

  it("moves each card through its statuses as upload events arrive, with the server's labels", async () => {
    const { session } = setup();
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    session.receive({ type: "upload-file", batchId: "B1", file: file("f1", "register.csv", "reading") });
    expect(statuses(session)).toEqual(["register.csv:reading", "halcyon.pdf:queued"]);
    session.receive({ type: "upload-file", batchId: "B1", file: file("f1", "register.csv", "classified", { title: "Equipment register", detail: "142 assets" }) });
    session.receive({ type: "upload-file", batchId: "B1", file: file("f1", "register.csv", "ingested", { title: "Equipment register", detail: "142 assets" }) });
    session.receive({ type: "upload-file", batchId: "B1", file: file("f2", "halcyon.pdf", "rejected", { reason: "Not a site document" }) });
    const s = session.get();
    expect(statuses(session)).toEqual(["register.csv:ingested", "halcyon.pdf:rejected"]);
    expect(s.phase === "reading" && s.files[0]).toMatchObject({ title: "Equipment register", detail: "142 assets" });
    expect(s.phase === "reading" && s.files[1]?.reason).toBe("Not a site document");
  });

  it("never moves a card backwards when a late or replayed event arrives", async () => {
    const { session } = setup();
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    session.receive({ type: "upload-file", batchId: "B1", file: file("f1", "register.csv", "ingested") });
    session.receive({ type: "upload-file", batchId: "B1", file: file("f1", "register.csv", "reading") });
    expect(statuses(session)[0]).toBe("register.csv:ingested");
  });

  it("ignores events for another batch", async () => {
    const { session } = setup();
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    session.receive({ type: "upload-file", batchId: "B0", file: file("f1", "register.csv", "ingested") });
    session.receive({ type: "upload-done", batchId: "B0", revision: "r9" });
    expect(session.get().phase).toBe("reading");
    expect(statuses(session)[0]).toBe("register.csv:queued");
  });

  it("keeps events that arrive before the POST reply and applies them once the batch is known", async () => {
    let answer!: (b: UploadBatchDto) => void;
    const send = vi.fn().mockReturnValue(new Promise<UploadBatchDto>((r) => (answer = r)));
    const session = createUploadSession({ send, poll: () => new Promise(() => {}) });
    const sent = session.pick(dropped("register.csv"));
    session.receive({ type: "upload-file", batchId: "B1", file: file("f1", "register.csv", "reading") });
    answer(batch([file("f1", "register.csv", "queued")]));
    await sent;
    expect(statuses(session)).toEqual(["register.csv:reading"]);
  });

  it("hands off to Site a beat after the batch is done, once", async () => {
    const { session, landed } = setup();
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    session.receive({ type: "upload-done", batchId: "B1", revision: "r2" });
    expect(session.get().phase).toBe("done");
    await vi.advanceTimersByTimeAsync(700);
    expect(landed).not.toHaveBeenCalled();
    session.receive({ type: "upload-done", batchId: "B1", revision: "r2" });
    await vi.advanceTimersByTimeAsync(200);
    expect(landed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(landed).toHaveBeenCalledOnce();
  });

  it("recovers missed events from the poll, including the end of the batch", async () => {
    const { session, poll, landed } = setup();
    poll.mockResolvedValue(batch([file("f1", "register.csv", "ingested"), file("f2", "halcyon.pdf", "ingested")], true));
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledWith("B1");
    expect(statuses(session)).toEqual(["register.csv:ingested", "halcyon.pdf:ingested"]);
    await vi.advanceTimersByTimeAsync(800);
    expect(landed).toHaveBeenCalledOnce();
  });

  it("goes straight to the hand-off when the POST reply is already done", async () => {
    const { session, landed } = setup(batch([file("f1", "register.csv", "ingested")], true));
    await session.pick(dropped("register.csv"));
    await vi.advanceTimersByTimeAsync(800);
    expect(landed).toHaveBeenCalledOnce();
  });

  it("shows the failure when the upload is refused, and lets the operator drop again", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("The Cascade server is not reachable")).mockResolvedValueOnce(batch([file("f1", "register.csv", "queued")]));
    const session = createUploadSession({ send, poll: () => new Promise(() => {}) });
    await session.pick(dropped("register.csv"));
    expect(session.get()).toMatchObject({ phase: "failed", message: "The Cascade server is not reachable" });
    await session.pick(dropped("register.csv"));
    expect(session.get().phase).toBe("reading");
  });

  it("ignores a second drop while a batch is being read", async () => {
    const { session, send } = setup();
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    await session.pick(dropped("other.csv"));
    expect(send).toHaveBeenCalledOnce();
    expect(statuses(session)).toHaveLength(2);
  });

  it("starts over from nothing and cancels a pending hand-off", async () => {
    const { session, landed } = setup();
    await session.pick(dropped("register.csv", "halcyon.pdf"));
    session.receive({ type: "upload-done", batchId: "B1", revision: "r2" });
    session.reset();
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.get().phase).toBe("idle");
    expect(landed).not.toHaveBeenCalled();
  });
});
