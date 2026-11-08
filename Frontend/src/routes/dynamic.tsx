import { createFileRoute } from '@tanstack/react-router';
import { Box, ExternalLink, Play } from 'lucide-react';
import { pageHead } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { Mono } from '@/components/cascade/primitives';

export const Route = createFileRoute('/dynamic')({
  head: pageHead('Dynamic view (3D)', 'Interactive 3D data hall floor plan from cascade-main.'),
  component: DynamicView,
});

const DYNAMIC_URL = '/dynamic-app/site?cam=3d';

function DynamicView() {
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
        src={DYNAMIC_URL}
        title="Cascade Dynamic 3D Floor View"
        className="min-h-0 flex-1 w-full rounded-lg border border-border bg-card"
      />
    </div>
  );
}

