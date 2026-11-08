import { useEffect, useRef, type RefObject } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Box, ExternalLink, Play } from 'lucide-react';
import { pageHead } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/cascade/primitives';
import { useCascade } from '@/lib/store';

export const Route = createFileRoute('/dynamic')({
  head: pageHead('Dynamic view (3D)', 'Interactive 3D data hall floor plan from cascade-main.'),
  component: DynamicView,
});

const DYNAMIC_URL = '/dynamic-app/site?cam=3d';

const TO_FLOOR: Record<string, string> = {
  'UPS-B': 'ups:UPS-B',
  'CH-1': 'chiller:CH-1',
  'CH-2': 'chiller:CH-2',
  'CH-3': 'chiller:CH-3',
  'CRAH-4': 'crah:CRAH-4',
  cooling_loop: 'loop:CHW-LOOP-1',
};
const FROM_FLOOR = Object.fromEntries(Object.entries(TO_FLOOR).map(([k, v]) => [v, k]));

type FloorMessage = { type: 'cascade:ready' } | { type: 'cascade:off'; unit: string | null };

function useFloorSync(frame: RefObject<HTMLIFrameElement | null>) {
  const { faults, setFaults } = useCascade();
  const onFloor = faults.map((f) => TO_FLOOR[f]).find(Boolean) ?? null;
  const latest = useRef({ faults, setFaults, onFloor });
  latest.current = { faults, setFaults, onFloor };

  const send = (unit: string | null) =>
    frame.current?.contentWindow?.postMessage({ type: 'cascade:off', unit }, window.location.origin);

  useEffect(() => send(onFloor), [onFloor]);

  useEffect(() => {
    const onMessage = (e: MessageEvent<FloorMessage>) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const { faults, setFaults, onFloor } = latest.current;
      if (e.data?.type === 'cascade:ready') return send(onFloor);
      if (e.data?.type !== 'cascade:off') return;
      const unit = e.data.unit;
      const id = unit ? FROM_FLOOR[unit] : undefined;
      if (unit && !id) return;
      if (id ? faults.includes(id) : !onFloor) return;
      void setFaults([...faults.filter((f) => !TO_FLOOR[f]), ...(id ? [id] : [])]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame]);
}

function DynamicView() {
  const frame = useRef<HTMLIFrameElement>(null);
  useFloorSync(frame);
  return (
    <div className="flex h-[calc(100vh-112px)] flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Box className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">Dynamic view (3D floor · cascade-main)</h1>
            <p className="text-xs text-muted-foreground">
              The <Mono>cascade-main/cascade-main</Mono> site app, served by this server at <Mono>/dynamic-app</Mono>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <a href={DYNAMIC_URL}>
              <Play className="size-3.5" /> Redirect to Dynamic View
            </a>
          </Button>
          <Button asChild size="sm">
            <a href={DYNAMIC_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" /> Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <iframe
        ref={frame}
        src={DYNAMIC_URL}
        title="Cascade Dynamic 3D Floor View"
        className="min-h-0 flex-1 w-full rounded-lg border border-border bg-card"
      />
    </div>
  );
}

