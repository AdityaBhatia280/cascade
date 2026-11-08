import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Box, ExternalLink, Play, RefreshCw } from 'lucide-react';
import { pageHead } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { Mono, StatusBadge } from '@/components/cascade/primitives';
import { API_BASE } from '@/lib/api';

export const Route = createFileRoute('/dynamic')({
  head: pageHead('Dynamic view (3D)', 'Interactive 3D data hall floor plan from cascade-main.'),
  component: DynamicView,
});

const DYNAMIC_URL = 'http://127.0.0.1:5174/site?cam=3d';

function DynamicView() {
  const [status, setStatus] = useState<'stopped' | 'installing' | 'starting' | 'running' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);

  const triggerStart = async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/dynamic-view/start`, { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { state?: typeof status; error?: string };
        if (data.state) setStatus(data.state);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void triggerStart();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/dynamic-view/status`);
        if (!res.ok) return;
        const data = (await res.json()) as { state?: typeof status; error?: string | null };
        if (data.state) setStatus(data.state);
        if (data.error) setError(data.error);
      } catch {
        // Ignore transient poll errors
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-[calc(100vh-112px)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Box className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-foreground">Dynamic view (3D floor · cascade-main)</h1>
              <StatusBadge
                status={status === 'running' ? 'healthy' : status === 'error' ? 'failed' : 'running'}
                label={
                  status === 'running'
                    ? 'Live on :5174'
                    : status === 'installing'
                      ? 'Installing dependencies…'
                      : status === 'starting'
                        ? 'Starting 3D server…'
                        : status
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Isolated sub-application running from <Mono>cascade-main/cascade-main</Mono> (API <Mono>:5002</Mono>, WebGL client <Mono>:5174</Mono>).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status !== 'running' && (
            <Button size="sm" variant="secondary" onClick={() => void triggerStart()}>
              <RefreshCw className="size-3.5" /> Retry launch
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              window.location.href = DYNAMIC_URL;
            }}
          >
            <Play className="size-3.5" /> Redirect to Dynamic View
          </Button>
          <Button
            size="sm"
            onClick={() => {
              window.open(DYNAMIC_URL, '_blank', 'noopener,noreferrer');
            }}
          >
            <ExternalLink className="size-3.5" /> Open in new tab
          </Button>
        </div>
      </div>

      {status === 'running' ? (
        <iframe
          src={DYNAMIC_URL}
          title="Cascade Dynamic 3D Floor View"
          className="min-h-0 flex-1 w-full rounded-lg border border-border bg-card"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-border bg-card p-8 text-center">
          <Box className="size-10 animate-pulse text-primary" />
          <h2 className="mt-3 text-base font-semibold text-foreground">
            {status === 'installing'
              ? 'Installing cascade-main 3D dependencies (first run)…'
              : status === 'starting'
                ? 'Starting cascade-main 3D Floor Server on port 5174…'
                : 'Dynamic View server is not running yet'}
          </h2>
          <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
            {error ??
              'Cascade automatically boots the isolated cascade-main workspace on ports 5002 and 5174 so there are zero merge conflicts with the main dashboard.'}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={() => void triggerStart()}>
              <Play className="size-3.5" /> Launch Dynamic View
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.location.href = DYNAMIC_URL;
              }}
            >
              <ExternalLink className="size-3.5" /> Go to {DYNAMIC_URL}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

