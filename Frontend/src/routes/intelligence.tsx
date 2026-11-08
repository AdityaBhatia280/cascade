import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, ClipboardList, PanelRightClose, PanelRightOpen, Pause, Play, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { pct, sentence, usd } from '@/lib/format';
import type { GraphEdge, GraphNode, NodeCategory, NodeStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DependencyGraph } from '@/components/cascade/DependencyGraph';
import { AgentTrace } from '@/components/cascade/AgentTrace';
import { SourceSnippetView } from '@/components/cascade/CodeBlock';
import { EmptyState, ErrorState, LoadingBlock, Mono, StatusBadge, Tag } from '@/components/cascade/primitives';

export const Route = createFileRoute('/intelligence')({
  validateSearch: (s: Record<string, unknown>): { node?: string } => (typeof s['node'] === 'string' ? { node: s['node'] } : {}),
  head: pageHead('System intelligence', 'Dependency graph linking COBOL billing, building systems and tenants, with cascade simulation.'),
  component: Intelligence,
});

const FILTERS: { label: string; cats: NodeCategory[] | null }[] = [
  { label: 'All', cats: null },
  { label: 'Cooling', cats: ['cooling'] },
  { label: 'Power', cats: ['power'] },
  { label: 'Network', cats: ['network'] },
  { label: 'Legacy software', cats: ['legacy', 'data'] },
  { label: 'Tenants', cats: ['tenant'] },
];

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Intelligence() {
  const search = Route.useSearch();
  const { nodeStatus, simulation, setSimulation, steps, createWorkOrder } = useCascade();
  const q = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const [filter, setFilter] = useState(0);
  const [selNode, setSelNode] = useState<string | null>(search.node ?? null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [traceOpen, setTraceOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [tMin, setTMin] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { if (search.node) { setSelNode(search.node); setSelEdge(null); setPanelOpen(true); } }, [search.node]);

  const maxT = simulation ? Math.max(0, ...simulation.timeline.map((t) => t.t_min)) : 0;
  const times = useMemo(() => (simulation ? [...new Set(simulation.timeline.map((t) => t.t_min))].sort((a, b) => a - b) : []), [simulation]);

  // Start playback when a simulation arrives
  useEffect(() => {
    if (!simulation) return;
    if (reducedMotion()) { setTMin(maxT); setPlaying(false); return; }
    setTMin(-1);
    setPlaying(true);
  }, [simulation, maxT]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTMin((cur) => {
        const next = times.find((t) => t > cur);
        if (next === undefined) { setPlaying(false); return cur; }
        return next;
      });
    }, 600);
    return () => clearInterval(id);
  }, [playing, times]);

  const statusOverride = useMemo(() => {
    const o: Record<string, NodeStatus> = { ...nodeStatus };
    simulation?.timeline.filter((t) => t.t_min <= tMin).forEach((t) => { o[t.node_id] = t.state; });
    return o;
  }, [nodeStatus, simulation, tMin]);

  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />;
  const { nodes, edges } = q.data;
  const cats = FILTERS[filter]!.cats;
  const visible = new Set(nodes.filter((n) => !cats || cats.includes(n.category)).map((n) => n.id));

  const node = nodes.find((n) => n.id === selNode) ?? null;
  const edge = edges.find((e) => e.id === selEdge) ?? null;

  const simulate = async (id: string) => {
    setSimulating(true);
    try { setSimulation(await api.simulate(id)); } finally { setSimulating(false); }
  };

  return (
    <div className="flex h-[calc(100vh-var(--header-height)-2rem-4rem)] min-h-[560px] flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter graph">
          {FILTERS.map((f, i) => (
            <button key={f.label} onClick={() => setFilter(i)} aria-pressed={filter === i}
              className={cn('h-9 rounded-md border px-3 text-[13px] font-medium transition-colors', filter === i ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-secondary')}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setTraceOpen(true)}><Activity /> Agent trace{steps.length ? <span className="tnum text-muted-foreground">· {steps.length}</span> : null}</Button>
          <Button variant="secondary" size="icon" onClick={() => setPanelOpen(!panelOpen)} aria-label={panelOpen ? 'Collapse analysis panel' : 'Expand analysis panel'}>
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="min-h-0 flex-1">
            <DependencyGraph nodes={nodes} edges={edges} statusOverride={statusOverride} visible={visible}
              selectedNode={selNode} selectedEdge={selEdge}
              onSelectNode={(id) => { setSelNode(id); setSelEdge(null); setPanelOpen(true); }}
              onSelectEdge={(id) => { setSelEdge(id); setSelNode(null); setPanelOpen(true); }} />
          </div>
          {simulation && (
            <div className="flex items-center gap-4 border-t border-border px-4 py-3">
              <Button variant="secondary" size="icon" onClick={() => { if (tMin >= maxT) setTMin(-1); setPlaying(!playing); }} aria-label={playing ? 'Pause cascade' : 'Play cascade'}>
                {playing ? <Pause /> : <Play />}
              </Button>
              <span className="text-xs text-muted-foreground tnum">T+0 min</span>
              <Slider className="flex-1" min={0} max={Math.max(maxT, 1)} step={1} value={[Math.max(tMin, 0)]} onValueChange={([v]) => { setPlaying(false); setTMin(v ?? 0); }} aria-label="Cascade time" />
              <span className="text-xs tnum font-medium">T+{Math.max(tMin, 0)} / {maxT} min</span>
              <Button variant="ghost" size="sm" onClick={() => setSimulation(null)}>Clear</Button>
            </div>
          )}
        </div>

        {panelOpen && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto rounded-lg border border-border bg-card md:block">
            {node ? (
              <NodePanel node={{ ...node, status: statusOverride[node.id] ?? node.status }} nodes={nodes} edges={edges} simulating={simulating}
                onSimulate={() => simulate(node.id)} onWorkOrder={() => createWorkOrder(node.id, `Inspect ${node.label}`)}
                onSelectEdge={(id) => { setSelEdge(id); setSelNode(null); }} />
            ) : edge ? (
              <div className="p-5"><EdgeEvidence edge={edge} nodes={nodes} expanded /></div>
            ) : (
              <div className="p-5"><EmptyState title="Select a component" body="Click a node or connection to see its evidence, risk and what depends on it." /></div>
            )}
          </aside>
        )}
      </div>

      <Sheet open={traceOpen} onOpenChange={setTraceOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-[440px]">
          <SheetHeader>
            <SheetTitle>Agent trace</SheetTitle>
            <SheetDescription>Tool calls and decisions from the Nemotron agent.</SheetDescription>
          </SheetHeader>
          <AgentTrace steps={steps} className="min-h-0 flex-1 pr-1" />
        </SheetContent>
      </Sheet>
    </div>
  );
}

const label = (nodes: GraphNode[], id: string) => nodes.find((n) => n.id === id)?.label ?? id;

function EdgeEvidence({ edge, nodes, expanded, onSelect }: { edge: GraphEdge; nodes: GraphNode[]; expanded?: boolean; onSelect?: () => void }) {
  return (
    <div className={cn('rounded-md border border-border p-3', !edge.verified && 'border-dashed')}>
      <button type="button" onClick={onSelect} className="block w-full text-left text-sm font-medium hover:text-primary disabled:hover:text-foreground" disabled={!onSelect}>
        {label(nodes, edge.source)} → {label(nodes, edge.target)}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Tag>{edge.kind}</Tag>
        <span className="text-xs text-muted-foreground tnum">{pct(edge.confidence)} confidence</span>
        <StatusBadge status={edge.verified ? 'verified' : 'unverified'} />
      </div>
      {edge.evidence_file ? <Mono className="mt-2 block text-xs text-muted-foreground">{edge.evidence_file}:{edge.evidence_line}</Mono> : <p className="mt-2 text-xs text-muted-foreground">AI hypothesis — excluded from dollar totals until verified.</p>}
      {expanded && edge.evidence_file && <div className="mt-2"><SourceSnippetView file={edge.evidence_file} line={edge.evidence_line} /></div>}
    </div>
  );
}

function NodePanel({ node, nodes, edges, simulating, onSimulate, onWorkOrder, onSelectEdge }: {
  node: GraphNode; nodes: GraphNode[]; edges: GraphEdge[]; simulating: boolean;
  onSimulate: () => void; onWorkOrder: () => void; onSelectEdge: (id: string) => void;
}) {
  const { data: risk } = useQuery({ queryKey: ['risk'], queryFn: api.risk });
  const r = risk?.find((x) => x.node_id === node.id);
  const connected = edges.filter((e) => e.source === node.id || e.target === node.id);
  const factorsKnown = r && r.factors.blast_radius + r.factors.dollars_at_risk + r.factors.fragility > 0;
  return (
    <div className="divide-y divide-border">
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="card-title">{node.label}</h2>
            <Mono className="text-xs text-muted-foreground">{node.id}</Mono>
          </div>
          <StatusBadge status={node.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="label-text">Type</dt><dd>{node.type === 'sla' ? 'SLA' : sentence(node.type)}</dd></div>
          <div><dt className="label-text">Redundancy</dt><dd className="tnum">{node.k_required} of {node.n_total}</dd></div>
          <div><dt className="label-text">Monthly value</dt><dd className="tnum">{node.monthly_fee_usd ? usd(node.monthly_fee_usd) : '—'}</dd></div>
          <div><dt className="label-text">SLA target</dt><dd className="tnum">{node.sla_target_pct}%</dd></div>
        </dl>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm"><span className="label-text">Risk score</span><span className="font-semibold tnum">{pct(node.risk_score)}</span></div>
          <div className="mt-1.5 h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: pct(node.risk_score) }} /></div>
          {factorsKnown ? (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li className="flex justify-between"><span>Blast radius</span><span className="tnum">{pct(r!.factors.blast_radius)}</span></li>
              <li className="flex justify-between"><span>Dollars at risk</span><span className="tnum">{pct(r!.factors.dollars_at_risk)}</span></li>
              <li className="flex justify-between"><span>Fragility</span><span className="tnum">{pct(r!.factors.fragility)}</span></li>
            </ul>
          ) : <p className="mt-2 text-xs text-muted-foreground">Factor breakdown computed by backend.</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" onClick={onSimulate} disabled={simulating}><Zap /> {simulating ? 'Simulating…' : 'Simulate failure'}</Button>
          <Button variant="secondary" className="flex-1" onClick={onWorkOrder}><ClipboardList /> Work order</Button>
        </div>
      </div>
      <div className="p-5">
        <h3 className="text-sm font-semibold">Evidence <span className="text-muted-foreground tnum">· {connected.length}</span></h3>
        <ul className="mt-3 space-y-2">
          {connected.map((e) => <li key={e.id}><EdgeEvidence edge={e} nodes={nodes} onSelect={() => onSelectEdge(e.id)} /></li>)}
          {!connected.length && <p className="text-sm text-muted-foreground">No connected dependencies.</p>}
        </ul>
      </div>
    </div>
  );
}
