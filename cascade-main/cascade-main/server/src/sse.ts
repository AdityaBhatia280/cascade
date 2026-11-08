// Server-sent events: one channel per response, with a heartbeat so idle proxies keep it open.

import type { Response } from 'express';

export interface SseChannel {
  send(event: string, data: unknown): void;
  end(): void;
  onClose(f: () => void): void;
}

export function openSse(res: Response, heartbeatMs = 15_000): SseChannel {
  res.status(200).set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  res.write(': connected\n\n');
  const hb = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs);
  const closers: (() => void)[] = [() => clearInterval(hb)];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const c of closers) c();
  };
  res.on('close', close);
  return {
    send(event, data) {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      close();
      res.end();
    },
    onClose(f) {
      closers.push(f);
    },
  };
}
