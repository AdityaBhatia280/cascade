import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, isUsingFixtures, subscribeAgent, subscribeFixtureFlag, subscribeTelemetry } from './api';
import type { Action, AgentStep, Anomaly, Incident, NodeStatus, Simulation, TelemetryReading, VoiceCallView, WhatIfResult } from './types';

const MAX_READINGS = 120;

interface CascadeState {
  mode: 'live' | 'replay';
  setMode: (m: 'live' | 'replay') => void;
  usingFixtures: boolean;
  reconnecting: boolean;
  readings: Record<string, TelemetryReading[]>;
  anomalies: Anomaly[];
  nodeStatus: Record<string, NodeStatus>;
  faults: string[];
  whatIf: WhatIfResult | null;
  toggleFault: (nodeId: string) => Promise<void>;
  failNode: (nodeId: string) => Promise<void>;
  healNode: (nodeId: string, upstreamIds?: string[]) => Promise<void>;
  resetFaults: () => Promise<void>;
  setFaults: (faults: string[]) => Promise<void>;
  steps: AgentStep[];
  incident: Incident | null;
  simulation: Simulation | null;
  setSimulation: (s: Simulation | null) => void;
  pending: Action[];
  approvalOpen: boolean;
  setApprovalOpen: (o: boolean) => void;
  scenarioRunning: boolean;
  lastUpdated: string | null;
  runScenario: (overrideMode?: 'live' | 'replay') => Promise<void>;
  approve: (id: string, content?: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  createWorkOrder: (nodeId: string, note: string) => Promise<Action>;
  /** Most recent Retell call the server observed, whoever started it. */
  voiceCall: VoiceCallView | null;
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
  const [whatIf, setWhatIf] = useState<WhatIfResult | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [pending, setPending] = useState<Action[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [voiceCall, setVoiceCall] = useState<VoiceCallView | null>(null);
  const qcRef = useRef(qc);
  qcRef.current = qc;

  // Seed pending actions and initial what-if state from the API.
  useEffect(() => {
    api.actions('pending').then((list) => {
      const seen = new Set<string>();
      const unique = list.filter((a) => {
        const key = `${a.tool}|${a.recipient_display}|${a.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setPending(unique);
    }).catch(() => {});
    api.whatIf().then((res) => {
      setWhatIf(res);
      setNodeStatus((prev) => ({ ...prev, ...res.statuses }));
    }).catch(() => {});
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
        what_if: (d) => {
          const w = d as WhatIfResult;
          setWhatIf(w);
          setNodeStatus(w.statuses);
          qcRef.current.invalidateQueries({ queryKey: ['overview'] });
        },
      },
    });
  }, [usingFixtures]);

  // Agent stream — always connected so Live and Replay events are received immediately
  useEffect(() => {
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
          setPending((p) => {
            const exists = p.some(
              (x) => x.id === a.id || (x.tool === a.tool && x.recipient_display === a.recipient_display && x.content === a.content),
            );
            return exists ? p : [...p, a];
          });
          // Do not auto-open approval modal; let the user open the notification bell menu when ready
          qcRef.current.invalidateQueries({ queryKey: ['actions'] });
        },
        action_updated: (d) => {
          const a = d as Action;
          setPending((p) => (a.status === 'pending' ? p.map((x) => (x.id === a.id ? a : x)) : p.filter((x) => x.id !== a.id)));
          qcRef.current.invalidateQueries({ queryKey: ['actions'] });
        },
        voice_call: (d) => {
          const v = d as VoiceCallView;
          setVoiceCall((cur) =>
            !cur || cur.call_id === v.call_id || v.call_status === 'ongoing' || cur.call_status !== 'ongoing' ? v : cur,
          );
        },
        voice_call_outcome: () => {
          qcRef.current.invalidateQueries({ queryKey: ['actions'] });
          qcRef.current.invalidateQueries({ queryKey: ['incidents'] });
          qcRef.current.invalidateQueries({ queryKey: ['overview'] });
        },
        run_complete: () => {
          setScenarioRunning(false);
          qcRef.current.invalidateQueries({ queryKey: ['incidents'] });
          qcRef.current.invalidateQueries({ queryKey: ['overview'] });
        },
      },
    });
  }, [usingFixtures]);

  const runScenario = useCallback(async (overrideMode?: 'live' | 'replay') => {
    const targetMode = overrideMode ?? mode;
    if (overrideMode) setMode(overrideMode);
    setSteps([]);
    setSimulation(null);
    // Clear previous unapproved scenario actions before starting a fresh run
    setPending((p) => p.filter((a) => a.run_id === 'manual'));
    setScenarioRunning(true);
    try {
      await api.startScenario(targetMode);
    } catch {
      setScenarioRunning(false);
    }
  }, [mode]);

  const applyFaults = useCallback(async (nextFaults: string[]) => {
    setSimulation(null);
    const unique = [...new Set(nextFaults)];
    const res = await api.setWhatIf(unique);
    setWhatIf(res);
    setNodeStatus(res.statuses);
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['incidents'] });
  }, [qc]);

  // Helper to get active root faults, even if an older scenario set nodeStatus without whatIf
  const getActiveFaults = useCallback((): string[] => {
    const scenarioOutOfSync =
      (nodeStatus['UPS-B'] === 'failed' && whatIf?.statuses?.['UPS-B'] !== 'failed') ||
      (nodeStatus['CH-2'] === 'failed' && whatIf?.statuses?.['CH-2'] !== 'failed');
    if (scenarioOutOfSync) {
      return ['UPS-B', 'CH-2', 'CH-3', 'SW-03', 'work_orders'].filter((id) => nodeStatus[id] === 'failed');
    }
    return whatIf?.faults ?? [];
  }, [whatIf, nodeStatus]);

  const failNode = useCallback(async (nodeId: string) => {
    const cur = getActiveFaults();
    const next = cur.includes(nodeId) ? cur : [...cur, nodeId];
    await applyFaults(next);
  }, [getActiveFaults, applyFaults]);

  const healNode = useCallback(async (nodeId: string, upstreamIds: string[] = []) => {
    const cur = getActiveFaults();
    const toRemove = new Set([nodeId, ...upstreamIds]);
    // If CH-1 and CRAH-4 were marked failed in nodeStatus because UPS-B failed, don't treat them as independent root faults when healing UPS-B
    if (toRemove.has('UPS-B')) {
      toRemove.add('CH-1');
      toRemove.add('CRAH-4');
    }
    const next = cur.filter((id) => !toRemove.has(id));
    await applyFaults(next);
  }, [getActiveFaults, applyFaults]);

  const toggleFault = useCallback(async (nodeId: string) => {
    const cur = getActiveFaults();
    const isCurrentlyFailed = cur.includes(nodeId) || nodeStatus[nodeId] === 'failed';
    if (isCurrentlyFailed) {
      await healNode(nodeId);
    } else {
      await failNode(nodeId);
    }
  }, [getActiveFaults, nodeStatus, healNode, failNode]);

  const resetFaults = useCallback(async () => {
    setSimulation(null);
    await applyFaults([]);
  }, [applyFaults]);

  const settle = useCallback((a: Action) => {
    setPending((p) => p.filter((x) => x.id !== a.id));
    qc.invalidateQueries({ queryKey: ['actions'] });
  }, [qc]);

  const approve = useCallback(async (id: string, content?: string) => settle(await api.approve(id, content)), [settle]);
  const reject = useCallback(async (id: string) => settle(await api.reject(id)), [settle]);
  const createWorkOrder = useCallback(async (nodeId: string, note: string): Promise<Action> => {
    const a = await api.createWorkOrder(nodeId, note);
    setPending((p) => (p.some((x) => x.id === a.id) ? p : [...p, a]));
    // Notification bell updates automatically without forcing a modal popup
    qc.invalidateQueries({ queryKey: ['actions'] });
    return a;
  }, [qc]);

  const faults = useMemo(() => getActiveFaults(), [getActiveFaults]);

  const value = useMemo<CascadeState>(() => ({
    mode, setMode, usingFixtures,
    reconnecting: !usingFixtures && (!teleConnected || !agentConnected),
    readings, anomalies, nodeStatus, faults, whatIf, toggleFault, failNode, healNode, resetFaults, setFaults: applyFaults,
    steps, incident, simulation, setSimulation, pending,
    approvalOpen, setApprovalOpen, scenarioRunning, lastUpdated, runScenario, approve, reject, createWorkOrder, voiceCall,
  }), [mode, usingFixtures, teleConnected, agentConnected, readings, anomalies, nodeStatus, faults, whatIf, toggleFault, failNode, healNode, resetFaults, applyFaults, steps, incident, simulation, pending, approvalOpen, scenarioRunning, lastUpdated, runScenario, approve, reject, createWorkOrder, voiceCall]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCascade() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCascade must be used inside CascadeProvider');
  return v;
}
