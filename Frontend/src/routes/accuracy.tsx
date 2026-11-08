import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { pct } from '@/lib/format';
import type { EvalReport } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState, LoadingBlock, MetricCard, Mono, PageHeader, Panel, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/accuracy')({
  head: pageHead('Extraction accuracy', 'Precision and recall of dependency extraction against planted ground truth and decoys.'),
  component: Accuracy,
});

function ItemTable({ items, decoy }: { items: EvalReport['items']; decoy: boolean }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead className="pl-5">ID</TableHead><TableHead>From → to</TableHead><TableHead>Kind</TableHead><TableHead className="pr-5">Result</TableHead></TableRow></TableHeader>
      <TableBody>
        {items.map((i) => (
          <TableRow key={i.id} className="h-11">
            <TableCell className="pl-5"><Mono>{i.id}</Mono></TableCell>
            <TableCell><Mono>{i.from} → {i.to}</Mono></TableCell>
            <TableCell>{i.kind}</TableCell>
            <TableCell className="pr-5">
              {decoy ? <StatusBadge status={i.matched ? 'false positive' : 'correctly rejected'} /> : <StatusBadge status={i.matched ? 'found' : 'missed'} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Accuracy() {
  const q = useQuery({ queryKey: ['eval'], queryFn: api.eval });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const r = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Extraction accuracy" description="How many planted dependencies Cascade found, and whether it was fooled by decoys." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Planted dependencies found" value={<>{r.found} <span className="text-muted-foreground">of {r.total}</span></>} sub={`${r.false_positives} false positives`} />
        <MetricCard label="Precision" value={pct(r.precision)} />
        <MetricCard label="Recall" value={pct(r.recall)} />
        <MetricCard label="F1" value={r.f1.toFixed(2)} />
      </div>
      <Panel title="Ground truth" bodyClassName="p-0"><ItemTable items={r.items.filter((i) => !i.is_decoy)} decoy={false} /></Panel>
      <Panel title="Decoys" bodyClassName="p-0"><ItemTable items={r.items.filter((i) => i.is_decoy)} decoy /></Panel>
    </div>
  );
}
