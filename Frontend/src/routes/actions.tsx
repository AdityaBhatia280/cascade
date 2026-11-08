import { Fragment, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { dateTime, usd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Action } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/actions')({
  head: pageHead('Actions & audit log', 'Every action the Cascade agent proposed, with human approval decisions and results.'),
  component: Actions,
});

const STATUSES: (Action['status'] | 'all')[] = ['all', 'pending', 'approved', 'executed', 'rejected', 'failed'];

function Actions() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['actions', 'all'], queryFn: () => api.actions() });
  const rows = (q.data ?? []).filter((a) => status === 'all' || a.status === status);

  return (
    <div>
      <PageHeader title="Actions & audit log" description="Every proposed action and every human decision. Recipients are simulated — messages go to the demo inbox." />
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
            className={cn('h-9 rounded-md border px-3 text-[13px] font-medium capitalize', status === s ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-secondary')}>{s}</button>
        ))}
      </div>
      {q.isLoading ? <LoadingBlock rows={5} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !rows.length ? (
        <EmptyState title="No actions recorded" body="Actions appear here once the agent proposes them." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8" /><TableHead>Time</TableHead><TableHead>Tool</TableHead><TableHead>Recipient</TableHead><TableHead>Status</TableHead>
              <TableHead>Decided by</TableHead><TableHead className="text-right">Dollar impact</TableHead><TableHead>Result</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <TableRow className="h-12 cursor-pointer" tabIndex={0} aria-expanded={open === a.id}
                    onClick={() => setOpen(open === a.id ? null : a.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(open === a.id ? null : a.id)}>
                    <TableCell><ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open === a.id && 'rotate-90')} /></TableCell>
                    <TableCell className="tnum text-muted-foreground">{dateTime(a.decided_at)}</TableCell>
                    <TableCell><Mono>{a.tool}</Mono></TableCell>
                    <TableCell><p>{a.recipient_display}</p><p className="text-xs text-muted-foreground">Delivered to demo inbox</p></TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell>{a.decided_by ?? '—'}</TableCell>
                    <TableCell className="text-right tnum">{a.usd_impact ? usd(a.usd_impact) : <span className="text-muted-foreground">Computed by backend</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{a.result ?? '—'}</TableCell>
                  </TableRow>
                  {open === a.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-secondary/50">
                        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{JSON.stringify(a, null, 2)}</pre>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
