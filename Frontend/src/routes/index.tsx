import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { usd, dateTime, pct } from '@/lib/format';
import type { NodeCategory, NodeStatus } from '@/lib/types';
import { EmptyState, ErrorState, Illustrative, LoadingBlock, MetricCard, Panel, StatusBadge } from '@/components/cascade/primitives';
import { TelemetryChart } from '@/components/cascade/TelemetryChart';

export const Route = createFileRoute('/')({
  head: pageHead('Dashboard', 'Dollars at risk, hidden dependencies and live incident status for Cascade Tower.'),
  component: Dashboard,
});

const GROUPS: { label: string; cats: NodeCategory[] }[] = [
  { label: 'Cooling', cats: ['cooling'] },
  { label: 'Power', cats: ['power'] },
  { label: 'Network & access', cats: ['network'] },
  { label: 'Legacy software', cats: ['legacy', 'data'] },
  { label: 'Tenants', cats: ['tenant'] },
];

function Dashboard() {
  const { nodeStatus, incident } = useCascade();
  const ov = useQuery({ queryKey: ['overview'], queryFn: api.overview });
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const findings = useQuery({ queryKey: ['findings'], queryFn: api.findings });
  const risk = useQuery({ queryKey: ['risk'], queryFn: api.risk });

  const nodes = (graph.data?.nodes ?? []).map((n) => ({ ...n, status: nodeStatus[n.id] ?? n.status }));
  const o = ov.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Cascade Tower overview</h1>
        <p className="mt-2 text-sm text-muted-foreground">How legacy software and building systems depend on each other, and what's at stake when one fails.</p>
      </div>

      {ov.isError ? <ErrorState message={(ov.error as Error).message} onRetry={() => ov.refetch()} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!o ? Array.from({ length: 4 }).map((_, i) => <LoadingBlock key={i} rows={2} className="rounded-lg border border-border bg-card p-5" />) : (
            <>
              <MetricCard label="Dollars at risk" value={usd(o.dollars_at_risk_usd)} sub="Per year, from verified findings" extra={<Illustrative />} />
              <MetricCard label="Hidden dependencies found" value={<>{o.dependencies_found} <span className="text-muted-foreground">of {o.dependencies_total}</span></>} sub="Against planted ground truth" />
              <MetricCard label="Critical single points of failure" value={o.critical_spofs} sub="Defeat existing redundancy" />
              <MetricCard label="Incident status" value={<StatusBadge status={o.incident_status} className="h-8 px-3 text-sm" />} sub={`Updated ${dateTime(o.updated_at)}`} />
            </>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Panel title="Infrastructure health">
          {graph.isLoading ? <LoadingBlock rows={5} /> : (
            <ul className="divide-y divide-border">
              {GROUPS.map((g) => {
                const list = nodes.filter((n) => g.cats.includes(n.category));
                const count = (s: NodeStatus) => list.filter((n) => n.status === s).length;
                return (
                  <li key={g.label} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="text-sm font-medium">{g.label} <span className="text-muted-foreground tnum">· {list.length}</span></span>
                    <div className="flex gap-1.5">
                      <StatusBadge status="healthy" label={`${count('healthy')} Healthy`} />
                      {count('degraded') > 0 && <StatusBadge status="degraded" label={`${count('degraded')} Degraded`} />}
                      {count('failed') > 0 && <StatusBadge status="failed" label={`${count('failed')} Failed`} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Active incident">
            {incident ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{incident.title}</p>
                  <p className="text-xs text-muted-foreground">Root: {incident.root_node} · Opened {dateTime(incident.opened_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={incident.status} />
                  <Link to="/incidents/$id" params={{ id: incident.id }} className="inline-flex h-10 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary">Open <ArrowRight className="size-4" /></Link>
                </div>
              </div>
            ) : <EmptyState title="No active incidents" body="Run the incident scenario to watch the agent respond." />}
          </Panel>

          <Panel title="Top findings" action={<Link to="/findings" className="text-sm font-medium text-muted-foreground hover:text-foreground">View all</Link>}>
            {findings.isLoading ? <LoadingBlock /> : (
              <ul className="divide-y divide-border">
                {[...(findings.data ?? [])].sort((a, b) => b.usd_per_year - a.usd_per_year).slice(0, 3).map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{f.title}</p>
                      <StatusBadge status={f.severity} className="mt-1" />
                    </div>
                    <span className="text-sm font-semibold tnum">{f.usd_per_year ? `${usd(f.usd_per_year)}/yr` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Highest-risk components">
            {risk.isLoading ? <LoadingBlock /> : (
              <ul className="space-y-3">
                {(risk.data ?? []).slice(0, 5).map((r) => (
                  <li key={r.node_id}>
                    <Link to="/intelligence" search={{ node: r.node_id }} className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium group-hover:text-primary">{r.label}</span>
                        <span className="tnum text-muted-foreground">{pct(r.risk_score)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: pct(r.risk_score) }} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Cooling telemetry"><TelemetryChart /></Panel>
    </div>
  );
}
