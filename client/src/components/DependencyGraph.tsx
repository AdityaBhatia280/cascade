import React, { useRef, useEffect, useState } from 'react';
import type { GraphNode, GraphEdge } from '../types';

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode | null) => void;
  cascadeTimelineStep?: number;
}

export const DependencyGraph: React.FC<Props> = ({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
  cascadeTimelineStep = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Viewport transformation
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.85 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);

  // Local simulation nodes with positions
  const simNodesRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());

  // Initialize node layout relative to center origin (0, 0)
  useEffect(() => {
    if (nodes.length === 0) return;
    const radius = 240;

    nodes.forEach((n, idx) => {
      if (!simNodesRef.current.has(n.id)) {
        const angle = (idx / nodes.length) * 2 * Math.PI;
        simNodesRef.current.set(n.id, {
          x: Math.cos(angle) * (radius + (idx % 2 === 0 ? 35 : -35)),
          y: Math.sin(angle) * (radius + (idx % 2 === 0 ? 35 : -35)),
          vx: 0,
          vy: 0,
        });
      }
    });
  }, [nodes]);

  // Main rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      if (containerRef.current && (canvas.width !== containerRef.current.clientWidth || canvas.height !== containerRef.current.clientHeight)) {
        canvas.width = containerRef.current.clientWidth || 800;
        canvas.height = containerRef.current.clientHeight || 600;
      }

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      ctx.save();
      // Center the viewport at canvas center + user pan
      ctx.translate(width / 2 + transform.x, height / 2 + transform.y);
      ctx.scale(transform.k, transform.k);

      // Draw subtle background grid centered at (0, 0)
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      const gridSize = 40;
      const extent = Math.max(width, height) * 2;
      for (let x = -extent; x <= extent; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, -extent);
        ctx.lineTo(x, extent);
        ctx.stroke();
      }
      for (let y = -extent; y <= extent; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(-extent, y);
        ctx.lineTo(extent, y);
        ctx.stroke();
      }

      // Draw Edges
      edges.forEach((edge) => {
        const sourcePos = simNodesRef.current.get(edge.source);
        const targetPos = simNodesRef.current.get(edge.target);
        if (!sourcePos || !targetPos) return;

        ctx.beginPath();
        ctx.moveTo(sourcePos.x, sourcePos.y);
        ctx.lineTo(targetPos.x, targetPos.y);

        if (edge.verified === false) {
          ctx.setLineDash([4, 4]); // Dashed for unverified
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.2;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.5;
        }

        ctx.stroke();

        // Edge labels
        const midX = (sourcePos.x + targetPos.x) / 2;
        const midY = (sourcePos.y + targetPos.y) / 2;
        ctx.fillStyle = '#64748b';
        ctx.font = '9px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(edge.kind, midX, midY - 4);
      });

      // Draw Nodes
      nodes.forEach((node) => {
        const pos = simNodesRef.current.get(node.id);
        if (!pos) return;

        const isSelected = selectedNode?.id === node.id;
        const radius = node.type === 'system' ? 18 : node.type === 'tenant' ? 22 : 15;

        // Color based on status and risk
        let nodeColor = '#10b981'; // healthy
        let glowColor = 'rgba(16, 185, 129, 0.4)';

        if (node.status === 'failed') {
          nodeColor = '#ef4444';
          glowColor = 'rgba(239, 68, 68, 0.7)';
        } else if (node.status === 'degraded') {
          nodeColor = '#f59e0b';
          glowColor = 'rgba(245, 158, 11, 0.6)';
        } else if ((node.risk_score || 0) > 0.8) {
          nodeColor = '#f97316';
          glowColor = 'rgba(249, 115, 22, 0.4)';
        }

        // Draw Glow
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + (isSelected ? 8 : 4), 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(59, 130, 246, 0.6)' : glowColor;
        ctx.fill();

        // Node Body
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeStyle = isSelected ? '#38bdf8' : nodeColor;
        ctx.stroke();

        // Redundancy badge for k-of-n
        if (node.n_total && node.n_total > 1) {
          ctx.fillStyle = '#38bdf8';
          ctx.font = '8px JetBrains Mono';
          ctx.textAlign = 'center';
          ctx.fillText(`${node.k_required}/${node.n_total}`, pos.x, pos.y - radius - 5);
        }

        // Node Label
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `${isSelected ? 'bold ' : ''}11px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(node.label || node.id, pos.x, pos.y + radius + 14);

        // Node Type
        ctx.fillStyle = '#64748b';
        ctx.font = '8px JetBrains Mono';
        ctx.fillText(node.type.toUpperCase(), pos.x, pos.y + radius + 24);
      });

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [nodes, edges, selectedNode, transform]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mouse Interactions (Pan, Zoom, Node Click)
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const centerX = canvas.width / 2 + transform.x;
    const centerY = canvas.height / 2 + transform.y;
    const mouseX = (e.clientX - rect.left - centerX) / transform.k;
    const mouseY = (e.clientY - rect.top - centerY) / transform.k;

    // Check if clicked on a node
    let clickedNode: GraphNode | null = null;
    for (const node of nodes) {
      const pos = simNodesRef.current.get(node.id);
      if (!pos) continue;
      const dist = Math.hypot(pos.x - mouseX, pos.y - mouseY);
      if (dist <= 24) {
        clickedNode = node;
        break;
      }
    }

    if (clickedNode) {
      draggedNodeRef.current = clickedNode;
      onSelectNode(clickedNode);
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
      onSelectNode(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggedNodeRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const centerX = canvas.width / 2 + transform.x;
      const centerY = canvas.height / 2 + transform.y;
      const mouseX = (e.clientX - rect.left - centerX) / transform.k;
      const mouseY = (e.clientY - rect.top - centerY) / transform.k;
      const pos = simNodesRef.current.get(draggedNodeRef.current.id);
      if (pos) {
        pos.x = mouseX;
        pos.y = mouseY;
      }
    } else if (isDraggingRef.current) {
      setTransform((prev) => ({
        ...prev,
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      }));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    draggedNodeRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform((prev) => ({
      ...prev,
      k: Math.max(0.2, Math.min(3, prev.k * zoomFactor)),
    }));
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#07090e',
        overflow: 'hidden',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* Floating Graph Controls */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '6px',
        zIndex: 10,
      }}>
        <button
          onClick={() => setTransform((prev) => ({ ...prev, k: Math.min(3, prev.k * 1.2) }))}
          style={{
            backgroundColor: '#1e293b',
            color: '#cbd5e1',
            border: 'none',
            borderRadius: '4px',
            width: '28px',
            height: '28px',
            fontSize: '16px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          +
        </button>
        <button
          onClick={() => setTransform((prev) => ({ ...prev, k: Math.max(0.3, prev.k * 0.8) }))}
          style={{
            backgroundColor: '#1e293b',
            color: '#cbd5e1',
            border: 'none',
            borderRadius: '4px',
            width: '28px',
            height: '28px',
            fontSize: '16px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          -
        </button>
        <button
          onClick={() => setTransform({ x: 0, y: 0, k: 0.85 })}
          style={{
            backgroundColor: '#1e293b',
            color: '#cbd5e1',
            border: 'none',
            borderRadius: '4px',
            width: '28px',
            height: '28px',
            fontSize: '10px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          FIT
        </button>
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '8px 12px',
        fontSize: '10px',
        color: '#94a3b8',
        display: 'flex',
        gap: '12px',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} /> Healthy
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} /> Degraded
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} /> Failed
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '12px', borderTop: '2px solid #334155' }} /> Verified
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '12px', borderTop: '2px dashed #64748b' }} /> Unverified
        </div>
      </div>
    </div>
  );
};

