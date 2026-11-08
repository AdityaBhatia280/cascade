import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { dateTime, usd } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AgentTrace } from '@/components/cascade/AgentTrace';
import { EmptyState, ErrorState, Illustrative, LoadingBlock, Mono, Panel, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/incidents/$id')({
  head: () => ({
    meta: [
      { title: 'Incident detail · Cascade' },
      { name: 'description', content: 'Predicted cascade timeline, tenant impact and live agent trace for a Cascade incident.' },
      { property: 'og:title', content: 'Incident detail · Cascade' },
      { property: 'og:description', content: 'Predicted cascade timeline, tenant impact and live agent trace.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: IncidentDetail,
});

function IncidentDetail() {
  const { id } = Route.useParams();
  const live = useCascade();
  const q = useQuery({ queryKey: ['incidents', id], queryFn: () => api.incident(id), refetchInterval: 3000 });
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const label = (nid: string) => graph.data?.nodes.find((n) => n.id === nid)?.label ?? nid;

  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Incident not found" action={<Link to="/incidents" className="text-sm font-medium text-primary">Back to incidents</Link>} />;

  const { incident, simulation, actions } = q.data;
  const isLive = live.incident?.id === incident.id;
  const steps = isLive && live.steps.length ? live.steps : q.data.steps;
  const sim = (isLive && live.simulation) || simulation;
  const pending = actions.filter((a) => a.status === 'pending');

  return (
    <div className="space-y-6">
      <Link to="/incidents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Incidents</Link>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="section-title">{incident.title}</h1>
              <StatusBadge status={incident.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Root <Mono>{incident.root_node}</Mono> · Opened <span className="tnum">{dateTime(incident.opened_at)}</span></p>
          </div>

          <Panel title="Predicted timeline">
            {!sim ? <EmptyState title="Simulation pending" body="The agent runs the cascade simulation after the incident opens." /> : (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {sim.timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full ${t.state === 'failed' ? 'bg-critical' : t.state === 'degraded' ? 'bg-warning' : 'bg-success'}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-16 text-sm font-semibold tnum">T+{t.t_min} min</span>
                      <span className="text-sm font-medium">{label(t.node_id)}</span>
                      <StatusBadge status={t.state} />
                    </div>
                    <p className="mt-0.5 pl-[72px] text-xs text-muted-foreground">{t.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Per-tenant impact" action={<Illustrative />} bodyClassName="p-0">
            {!sim?.impacts.length ? <div className="p-5"><EmptyState title="No tenant impact predicted yet" /></div> : (
              <Table>
                <TableHeader><TableRow><TableHead className="pl-5">Tenant</TableHead><TableHead className="text-right">Minutes to impact</TableHead><TableHead className="pr-5 text-right">SLA credit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {sim.impacts.map((t) => (
                    <TableRow key={t.tenant_id}>
                      <TableCell className="pl-5 font-medium">{t.tenant_label}</TableCell>
                      <TableCell className="text-right tnum">{t.minutes_to_impact}</TableCell>
                      <TableCell className="pr-5 text-right tnum">{t.sla_credit_usd ? usd(t.sla_credit_usd) : <span className="text-muted-foreground">Computed by backend</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter><TableRow><TableCell className="pl-5" colSpan={2}>Total</TableCell><TableCell className="pr-5 text-right tnum">{sim.total_usd ? usd(sim.total_usd) : '—'}</TableCell></TableRow></TableFooter>
              </Table>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Agent trace" action={isLive && live.scenarioRunning ? <StatusBadge status="running" label="Streaming" /> : undefined}>
            <AgentTrace steps={steps} className="max-h-[560px]" />
          </Panel>
          <Panel title="Approval queue" action={pending.length ? <Button size="sm" onClick={() => live.setApprovalOpen(true)}>Review {pending.length}</Button> : undefined}>
            {!actions.length ? <p className="text-sm text-muted-foreground">No actions proposed yet.</p> : (
              <ul className="divide-y divide-border">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0"><Mono className="font-medium">{a.tool}</Mono><p className="truncate text-xs text-muted-foreground">{a.recipient_display}</p></div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
