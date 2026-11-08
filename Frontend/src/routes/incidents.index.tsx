import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { dateTime } from '@/lib/format';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/incidents/')({
  head: pageHead('Incidents', 'Incidents opened by the Cascade anomaly detector, newest first.'),
  component: Incidents,
});

function Incidents() {
  const q = useQuery({ queryKey: ['incidents'], queryFn: api.incidents });
  return (
    <div>
      <PageHeader title="Incidents" description="Opened automatically when the anomaly detector fires." />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState title="No incidents yet" body="Use “Run incident scenario” in the header to simulate the chiller failures." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {q.data.map((i) => (
            <li key={i.id}>
              <Link to="/incidents/$id" params={{ id: i.id }} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-xs text-muted-foreground">Root <Mono className="text-xs">{i.root_node}</Mono> · Opened <span className="tnum">{dateTime(i.opened_at)}</span></p>
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
