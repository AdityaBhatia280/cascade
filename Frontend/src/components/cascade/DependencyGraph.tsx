import { memo, useEffect, useMemo, useRef } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode, NodeStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { sentence } from '@/lib/format';
import { StatusBadge, Tag } from './primitives';

const W = 210;
const H = 78;

type CardData = { node: GraphNode; selected: boolean; dimmed: boolean };

const NodeCard = memo(function NodeCard({ data }: NodeProps<Node<CardData>>) {
  const { node, selected, dimmed } = data;
  return (
    <div
      className={cn(
        'rounded-md border bg-card px-3 py-2 transition-[border-color,opacity,box-shadow] duration-200',
        selected ? 'border-primary ring-2 ring-primary/25 shadow-sm' : 'border-border',
        node.status === 'failed' && 'border-l-[3px] border-l-critical',
        node.status === 'degraded' && 'border-l-[3px] border-l-warning',
        dimmed && 'opacity-35',
      )}
      style={{ width: W, height: H }}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-chart-2" />
      <p className="truncate text-[13px] font-semibold" title={node.label}>{node.label}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Tag>{node.type === 'sla' ? 'SLA' : sentence(node.type)}</Tag>
        {node.n_total > 1 && <Tag>{node.k_required} of {node.n_total}</Tag>}
      </div>
      <div className="mt-1.5"><StatusBadge status={node.status} className="h-5 text-[11px]" /></div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-chart-2" />
    </div>
  );
});

const nodeTypes = { card: NodeCard };

function layout(nodes: GraphNode[], edges: GraphEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n) => {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - W / 2, y: p.y - H / 2 };
  });
  return pos;
}

export function DependencyGraph({
  nodes, edges, statusOverride, visible, selectedNode, selectedEdge, onSelectNode, onSelectEdge,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  statusOverride: Record<string, NodeStatus>;
  visible: Set<string>;
  selectedNode: string | null;
  selectedEdge: string | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const pos = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const rfRef = useRef<ReactFlowInstance<Node<CardData>, Edge> | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  useEffect(() => {
    const inst = rfRef.current;
    if (!inst) return;
    if (selectedNode) {
      const p = posRef.current[selectedNode];
      if (p) {
        void inst.setCenter(p.x + W / 2, p.y + H / 2, { zoom: 1.25, duration: 380 });
      }
    } else if (selectedEdge) {
      const e = edgesRef.current.find((x) => x.id === selectedEdge);
      if (e) {
        const p1 = posRef.current[e.source];
        const p2 = posRef.current[e.target];
        if (p1 && p2) {
          const cx = (p1.x + p2.x) / 2 + W / 2;
          const cy = (p1.y + p2.y) / 2 + H / 2;
          void inst.setCenter(cx, cy, { zoom: 1.1, duration: 380 });
        }
      }
    }
  }, [selectedNode, selectedEdge]);

  const rfNodes: Node<CardData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'card',
        position: pos[n.id] ?? { x: 0, y: 0 },
        width: W,
        height: H,
        initialWidth: W,
        initialHeight: H,
        measured: { width: W, height: H },
        data: {
          node: { ...n, status: statusOverride[n.id] ?? n.status },
          selected: selectedNode === n.id,
          dimmed: !visible.has(n.id),
        },
        draggable: false,
      })),
    [nodes, pos, statusOverride, selectedNode, visible],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.verified ? e.kind : `${e.kind} · Unverified`,
        className: cn(!e.verified && 'unverified'),
        selected: selectedEdge === e.id,
        labelStyle: { fontSize: 10, fill: 'var(--color-muted-foreground)' },
        labelBgStyle: { fill: 'var(--color-card)' },
        labelBgPadding: [4, 2] as [number, number],
        style: { opacity: visible.has(e.source) && visible.has(e.target) ? 1 : 0.2 },
      })),
    [edges, selectedEdge, visible],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onInit={(inst) => {
        rfRef.current = inst;
        if (selectedNode && pos[selectedNode]) {
          const p = pos[selectedNode]!;
          setTimeout(() => inst.setCenter(p.x + W / 2, p.y + H / 2, { zoom: 1.25, duration: 420 }), 50);
        }
      }}
      onNodeClick={(_, n) => onSelectNode(n.id)}
      onEdgeClick={(_, e) => onSelectEdge(e.id)}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
    >
      <Background color="var(--color-border)" gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={(n) => ((n.data as CardData).node.status === 'failed' ? 'var(--color-critical)' : (n.data as CardData).node.status === 'degraded' ? 'var(--color-warning)' : 'var(--color-chart-4)')} />
    </ReactFlow>
  );
}
