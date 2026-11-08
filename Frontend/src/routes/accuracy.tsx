import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { pct } from '@/lib/format';
import type { EvalReport } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState, LoadingBlock, MetricCard, Mono, PageHeader, Panel, StatusBadge, Tag } from '@/components/cascade/primitives';

export const Route = createFileRoute('/accuracy')({
  head: pageHead('Extraction accuracy', 'Precision and recall of dependency extraction against planted ground truth, decoys, and public benchmarks.'),
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
  const bm = useQuery({ queryKey: ['benchmarks'], queryFn: api.benchmarks });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const r = q.data;
  const cd = bm.data?.carddemo ?? null;
  const bdg = bm.data?.bdg2 ?? null;
  const totalBdgHours = bdg ? bdg.buildings.reduce((s, b) => s + b.hours, 0) : 0;
  const totalBdgAlerts = bdg ? bdg.buildings.reduce((s, b) => s + b.alerts, 0) : 0;
  const totalBdgFaults = bdg ? bdg.buildings.reduce((s, b) => s + b.sensor_faults, 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Extraction accuracy" description="How many planted dependencies Cascade found, whether it was fooled by decoys, and how its engines perform on real public datasets." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Planted dependencies found" value={<>{r.found} <span className="text-muted-foreground">of {r.total}</span></>} sub={`${r.false_positives} false positives`} />
        <MetricCard label="Precision" value={pct(r.precision)} />
        <MetricCard label="Recall" value={pct(r.recall)} />
        <MetricCard label="F1" value={r.f1.toFixed(2)} />
      </div>
      <Panel title="Ground truth" bodyClassName="p-0"><ItemTable items={r.items.filter((i) => !i.is_decoy)} decoy={false} /></Panel>
      <Panel title="Decoys" bodyClassName="p-0"><ItemTable items={r.items.filter((i) => i.is_decoy)} decoy /></Panel>

      {(cd || bdg) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {cd && (
            <Panel
              title="Real mainframe benchmark: AWS CardDemo"
              action={<Tag>Apache 2.0 · 20,650 lines</Tag>}
            >
              <p className="text-xs text-muted-foreground">
                Cascade&apos;s COBOL/JCL dependency extractor run over AWS&apos;s public mainframe credit-card reference codebase (<Mono className="text-xs">{cd.stats.cobol_programs}</Mono> COBOL programs, <Mono className="text-xs">{cd.stats.copybooks}</Mono> copybooks, <Mono className="text-xs">{cd.stats.jcl_jobs}</Mono> JCL jobs → <Mono className="text-xs">{cd.stats.nodes}</Mono> nodes, <Mono className="text-xs">{cd.stats.edges}</Mono> cited edges).
              </p>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Highest-blast-radius copybooks</h3>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {cd.most_shared_copybooks.map((c) => (
                  <li key={c.copybook} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <div>
                      <Mono className="font-medium">{c.copybook}</Mono>
                      <p className="truncate text-xs text-muted-foreground">Compiled into {c.used_by.slice(0, 5).join(', ')}{c.used_by.length > 5 ? ` +${c.used_by.length - 5} more` : ''}</p>
                    </div>
                    <Tag className="tnum">{c.blast_radius} programs</Tag>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {bdg && (
            <Panel
              title="Real telemetry benchmark: Building Data Genome 2"
              action={<Tag className="tnum">{totalBdgHours.toLocaleString()} building-hrs</Tag>}
            >
              <p className="text-xs text-muted-foreground">
                EWMA anomaly detector validated on 10 real Phoenix office buildings (2016–2017 hourly chilled-water meters): <span className="font-medium text-foreground tnum">{totalBdgAlerts}</span> sustained alerts (<span className="font-medium text-foreground tnum">0.38</span>/building/mo) and <span className="font-medium text-foreground tnum">{totalBdgFaults}</span> stuck-sensor faults automatically separated from incidents.
              </p>
              <div className="mt-3 overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">Building</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Sustained alerts</TableHead>
                      <TableHead className="text-right">Sensor faults</TableHead>
                      <TableHead className="pr-3 text-right">Alerts / mo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bdg.buildings.slice(0, 6).map((b) => (
                      <TableRow key={b.building} className="h-9">
                        <TableCell className="pl-3 font-medium">{b.building}</TableCell>
                        <TableCell className="text-right tnum text-muted-foreground">{b.hours.toLocaleString()}</TableCell>
                        <TableCell className="text-right tnum">{b.alerts}</TableCell>
                        <TableCell className="text-right tnum">{b.sensor_faults}</TableCell>
                        <TableCell className="pr-3 text-right tnum">{b.alert_rate_per_month.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
