import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { dateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, StatusBadge, Tag } from '@/components/cascade/primitives';

export const Route = createFileRoute('/incidents/')({
  head: pageHead('Incidents', 'Incidents opened by the Cascade anomaly detector, newest first.'),
  component: Incidents,
});

function Incidents() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['incidents'], queryFn: api.incidents });

  // Deduplicate by root_node + title if multiple identical legacy runs exist, keeping newest first
  const incidents = (() => {
    const seen = new Set<string>();
    return (q.data ?? []).filter((inc) => {
      const key = `${inc.root_node}|${inc.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const handleClear = async (onlyResolved: boolean) => {
    await api.clearIncidents(onlyResolved);
    await qc.invalidateQueries({ queryKey: ['incidents'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Opened automatically when the anomaly detector or custom cascade sandbox fires. Each root component failure is tagged with a unique ticket ID."
        actions={
          incidents.length > 0 ? (
            <div className="flex gap-2">
              {incidents.some((i) => i.status === 'resolved') && (
                <Button variant="secondary" size="sm" onClick={() => void handleClear(true)}>
                  Clear resolved
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => void handleClear(false)}>
                <Trash2 className="size-3.5" /> Reset tickets
              </Button>
            </div>
          ) : undefined
        }
      />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !incidents.length ? (
        <EmptyState title="No incidents yet" body="Use “Run incident scenario” in the header or fail a component in System Intelligence to open an incident ticket." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {incidents.map((i) => (
            <li key={i.id}>
              <Link to="/incidents/$id" params={{ id: i.id }} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded border border-border bg-secondary px-2 py-0.5 font-mono text-xs font-semibold text-foreground">
                      {i.id}
                    </span>
                    <Tag><Mono className="text-[11px]">Root: {i.root_node}</Mono></Tag>
                    {i.agent_run_id && <Tag><Mono className="text-[11px]">{i.agent_run_id}</Mono></Tag>}
                  </div>
                  <p className="mt-1.5 font-medium">{i.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Opened <span className="tnum">{dateTime(i.opened_at)}</span></p>
                </div>
                <StatusBadge status={i.status} />
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
