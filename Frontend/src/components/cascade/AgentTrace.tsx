import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AgentStep } from '@/lib/types';
import { cn } from '@/lib/utils';
import { sentence } from '@/lib/format';
import { Mono, StatusBadge, Tag } from './primitives';

function StepCard({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const replanned = step.status === 'replanned';
  return (
    <li className={cn('rounded-lg border border-border bg-card p-4', replanned && 'border-l-[3px] border-l-warning')}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{sentence(step.stage)}</Tag>
        <Mono className="font-medium">{step.tool}</Mono>
        <span className="ml-auto"><StatusBadge status={step.status} /></span>
      </div>
      <p className="mt-2 text-sm">{step.summary}</p>
      {replanned && step.replan_reason && <p className="mt-1 text-sm text-warning">Replanned: {step.replan_reason}</p>}
      {step.result_summary && <p className="mt-1 text-xs text-muted-foreground">Result: {step.result_summary}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Mono className="text-xs">{step.model}</Mono>
        <span className="tnum">{step.latency_ms} ms</span>
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex min-h-8 items-center gap-1 rounded-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={open}>
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} /> Arguments
        </button>
      </div>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-secondary p-3 font-mono text-xs">{JSON.stringify(step.args, null, 2)}</pre>
      )}
    </li>
  );
}

export function AgentTrace({ steps, className }: { steps: AgentStep[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [steps]);
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className={cn('overflow-y-auto', className)}
      aria-live="polite"
    >
      {steps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Waiting for an incident. The agent starts automatically when the anomaly detector fires.
        </p>
      ) : (
        <ol className="space-y-3">{steps.map((s) => <StepCard key={s.id} step={s} />)}</ol>
      )}
    </div>
  );
}
