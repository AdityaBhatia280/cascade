import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, isUsingFixtures } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/parity')({
  head: pageHead('Parity', 'TypeScript replacement checked case by case against real GnuCOBOL compiler output.'),
  component: Parity,
});

function Diff({ a, b }: { a: string; b: string }) {
  return (
    <Mono>
      {b.split('').map((ch, i) => <span key={i} className={cn(ch !== a[i] && 'rounded-[2px] bg-critical-soft text-critical')}>{ch}</span>)}
    </Mono>
  );
}

function Parity() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['parity'], queryFn: api.runParity });
  const [running, setRunning] = useState(false);
  const run = async () => { setRunning(true); try { qc.setQueryData(['parity'], await api.runParity()); } finally { setRunning(false); } };
  const rows = q.data ?? [];
  const passed = rows.filter((r) => r.pass).length;

  return (
    <div>
      <PageHeader
        title="Parity"
        description={<>Expected outputs were captured from the real GnuCOBOL compiler.{isUsingFixtures() && ' Preview: actual values mirror expected until the backend runs the TypeScript.'}</>}
        actions={<Button onClick={run} disabled={running}><Play /> {running ? 'Running…' : 'Run parity'}</Button>}
      />
      {q.isLoading ? <LoadingBlock rows={6} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState title="No parity cases" /> : (
        <>
          <p className="mb-4 text-sm"><span className="metric-value mr-2">{passed} of {rows.length}</span>cases match GnuCOBOL output</p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Case</TableHead><TableHead>Description</TableHead><TableHead>Inputs</TableHead>
                <TableHead className="text-right">Expected (GnuCOBOL)</TableHead><TableHead className="text-right">Actual (TypeScript)</TableHead><TableHead>Result</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.case_id} className={cn('h-12', !r.pass && 'bg-critical-soft/50')}>
                    <TableCell><Mono>{r.case_id}</Mono></TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tnum">{Object.entries(r.input).map(([k, v]) => `${k}=${v}`).join(' · ')}</TableCell>
                    <TableCell className="text-right"><Mono>{r.expected}</Mono></TableCell>
                    <TableCell className="text-right">{r.pass ? <Mono>{r.actual}</Mono> : <Diff a={r.expected} b={r.actual} />}</TableCell>
                    <TableCell><StatusBadge status={r.pass ? 'pass' : 'fail'} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
