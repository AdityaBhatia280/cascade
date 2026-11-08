import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, isUsingFixtures, subscribeAgent, subscribeFixtureFlag, subscribeTelemetry } from './api';
import type { Action, AgentStep, Anomaly, Incident, NodeStatus, Simulation, TelemetryReading } from './types';

const MAX_READINGS = 120;

interface CascadeState {
  mode: 'live' | 'replay';
  setMode: (m: 'live' | 'replay') => void;
  usingFixtures: boolean;
  reconnecting: boolean;
  readings: Record<string, TelemetryReading[]>;
  anomalies: Anomaly[];
  nodeStatus: Record<string, NodeStatus>;
  steps: AgentStep[];
  incident: Incident | null;
  simulation: Simulation | null;
  setSimulation: (s: Simulation | null) => void;
  pending: Action[];
  approvalOpen: boolean;
  setApprovalOpen: (o: boolean) => void;
  scenarioRunning: boolean;
  lastUpdated: string | null;
  runScenario: () => Promise<void>;
  approve: (id: string, content?: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  createWorkOrder: (nodeId: string, note: string) => Promise<void>;
}

const Ctx = createContext<CascadeState | null>(null);

export function CascadeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const usingFixtures = useSyncExternalStore(subscribeFixtureFlag, isUsingFixtures, () => isUsingFixtures());
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [teleConnected, setTeleConnected] = useState(true);
  const [agentConnected, setAgentConnected] = useState(true);
  const [readings, setReadings] = useState<Record<string, TelemetryReading[]>>({});
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [nodeStatus, setNodeStatus] = useState<Record<string, NodeStatus>>({});
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [pending, setPending] = useState<Action[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [agentActive, setAgentActive] = useState(false);
  const qcRef = useRef(qc);
  qcRef.current = qc;

  // Seed pending actions from the API.
  useEffect(() => {
    api.actions('pending').then(setPending).catch(() => {});
  }, [usingFixtures]);

  // Telemetry stream
  useEffect(() => {
    return subscribeTelemetry({
      onConnection: setTeleConnected,
      onEvent: {
        reading: (d) => {
          const r = d as TelemetryReading;
          setLastUpdated(r.ts);
          setReadings((prev) => {
            const list = [...(prev[r.point_id] ?? []), r];
            return { ...prev, [r.point_id]: list.slice(-MAX_READINGS) };
          });
        },
        anomaly: (d) => setAnomalies((p) => [...p, d as Anomaly].slice(-50)),
        node_status: (d) => {
          const { node_id, status } = d as { node_id: string; status: NodeStatus };
          setNodeStatus((p) => ({ ...p, [node_id]: status }));
          qcRef.current.invalidateQueries({ queryKey: ['overview'] });
        },
      },
    });
  }, [usingFixtures]);

  // Agent stream (fixture emitter always; SSE only once a scenario has started)
  useEffect(() => {
    if (!usingFixtures && !agentActive) return;
    return subscribeAgent({
      onConnection: setAgentConnected,
      onEvent: {
        incident: (d) => {
          setIncident(d as Incident);
          qcRef.current.invalidateQueries({ queryKey: ['incidents'] });
          qcRef.current.invalidateQueries({ queryKey: ['overview'] });
        },
        simulation: (d) => setSimulation(d as Simulation),
        step: (d) => {
          const s = d as AgentStep;
          setSteps((prev) => {
            const i = prev.findIndex((x) => x.id === s.id);
            if (i === -1) return [...prev, s];
            const next = [...prev];
            next[i] = s;
            return next;
          });
        },
        action_pending: (d) => {
          const a = d as Action;
          setPending((p) => (p.some((x) => x.id === a.id) ? p : [...p, a]));
          if (a.requires_approval) setApprovalOpen(true);
          qcRef.current.invalidateQueries({ queryKey: ['actions'] });
        },
        action_updated: (d) => {
          const a = d as Action;
          setPending((p) => (a.status === 'pending' ? p.map((x) => (x.id === a.id ? a : x)) : p.filter((x) => x.id !== a.id)));
          qcRef.current.invalidateQueries({ queryKey: ['actions'] });
        },
        run_complete: () => {
          setScenarioRunning(false);
          qcRef.current.invalidateQueries({ queryKey: ['incidents'] });
        },
      },
    });
  }, [usingFixtures, agentActive]);

  const runScenario = useCallback(async () => {
    setSteps([]);
    setSimulation(null);
    setScenarioRunning(true);
    setAgentActive(true);
    try {
      await api.startScenario(mode);
    } catch {
      setScenarioRunning(false);
    }
  }, [mode]);

  const settle = useCallback((a: Action) => {
    setPending((p) => p.filter((x) => x.id !== a.id));
    qc.invalidateQueries({ queryKey: ['actions'] });
  }, [qc]);

  const approve = useCallback(async (id: string, content?: string) => settle(await api.approve(id, content)), [settle]);
  const reject = useCallback(async (id: string) => settle(await api.reject(id)), [settle]);
  const createWorkOrder = useCallback(async (nodeId: string, note: string) => {
    const a = await api.createWorkOrder(nodeId, note);
    setPending((p) => (p.some((x) => x.id === a.id) ? p : [...p, a]));
    setApprovalOpen(true);
    qc.invalidateQueries({ queryKey: ['actions'] });
  }, [qc]);

  const value = useMemo<CascadeState>(() => ({
    mode, setMode, usingFixtures,
    reconnecting: !usingFixtures && (!teleConnected || (agentActive && !agentConnected)),
    readings, anomalies, nodeStatus, steps, incident, simulation, setSimulation, pending,
    approvalOpen, setApprovalOpen, scenarioRunning, lastUpdated, runScenario, approve, reject, createWorkOrder,
  }), [mode, usingFixtures, teleConnected, agentActive, agentConnected, readings, anomalies, nodeStatus, steps, incident, simulation, pending, approvalOpen, scenarioRunning, lastUpdated, runScenario, approve, reject, createWorkOrder]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCascade() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCascade must be used inside CascadeProvider');
  return v;
}
