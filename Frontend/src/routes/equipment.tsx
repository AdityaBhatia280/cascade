import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { sentence } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/equipment')({
  head: pageHead('Equipment', 'Chillers, power, network and data systems in Cascade Tower with redundancy and dependency counts.'),
  component: Equipment,
});

function Equipment() {
  const nav = useNavigate();
  const { nodeStatus } = useCascade();
  const q = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('all');

  const rows = (q.data?.nodes ?? [])
    .filter((n) => n.type === 'system' || n.type === 'utility')
    .map((n) => ({ ...n, status: nodeStatus[n.id] ?? n.status }))
    .filter((n) => (status === 'all' || n.status === status) && `${n.label} ${n.id}`.toLowerCase().includes(term.toLowerCase()));
  const edges = q.data?.edges ?? [];

  return (
    <div>
      <PageHeader title="Equipment" description="Physical systems and data stores. Select a row to open it in System intelligence." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search equipment" className="h-10 pl-9" aria-label="Search equipment" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? <LoadingBlock rows={6} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !rows.length ? <EmptyState title="No equipment matches" /> : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>ID</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Redundancy</TableHead><TableHead className="text-right">Upstream</TableHead><TableHead className="text-right">Downstream</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((n) => (
                <TableRow key={n.id} tabIndex={0} className="h-12 cursor-pointer"
                  onClick={() => nav({ to: '/intelligence', search: { node: n.id } })}
                  onKeyDown={(e) => e.key === 'Enter' && nav({ to: '/intelligence', search: { node: n.id } })}>
                  <TableCell className="font-medium">{n.label}</TableCell>
                  <TableCell><Mono className="text-muted-foreground">{n.id}</Mono></TableCell>
                  <TableCell>{sentence(n.category)}</TableCell>
                  <TableCell><StatusBadge status={n.status} /></TableCell>
                  <TableCell className="text-right tnum">{n.k_required} of {n.n_total}</TableCell>
                  <TableCell className="text-right tnum">{edges.filter((e) => e.target === n.id).length}</TableCell>
                  <TableCell className="text-right tnum">{edges.filter((e) => e.source === n.id).length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
