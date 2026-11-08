// EventSource helper with exponential-backoff reconnect.
export interface SSEHandle {
  close: () => void;
}

export function openSSE(
  url: string,
  handlers: Record<string, (data: unknown) => void>,
  onConnectionChange?: (connected: boolean) => void,
): SSEHandle {
  let es: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    es = new EventSource(url);
    es.onopen = () => {
      attempt = 0;
      onConnectionChange?.(true);
    };
    es.onerror = () => {
      es?.close();
      onConnectionChange?.(false);
      if (closed) return;
      const delay = Math.min(30000, 1000 * 2 ** attempt++);
      timer = setTimeout(connect, delay);
    };
    for (const [event, fn] of Object.entries(handlers)) {
      es.addEventListener(event, (e) => {
        try {
          fn(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed event */
        }
      });
    }
  };
  connect();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    },
  };
}
