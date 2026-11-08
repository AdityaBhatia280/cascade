import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Flame, PanelRightClose, PanelRightOpen, Pause, Play, Plus, RotateCcw, X, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { pct, sentence, usd } from '@/lib/format';
import type { Action, GraphEdge, GraphNode, NodeCategory, NodeStatus, Simulation } from '@/lib/types';
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

const QUICK_TEST_NODES = ['UPS-B', 'CH-1', 'CH-2', 'CH-3', 'CRAH-4', 'cooling_loop', 'SW-03'];

/** Find all upstream faulted node IDs that have a directed path to targetId */
function findUpstreamFaults(targetId: string, edges: GraphEdge[], activeFaults: string[]): string[] {
  const visited = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const e of edges) {
      if (e.verified && e.target === cur && !visited.has(e.source)) {
        queue.push(e.source);
      }
    }
  }
  return activeFaults.filter((f) => visited.has(f));
}

function Intelligence() {
  const search = Route.useSearch();
  const {
    nodeStatus, faults, whatIf, failNode, healNode, resetFaults,
    setSimulation, scenarioRunning, steps, createWorkOrder, approve, setApprovalOpen,
  } = useCascade();
  const q = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const [filter, setFilter] = useState(0);
  const [selNode, setSelNode] = useState<string | null>(search.node ?? null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [traceOpen, setTraceOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [playbackSim, setPlaybackSim] = useState<Simulation | null>(null);
  const [tMin, setTMin] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { if (search.node) { setSelNode(search.node); setSelEdge(null); setPanelOpen(true); } }, [search.node]);

  // When a scenario starts from the header ("Run incident scenario" / "Replay"), close any manual playback bar
  useEffect(() => {
    if (scenarioRunning) {
      setPlaybackSim(null);
      setPlaying(false);
    }
  }, [scenarioRunning]);

  const maxT = playbackSim ? Math.max(0, ...playbackSim.timeline.map((t) => t.t_min)) : 0;
  const times = useMemo(() => (playbackSim ? [...new Set(playbackSim.timeline.map((t) => t.t_min))].sort((a, b) => a - b) : []), [playbackSim]);

  useEffect(() => {
    if (!playing || !playbackSim) return;
    const id = setInterval(() => {
      setTMin((cur) => {
        const next = times.find((t) => t > cur);
        if (next === undefined) {
          setPlaying(false);
          return cur;
        }
        return next;
      });
    }, 650);
    return () => clearInterval(id);
  }, [playing, playbackSim, times]);

  // Live statuses from custom cascade sandbox & scenario SSE stream
  const liveStatuses = useMemo(() => {
    return { ...(whatIf?.statuses ?? {}), ...nodeStatus };
  }, [nodeStatus, whatIf]);

  // During active playback (playing === true or user scrubbing tMin < maxT), animate hop-by-hop;
  // Once playback reaches maxT, defer to liveStatuses so sandbox Fail / Restore actions work immediately!
  const statusOverride = useMemo(() => {
    if (!playbackSim || (!playing && tMin >= maxT)) return liveStatuses;
    const o: Record<string, NodeStatus> = {};
    q.data?.nodes.forEach((n) => { o[n.id] = 'healthy'; });
    playbackSim.timeline.filter((t) => t.t_min <= tMin).forEach((t) => { o[t.node_id] = t.state; });
    return o;
  }, [liveStatuses, playbackSim, playing, tMin, maxT, q.data]);

  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.isError || !q.data) return <ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />;
  const { nodes, edges } = q.data;
  const cats = FILTERS[filter]!.cats;
  const visible = new Set(nodes.filter((n) => !cats || cats.includes(n.category)).map((n) => n.id));

  const node = nodes.find((n) => n.id === selNode) ?? null;
  const edge = edges.find((e) => e.id === selEdge) ?? null;

  const failedCount = nodes.filter((n) => (statusOverride[n.id] ?? n.status) === 'failed').length;
  const degradedCount = nodes.filter((n) => (statusOverride[n.id] ?? n.status) === 'degraded').length;

  const startTimelinePlayback = async (id: string) => {
    setSimulating(true);
    try {
      const sim = await api.simulate(id);
      setPlaybackSim(sim);
      setTMin(-1);
      setPlaying(true);
    } finally {
      setSimulating(false);
    }
  };

  const handleSandboxToggle = async (id: string) => {
    setPlaybackSim(null);
    setSimulation(null);
    setPlaying(false);
    const curState = liveStatuses[id] ?? 'healthy';
    if (faults.includes(id) || curState === 'failed') {
      const upFaults = findUpstreamFaults(id, edges, faults);
      await healNode(id, upFaults);
    } else {
      await failNode(id);
    }
  };

  const handleResetAll = async () => {
    setPlaybackSim(null);
    setSimulation(null);
    setPlaying(false);
    await resetFaults();
  };

  const activePlaybackEvents = playbackSim
    ? playbackSim.timeline.filter((t) => t.t_min === Math.max(0, tMin))
    : [];

  return (
    <div className="flex h-[calc(100vh-var(--header-height)-2rem-4rem)] min-h-[600px] flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
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

      {/* Interactive Custom Cascade Sandbox Bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs">
        <span className="font-semibold text-foreground">Custom cascade sandbox:</span>
        <span className="text-muted-foreground">Toggle components between failed & healthy to test k-of-n propagation and recovery:</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_TEST_NODES.map((id) => {
            const n = nodes.find((x) => x.id === id);
            if (!n) return null;
            const curStatus = statusOverride[id] ?? n.status;
            const isFailed = faults.includes(id) || curStatus === 'failed';
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSelNode(id);
                  setSelEdge(null);
                  setPanelOpen(true);
                  void handleSandboxToggle(id);
                }}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                  isFailed
                    ? 'border-critical bg-critical/10 text-critical hover:bg-critical/15'
                    : curStatus === 'degraded'
                      ? 'border-warning/50 bg-warning-soft text-warning hover:bg-warning-soft/80'
                      : 'border-border bg-secondary/60 text-foreground hover:bg-secondary',
                )}
                title={isFailed ? `Click to restore ${n.label} to healthy` : `Click to fail ${n.label} and see downstream cascade`}
              >
                <span className={cn('size-2 rounded-full', isFailed ? 'bg-critical' : curStatus === 'degraded' ? 'bg-warning' : 'bg-chart-4')} />
                {n.label}
                <span className="text-[10px] opacity-75">({isFailed ? 'Failed' : curStatus === 'degraded' ? 'Degraded' : 'Healthy'})</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="tnum text-muted-foreground">
            <strong className="text-critical">{failedCount}</strong> failed · <strong className="text-warning">{degradedCount}</strong> degraded
            {whatIf && whatIf.total_usd > 0 ? <> · <strong className="text-foreground">{usd(whatIf.total_usd)}</strong> exposure</> : null}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => void handleResetAll()}
            disabled={faults.length === 0 && failedCount === 0 && degradedCount === 0 && !playbackSim}
          >
            <RotateCcw className="size-3.5" /> Reset all healthy
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
          {playbackSim && (
            <div className="border-t border-border bg-secondary/30 px-4 py-3">
              <div className="flex items-center gap-4">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => {
                    if (tMin >= maxT) {
                      setTMin(-1);
                      setPlaying(true);
                    } else {
                      setPlaying(!playing);
                    }
                  }}
                  aria-label={playing ? 'Pause cascade' : 'Play cascade'}
                >
                  {playing ? <Pause /> : <Play />}
                </Button>
                <span className="text-xs text-muted-foreground tnum">T+0 min</span>
                <Slider
                  className="flex-1"
                  min={0}
                  max={Math.max(maxT, 1)}
                  step={1}
                  value={[Math.max(tMin, 0)]}
                  onValueChange={([v]) => { setPlaying(false); setTMin(v ?? 0); }}
                  aria-label="Cascade time"
                />
                <span className="text-xs tnum font-semibold">T+{Math.max(tMin, 0)} / {maxT} min</span>
                <Button variant="secondary" size="sm" onClick={() => { setPlaybackSim(null); setPlaying(false); }}>
                  Exit playback
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag>Timeline playback: {label(nodes, playbackSim.root_node)}</Tag>
                  {activePlaybackEvents.length > 0 ? (
                    activePlaybackEvents.map((ev) => (
                      <span key={ev.node_id} className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-xs">
                        <StatusBadge status={ev.state} className="h-4 text-[10px]" />
                        <strong>{label(nodes, ev.node_id)}</strong>: {ev.reason}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">Starting playback from T+0 min…</span>
                  )}
                </div>
                <span className="text-muted-foreground tnum">
                  {playbackSim.timeline.filter((t) => t.t_min <= Math.max(0, tMin)).length} of {playbackSim.timeline.length} affected nodes reached
                </span>
              </div>
            </div>
          )}
        </div>

        {panelOpen && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto rounded-lg border border-border bg-card md:block">
            {node ? (
              <NodePanel
                key={node.id}
                node={{ ...node, status: statusOverride[node.id] ?? node.status }}
                nodes={nodes}
                edges={edges}
                simulating={simulating}
                isFaulted={faults.includes(node.id)}
                upstreamFaultIds={findUpstreamFaults(node.id, edges, faults)}
                cascadeReason={whatIf?.reasons[node.id]}
                onFailNode={async () => {
                  setPlaybackSim(null);
                  setSimulation(null);
                  setPlaying(false);
                  await failNode(node.id);
                }}
                onHealNode={async (upIds) => {
                  setPlaybackSim(null);
                  setSimulation(null);
                  setPlaying(false);
                  await healNode(node.id, upIds);
                }}
                onSimulate={() => startTimelinePlayback(node.id)}
                onWorkOrder={(note) => createWorkOrder(node.id, note)}
                onApproveWorkOrder={(id) => approve(id)}
                onOpenQueue={() => setApprovalOpen(true)}
                onSelectEdge={(id) => { setSelEdge(id); setSelNode(null); }}
              />
            ) : edge ? (
              <div className="p-5"><EdgeEvidence edge={edge} nodes={nodes} expanded /></div>
            ) : (
              <div className="p-5"><EmptyState title="Select a component" body="Click a node or connection to zoom in, inspect its evidence, or toggle its health state." /></div>
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

const WORK_ORDER_TEMPLATES: { id: string; label: string; buildNote: (nodeLabel: string, nodeId: string) => string }[] = [
  {
    id: 'inspect_restore',
    label: 'Inspect & restore to nominal',
    buildNote: (l, id) => `Inspect and restore ${l} (${id}) to nominal operation`,
  },
  {
    id: 'emergency_failover',
    label: 'Emergency failover & bypass routing',
    buildNote: (l, id) => `Execute emergency failover and redundant feed bypass for ${l} (${id})`,
  },
  {
    id: 'preventive_maint',
    label: 'Preventive maintenance & thermal check',
    buildNote: (l, id) => `Run preventive maintenance and thermal load diagnostic on ${l} (${id})`,
  },
  {
    id: 'sensor_recalibration',
    label: 'Sensor & BACnet telemetry recalibration',
    buildNote: (l, id) => `Recalibrate BACnet sensors and verify telemetry feed on ${l} (${id})`,
  },
  {
    id: 'controller_reset',
    label: 'Controller / breaker reset & test',
    buildNote: (l, id) => `Perform breaker inspection and controller reset sequence on ${l} (${id})`,
  },
  {
    id: 'custom',
    label: 'Custom work order…',
    buildNote: (l, id) => `Custom field dispatch for ${l} (${id}): `,
  },
];

function NodePanel({
  node, nodes, edges, simulating, isFaulted, upstreamFaultIds, cascadeReason,
  onFailNode, onHealNode, onSimulate, onWorkOrder, onApproveWorkOrder, onOpenQueue, onSelectEdge,
}: {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  simulating: boolean;
  isFaulted: boolean;
  upstreamFaultIds: string[];
  cascadeReason?: string;
  onFailNode: () => Promise<void>;
  onHealNode: (upstreamIds: string[]) => Promise<void>;
  onSimulate: () => void;
  onWorkOrder: (note: string) => Promise<Action>;
  onApproveWorkOrder: (id: string) => Promise<void>;
  onOpenQueue: () => void;
  onSelectEdge: (id: string) => void;
}) {
  const { data: risk } = useQuery({ queryKey: ['risk'], queryFn: api.risk });
  const [woOpen, setWoOpen] = useState(false);
  const [woBusy, setWoBusy] = useState(false);
  const [woTemplate, setWoTemplate] = useState<string>('inspect_restore');
  const [woPriority, setWoPriority] = useState<'P1 Critical' | 'P2 High' | 'P3 Routine'>(
    node.status === 'failed' ? 'P1 Critical' : node.status === 'degraded' ? 'P2 High' : 'P3 Routine',
  );
  const [woCustomNote, setWoCustomNote] = useState<string>(() =>
    WORK_ORDER_TEMPLATES[0]!.buildNote(node.label, node.id),
  );
  const [createdWo, setCreatedWo] = useState<Action | null>(null);
  const [woApproved, setWoApproved] = useState(false);

  const r = risk?.find((x) => x.node_id === node.id);
  const connected = edges.filter((e) => e.source === node.id || e.target === node.id);
  const factorsKnown = r && r.factors.blast_radius + r.factors.dollars_at_risk + r.factors.fragility > 0;
  const isUnhealthy = isFaulted || node.status !== 'healthy';
  const upstreamLabels = upstreamFaultIds.filter((id) => id !== node.id).map((id) => label(nodes, id));

  const handleTemplateChange = (tplId: string) => {
    setWoTemplate(tplId);
    const tpl = WORK_ORDER_TEMPLATES.find((t) => t.id === tplId);
    if (tpl) {
      setWoCustomNote(tpl.buildNote(node.label, node.id));
    }
  };

  const handleSubmitWorkOrder = async () => {
    const trimmed = woCustomNote.trim() || `Inspect and restore ${node.label} (${node.id})`;
    const finalNote = `[${woPriority}] ${trimmed}`;
    setWoBusy(true);
    try {
      const act = await onWorkOrder(finalNote);
      setCreatedWo(act);
      setWoApproved(false);
    } finally {
      setWoBusy(false);
    }
  };

  const handleApproveNow = async () => {
    if (!createdWo) return;
    setWoBusy(true);
    try {
      await onApproveWorkOrder(createdWo.id);
      setWoApproved(true);
    } finally {
      setWoBusy(false);
    }
  };

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

        {/* Live Custom Cascade State Reason */}
        <div className={cn(
          'mt-3 rounded-md border p-3 text-xs',
          node.status === 'failed'
            ? 'border-critical/40 bg-critical/5 text-foreground'
            : node.status === 'degraded'
              ? 'border-warning/40 bg-warning-soft text-foreground'
              : 'border-border bg-secondary/50 text-muted-foreground',
        )}>
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            {node.status === 'failed' ? <Flame className="size-3.5 text-critical" /> : node.status === 'degraded' ? <AlertTriangle className="size-3.5 text-warning" /> : <CheckCircle2 className="size-3.5 text-chart-4" />}
            <span>{isFaulted ? 'Injected root fault' : node.status === 'failed' ? 'Cascaded downstream failure' : node.status === 'degraded' ? 'Cascaded degradation' : 'Nominal state'}</span>
          </div>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            {cascadeReason ?? (node.status === 'healthy' ? 'All upstream dependencies nominal.' : 'Affected by upstream dependency changes.')}
          </p>
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

        <div className="mt-5 flex flex-col gap-2">
          {isUnhealthy ? (
            <Button
              variant="default"
              className="w-full justify-center bg-chart-4 text-center text-white hover:bg-chart-4/90"
              onClick={() => void onHealNode(upstreamFaultIds)}
            >
              <RotateCcw />
              {isFaulted || upstreamLabels.length === 0
                ? `Restore ${node.label} to healthy`
                : `Restore ${node.label} (& ${upstreamLabels.join(', ')})`}
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="w-full justify-center text-center"
              onClick={() => void onFailNode()}
            >
              <Flame /> Fail {node.label} (test cascade)
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-9 w-full justify-center px-2.5 text-center text-xs"
              onClick={onSimulate}
              disabled={simulating}
            >
              <Zap className="size-3.5" />
              <span>{simulating ? 'Starting…' : 'Timeline playback'}</span>
            </Button>
            <Button
              variant={woOpen ? 'default' : 'secondary'}
              size="sm"
              className="h-9 w-full justify-center px-2.5 text-center text-xs"
              onClick={() => setWoOpen((prev) => !prev)}
            >
              <ClipboardList className="size-3.5" />
              <span>{woOpen ? 'Hide work order' : 'Work order'}</span>
              {woOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
          </div>

          {woOpen && (
            <div className="mt-1 rounded-md border border-border bg-secondary/40 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  {createdWo ? 'Work order status' : 'Dispatch work order'}
                </span>
                <button
                  type="button"
                  onClick={() => setWoOpen(false)}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Hide work order panel"
                  title="Hide work order panel"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {!createdWo ? (
                <div className="mt-2.5 space-y-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Action template</label>
                    <select
                      value={woTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    >
                      {WORK_ORDER_TEMPLATES.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Priority</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['P1 Critical', 'P2 High', 'P3 Routine'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setWoPriority(p)}
                          className={cn(
                            'rounded border px-2 py-1 text-center text-[11px] font-medium transition-colors',
                            woPriority === p
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      {woTemplate === 'custom' ? 'Custom work order instructions' : 'Work order instructions (editable)'}
                    </label>
                    <textarea
                      rows={2}
                      value={woCustomNote}
                      onChange={(e) => setWoCustomNote(e.target.value)}
                      placeholder={`Describe work needed for ${node.label}…`}
                      className="w-full resize-none rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>

                  <Button
                    size="sm"
                    className="w-full justify-center text-center text-xs"
                    disabled={woBusy || !woCustomNote.trim()}
                    onClick={() => void handleSubmitWorkOrder()}
                  >
                    <ClipboardList className="size-3.5" />
                    {woBusy ? 'Queueing…' : 'Queue work order'}
                  </Button>
                </div>
              ) : (
                <div className="mt-2 space-y-2.5">
                  <div className="rounded border border-border bg-card p-2.5">
                    <div className="flex items-center justify-between gap-2 font-medium text-foreground">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5 shrink-0 text-chart-4" />
                        <span>{woApproved ? 'Approved & dispatched' : 'Work order queued in notification bell'}</span>
                      </span>
                      <Mono className="text-[11px] text-muted-foreground">{createdWo.id}</Mono>
                    </div>
                    <p className="mt-1.5 text-muted-foreground">{createdWo.content}</p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {!woApproved && (
                      <Button
                        size="sm"
                        className="h-8 w-full justify-center text-center text-xs"
                        disabled={woBusy}
                        onClick={() => void handleApproveNow()}
                      >
                        Approve & dispatch now
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-full justify-center text-center text-xs"
                      onClick={onOpenQueue}
                    >
                      View notification queue
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-full justify-center text-center text-xs"
                      onClick={() => {
                        setCreatedWo(null);
                        setWoApproved(false);
                      }}
                    >
                      <Plus className="size-3.5" /> New work order
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
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
