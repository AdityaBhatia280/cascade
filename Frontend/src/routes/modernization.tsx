import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { sentence } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ModernizationStage } from '@/lib/types';
import { CopyCode } from '@/components/cascade/CodeBlock';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, Panel, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/modernization')({
  head: pageHead('Modernization', 'LEASEBIL COBOL refined, mapped, planned, assembled into TypeScript and validated.'),
  component: Modernization,
});

function Modernization() {
  const q = useQuery({ queryKey: ['modernization'], queryFn: api.modernization });
  const [active, setActive] = useState(0);
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph });

  if (q.isLoading) return <LoadingBlock rows={5} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const stages = q.data ?? [];
  if (!stages.length) return <EmptyState title="No modernization run yet" />;
  const s = stages[active] ?? stages[0]!;

  return (
    <div>
      <PageHeader title="Modernization" description={<>Rewriting <Mono>LEASEBIL.cbl</Mono> in TypeScript, with every stage recorded for audit.</>} />
      <ol className="mb-6 grid grid-cols-5 overflow-hidden rounded-lg border border-border bg-card" aria-label="Stages">
        {stages.map((st, i) => (
          <li key={st.stage} className={cn(i > 0 && 'border-l border-border')}>
            <button onClick={() => setActive(i)} aria-current={active === i ? 'step' : undefined}
              className={cn('relative flex w-full flex-col items-start gap-1 px-4 py-4 text-left transition-colors hover:bg-secondary', active === i && 'bg-secondary')}>
              {active === i && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-primary" />}
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn('flex size-6 items-center justify-center rounded-full border text-xs tnum', st.status === 'done' ? 'border-foreground bg-foreground text-background' : 'border-border')}>
                  {st.status === 'done' ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{sentence(st.stage)}</span>
              </span>
              <StatusBadge status={st.status} className="hidden md:inline-flex" />
            </button>
          </li>
        ))}
      </ol>

      <Panel title={sentence(s.stage)} action={<span className="text-xs text-muted-foreground">Produced by <Mono className="text-xs">{s.producer}</Mono></span>}>
        <StageBody stage={s} graphEdges={graph.data?.edges ?? []} />
      </Panel>
    </div>
  );
}

function StageBody({ stage, graphEdges }: { stage: ModernizationStage; graphEdges: { id: string; source: string; target: string; kind: string; verified: boolean }[] }) {
  const c = stage.content as Record<string, unknown>;
  switch (stage.stage) {
    case 'refine': {
      const rules = (c['rules'] as { paragraph: string; rule: string }[]) ?? [];
      return (
        <div>
          <p className="max-w-3xl text-[15px] leading-relaxed">{String(c['summary'] ?? '')}</p>
          <h3 className="mt-6 text-sm font-semibold">Business rules</h3>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {rules.map((r) => <li key={r.paragraph} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"><Mono className="w-48 shrink-0 font-medium">{r.paragraph}</Mono><span>{r.rule}</span></li>)}
          </ul>
        </div>
      );
    }
    case 'map': {
      const related = graphEdges.filter((e) => e.source === 'LEASEBIL' || e.target === 'LEASEBIL');
      return (
        <div>
          <p className="text-sm"><span className="font-semibold tnum">{String(c['edges_verified'])}</span> verified dependencies · <span className="font-semibold tnum">{String(c['unverified'])}</span> unverified</p>
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {related.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link to="/intelligence" search={{ node: e.source === 'LEASEBIL' ? e.target : e.source }} className="font-medium hover:text-primary"><Mono>{e.source} → {e.target}</Mono></Link>
                <span className="text-muted-foreground">{e.kind}</span>
                <StatusBadge status={e.verified ? 'verified' : 'unverified'} className="ml-auto" />
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'plan':
      return <ol className="list-decimal space-y-2 pl-5 text-sm">{((c['steps'] as string[]) ?? []).map((s) => <li key={s}>{s}</li>)}</ol>;
    case 'assemble':
      return (
        <div className="space-y-6">
          <CopyCode code={String(c['typescript_code'] ?? '')} label="Generated TypeScript" />
          <CopyCode code={String(c['tests_code'] ?? '')} label="Generated tests" />
        </div>
      );
    case 'validate':
      return (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm"><span className="metric-value mr-2">{String(c['passed'])} of {String(c['total'])}</span>parity cases match GnuCOBOL output.</p>
          <Link to="/parity" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary">View parity run</Link>
        </div>
      );
  }
}
