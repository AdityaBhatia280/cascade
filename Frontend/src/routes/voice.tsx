import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, Mail, Mic, Phone, PhoneCall, PhoneIncoming, PhoneOff, Volume2, X } from 'lucide-react';
import { api, isUsingFixtures } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { usd } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState, Mono, Panel, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/voice')({
  validateSearch: (s: Record<string, unknown>): { incident?: string } =>
    typeof s['incident'] === 'string' ? { incident: s['incident'] } : {},
  head: pageHead('Voice agent', 'Outbound phone dispatch & browser voice briefing for active Cascade incidents.'),
  component: Voice,
});

type CallState = 'idle' | 'connecting' | 'live' | 'phone_ringing' | 'phone_live' | 'ended' | 'simulated';
type Line = { role: string; content: string };

const VOICE_APPROVAL_REGEX = /\b(approve|confirm|yes dispatch|dispatch now|execute|send the email|go ahead|authorize)\b/i;

function Voice() {
  const { incident: searchIncId } = Route.useSearch();
  const { incident: sseIncident, simulation: sseSim, steps: sseSteps, approve, reject, runScenario, scenarioRunning } = useCascade();

  const incidentsQ = useQuery({ queryKey: ['incidents'], queryFn: api.incidents, refetchInterval: 3000 });
  const actionsQ = useQuery({ queryKey: ['actions', 'all'], queryFn: () => api.actions(), refetchInterval: 3000 });
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph });

  const [selectedIncId, setSelectedIncId] = useState<string | null>(searchIncId ?? null);

  useEffect(() => {
    if (searchIncId) setSelectedIncId(searchIncId);
  }, [searchIncId]);

  const activeIncident = useMemo(() => {
    const list = incidentsQ.data ?? [];
    if (selectedIncId) {
      const found = list.find((i) => i.id === selectedIncId);
      if (found) return found;
    }
    if (sseIncident) return sseIncident;
    return list[0] ?? null;
  }, [incidentsQ.data, selectedIncId, sseIncident]);

  const incDetailQ = useQuery({
    queryKey: ['incidents', activeIncident?.id],
    queryFn: () => api.incident(activeIncident!.id),
    enabled: Boolean(activeIncident?.id),
    refetchInterval: 3000,
  });

  const activeSim = incDetailQ.data?.simulation ?? sseSim;
  const activeSteps = incDetailQ.data?.steps?.length ? incDetailQ.data.steps : sseSteps;

  const label = (id: string) => graph.data?.nodes.find((n) => n.id === id)?.label ?? id;
  const [state, setState] = useState<CallState>('idle');
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceAutoApproved, setVoiceAutoApproved] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  // Outbound Phone Call state (Toyotron-style physical phone call)
  const [phoneNumber, setPhoneNumber] = useState<string>(() => {
    if (typeof window === 'undefined') return '+1 (469) 685-5805';
    const saved = window.localStorage.getItem('cascade_operator_phone');
    return saved && saved.trim() ? saved : '+1 (469) 685-5805';
  });
  const [autoCallOnIncident, setAutoCallOnIncident] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = window.localStorage.getItem('cascade_auto_phone_call');
    return saved === null ? true : saved === 'true';
  });
  const [activePhoneCallId, setActivePhoneCallId] = useState<string | null>(null);
  const [phoneCallMeta, setPhoneCallMeta] = useState<{ from: string; to: string; summary?: string } | null>(null);
  const [voiceCreatedTicket, setVoiceCreatedTicket] = useState<{ incidentId: string; actionId: string; nodeId: string } | null>(null);
  const lastAutoCalledIncidentRef = useRef<string | null>(null);

  const clientRef = useRef<{ stopCall: () => void } | null>(null);
  const autoApproveTriggeredRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cascade_operator_phone', phoneNumber);
    }
  }, [phoneNumber]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cascade_auto_phone_call', String(autoCallOnIncident));
    }
  }, [autoCallOnIncident]);

  useEffect(() => {
    return () => {
      clientRef.current?.stopCall();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const [dismissedActionIds, setDismissedActionIds] = useState<Set<string>>(() => new Set());

  const runActions = useMemo(() => {
    const all = actionsQ.data ?? [];
    if (!activeIncident) return all;
    const filtered = all.filter((a) => a.run_id === activeIncident.agent_run_id || a.run_id === 'manual');
    return filtered.length > 0 ? filtered : all;
  }, [actionsQ.data, activeIncident]);

  const done = runActions.filter((a) => (a.status === 'executed' || a.status === 'approved') && !dismissedActionIds.has(a.id));
  const needs = runActions.filter((a) => a.status === 'pending');
  const suggestions = activeSteps.filter((s) => s.stage === 'plan').map((s) => s.summary);

  const handleClearApproved = async () => {
    try {
      await api.clearActions(false);
      await actionsQ.refetch();
    } catch {
      // Fallback: dismiss in local state
    }
    setDismissedActionIds((prev) => {
      const next = new Set(prev);
      runActions.forEach((a) => next.add(a.id));
      return next;
    });
  };

  const handleStartFreshIncident = async () => {
    try {
      await api.clearIncidents(false);
      await api.clearActions(false);
      setVoiceCreatedTicket(null);
      setVoiceAutoApproved(false);
      setSelectedIncId(null);
      setTranscript([]);
      setState('idle');
      await incidentsQ.refetch();
      await actionsQ.refetch();
    } catch {
      // Ignore
    }
  };

  const scripted = (): Line[] => {
    if (!activeIncident) {
      return [{ role: 'agent', content: 'Hello, this is Cascade AI. There is currently no active incident ticket to brief on.' }];
    }
    const lines: Line[] = [
      {
        role: 'agent',
        content: `Hello, this is Cascade AI with a live facility dispatch briefing for Cascade Tower regarding incident ${activeIncident.id}: ${activeIncident.title}. Root cause traced to ${label(activeIncident.root_node)} (${activeIncident.root_node}).`,
      },
    ];
    activeSim?.impacts.forEach((i) =>
      lines.push({
        role: 'agent',
        content: `${i.tenant_label} is predicted to reach thermal SLA breach in ${i.minutes_to_impact} minutes, with ${usd(i.sla_credit_usd ?? 0)} SLA credit exposure.`,
      }),
    );
    done.forEach((a) =>
      lines.push({
        role: 'agent',
        content: `Already executed (${a.id}): ${a.tool.replace(/_/g, ' ')} to ${a.recipient_display}.`,
      }),
    );
    needs.forEach((a) =>
      lines.push({
        role: 'agent',
        content: `Awaiting your approval (${a.id}): ${a.tool.replace(/_/g, ' ')} to ${a.recipient_display} (${usd(a.usd_impact)} impact).`,
      }),
    );
    if (needs.length > 0) {
      lines.push({
        role: 'agent',
        content: `Would you like me to approve and dispatch these ${needs.length} pending actions to vicalexsim@gmail.com now?`,
      });
    }
    return lines;
  };

  const speakLines = (lines: Line[]) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const fullText = lines.map((l) => l.content).join(' ');
    const utter = new SpeechSynthesisUtterance(fullText);
    utter.rate = 1.02;
    utter.onend = () => setState('ended');
    window.speechSynthesis.speak(utter);
  };

  // Detect verbal approval in live Retell transcript (both Phone Calls and Browser Web Calls)
  useEffect(() => {
    if (
      (state !== 'live' && state !== 'phone_live' && state !== 'phone_ringing') ||
      needs.length === 0 ||
      autoApproveTriggeredRef.current
    ) {
      return;
    }
    const userLines = transcript.filter((l) => l.role.toLowerCase() === 'user');
    const latestUserText = userLines.map((l) => l.content).join(' ');
    if (VOICE_APPROVAL_REGEX.test(latestUserText)) {
      autoApproveTriggeredRef.current = true;
      setVoiceAutoApproved(true);
      void (async () => {
        for (const act of needs) {
          await approve(act.id);
        }
        await actionsQ.refetch();
      })();
    }
  }, [transcript, state, needs, approve, actionsQ]);

  // Poll Retell call status + live transcript while an outbound phone call is active
  useEffect(() => {
    if (!activePhoneCallId) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await api.voiceCallStatus(activePhoneCallId);
        if (!active) return;
        if (res.transcript.length > 0) {
          setTranscript(res.transcript);
        }
        if ((res as { auto_dispatched?: boolean }).auto_dispatched) {
          setVoiceAutoApproved(true);
          void actionsQ.refetch();
        }
        const created = (res as { created_ticket?: { incidentId: string; actionId: string; nodeId: string } }).created_ticket;
        if (created) {
          setVoiceCreatedTicket(created);
          setSelectedIncId(created.incidentId);
          void incidentsQ.refetch();
          void actionsQ.refetch();
        }
        if (res.call_summary) {
          setPhoneCallMeta((prev) => (prev ? { ...prev, summary: res.call_summary } : null));
        }
        if (res.call_status === 'ongoing') {
          setState('phone_live');
        } else if (res.call_status === 'ended' || res.call_status === 'error') {
          setState('ended');
          setActivePhoneCallId(null);
        }
      } catch {
        // Keep polling until ended
      }
    };
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activePhoneCallId, actionsQ, incidentsQ]);

  // Also sync any inbound calls (+1 469-429-6682) or Retell Dashboard "Run Test" calls automatically
  useEffect(() => {
    if (isUsingFixtures() || activePhoneCallId || state === 'live') return;
    const syncTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/voice/latest-call');
        if (!res.ok) return;
        const data = (await res.json()) as {
          call_id?: string | null;
          call_status?: string;
          transcript?: Line[];
          call_summary?: string;
          auto_dispatched?: boolean;
          created_ticket?: { incidentId: string; actionId: string; nodeId: string };
        };
        if (data.call_id && Array.isArray(data.transcript) && data.transcript.length > 0) {
          setTranscript(data.transcript);
          if (data.call_status === 'ongoing') {
            setState('phone_live');
          }
          if (data.auto_dispatched) {
            setVoiceAutoApproved(true);
            void actionsQ.refetch();
          }
          if (data.created_ticket) {
            setVoiceCreatedTicket(data.created_ticket);
            setSelectedIncId(data.created_ticket.incidentId);
            void incidentsQ.refetch();
            void actionsQ.refetch();
          }
        }
      } catch {
        // Ignore transient sync errors
      }
    }, 3000);
    return () => clearInterval(syncTimer);
  }, [activePhoneCallId, state, actionsQ, incidentsQ]);

  const startPhoneCall = async (targetPhone = phoneNumber, incId = activeIncident?.id) => {
    setError(null);
    setTranscript([]);
    setVoiceAutoApproved(false);
    autoApproveTriggeredRef.current = false;
    setState('phone_ringing');
    try {
      const res = await api.voicePhoneCall(targetPhone, incId);
      setActivePhoneCallId(res.call_id);
      setPhoneCallMeta({ from: res.from_number, to: res.to_number });
    } catch (e) {
      setState('idle');
      setError((e as Error).message);
    }
  };

  // Auto-dial operator phone when a new incident triggers via SSE if enabled
  useEffect(() => {
    if (
      autoCallOnIncident &&
      phoneNumber.trim().length >= 10 &&
      sseIncident &&
      lastAutoCalledIncidentRef.current !== sseIncident.id
    ) {
      lastAutoCalledIncidentRef.current = sseIncident.id;
      void startPhoneCall(phoneNumber, sseIncident.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCallOnIncident, phoneNumber, sseIncident?.id]);

  const start = async () => {
    setError(null);
    setTranscript([]);
    setVoiceAutoApproved(false);
    autoApproveTriggeredRef.current = false;
    setState('connecting');
    try {
      const { access_token } = await api.voiceWebCall(activeIncident?.id);
      const { RetellWebClient } = await import('retell-client-js-sdk');
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on('call_started', () => setState('live'));
      client.on('call_ended', () => setState('ended'));
      client.on('update', (u: { transcript?: Line[] }) => u.transcript && setTranscript(u.transcript));
      client.on('error', () => {
        const fallback = scripted();
        setState('simulated');
        setTranscript(fallback);
        speakLines(fallback);
      });
      await client.startCall({ accessToken: access_token });
    } catch (e) {
      const fallback = scripted();
      setError(isUsingFixtures() ? 'Voice backend is not connected in preview.' : (e as Error).message);
      setState('simulated');
      setTranscript(fallback);
      speakLines(fallback);
    }
  };

  const startSpokenSimulation = () => {
    setError(null);
    const lines = scripted();
    setTranscript(lines);
    setState('simulated');
    speakLines(lines);
  };

  const stop = () => {
    clientRef.current?.stopCall();
    setActivePhoneCallId(null);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState('ended');
  };

  const handleApproveOne = async (id: string) => {
    setBusyActionId(id);
    try {
      await approve(id);
      await actionsQ.refetch();
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRejectOne = async (id: string) => {
    setBusyActionId(id);
    try {
      await reject(id);
      await actionsQ.refetch();
    } finally {
      setBusyActionId(null);
    }
  };

  const handleApproveAll = async () => {
    setBusyActionId('all');
    try {
      for (const a of needs) {
        await approve(a.id);
      }
      setVoiceAutoApproved(true);
      await actionsQ.refetch();
    } finally {
      setBusyActionId(null);
    }
  };

  const incidentList = incidentsQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Voice agent</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Outbound phone dispatch &amp; interactive browser voice briefing powered by Retell AI (`agent_3fd1037af56c2e7c655ff8f3f3`) and Resend.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {incidentList.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
              <span className="font-medium text-muted-foreground">Incident ticket:</span>
              <select
                value={activeIncident?.id ?? ''}
                onChange={(e) => setSelectedIncId(e.target.value)}
                className="bg-transparent font-mono font-semibold text-foreground focus:outline-none"
              >
                {incidentList.map((inc) => (
                  <option key={inc.id} value={inc.id}>
                    {inc.id} · {inc.title} ({inc.status})
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => void handleStartFreshIncident()}
                title="Reset active tickets & actions to start clean"
              >
                Reset
              </Button>
            </div>
          )}
          <StatusBadge
            status={isUsingFixtures() ? 'pending' : 'healthy'}
            label={isUsingFixtures() ? 'Agent offline in preview' : 'Retell PSTN + WebRTC ready'}
          />
        </div>
      </div>

      {/* Incoming Dispatch Call Alert when an incident is open/mitigating */}
      {activeIncident && state === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <PhoneIncoming className="size-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-primary">{activeIncident.id}</span>
                <span className="text-sm font-semibold text-foreground">
                  Cascade AI Dispatch Briefing Ready — {activeIncident.title}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Have Cascade AI call your physical phone or answer in your browser. Say <strong>&ldquo;Approve and dispatch&rdquo;</strong> during the call to send real emails &amp; `.ics` invites to <Mono>vicalexsim@gmail.com</Mono>.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {phoneNumber.trim().length >= 10 && (
              <Button size="sm" onClick={() => void startPhoneCall()}>
                <PhoneCall className="size-3.5" /> Call {phoneNumber}
              </Button>
            )}
            <Button size="sm" variant={phoneNumber.trim().length >= 10 ? 'secondary' : 'default'} onClick={() => void start()}>
              <Mic className="size-3.5" /> Browser WebRTC call
            </Button>
            <Button size="sm" variant="secondary" onClick={startSpokenSimulation}>
              <Volume2 className="size-3.5" /> Play speaker briefing
            </Button>
          </div>
        </div>
      )}

      {voiceCreatedTicket && (
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-xs text-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <span>
            <strong>Voice Incident Ticket &amp; Work Order Created:</strong> Logged incident{' '}
            <Mono className="font-semibold">{voiceCreatedTicket.incidentId}</Mono> and work order{' '}
            <Mono className="font-semibold">{voiceCreatedTicket.actionId}</Mono> for component{' '}
            <Mono>{voiceCreatedTicket.nodeId}</Mono> into <Mono>server/data/cascade-db.json</Mono> and updated the live dependency graph.
          </span>
        </div>
      )}

      {voiceAutoApproved && (
        <div className="flex items-center gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 px-4 py-3 text-xs text-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-chart-4" />
          <span>
            <strong>Dispatched via Resend:</strong> Pending actions for <Mono>{activeIncident?.id ?? 'INC'}</Mono> were approved and sent to <Mono>vicalexsim@gmail.com</Mono>.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          {/* Toyotron-style Outbound Phone Dispatch Card */}
          <Panel
            title="Call my phone (Retell outbound phone dispatch)"
            action={
              phoneCallMeta ? (
                <Mono className="text-[11px] text-muted-foreground">
                  {phoneCallMeta.from} → {phoneCallMeta.to}
                </Mono>
              ) : undefined
            }
          >
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  On-call engineer phone number (US 10-digit or +1 E.164)
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+1 (214) 555-0199"
                    className="flex-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                  <Button
                    onClick={() => void startPhoneCall()}
                    disabled={!phoneNumber.trim() || state === 'phone_ringing' || state === 'phone_live'}
                    className="shrink-0 justify-center text-center"
                  >
                    <Phone className="size-4" />
                    {state === 'phone_ringing'
                      ? 'Dialing phone…'
                      : state === 'phone_live'
                        ? 'On phone call'
                        : 'Call my phone'}
                  </Button>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoCallOnIncident}
                  onChange={(e) => setAutoCallOnIncident(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Automatically call my phone when a new incident triggers</span>
              </label>

              {phoneCallMeta?.summary && (
                <div className="rounded-md border border-border bg-secondary/40 p-2.5 text-xs">
                  <span className="font-semibold text-foreground">Post-call extraction summary: </span>
                  <span className="text-muted-foreground">{phoneCallMeta.summary}</span>
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="Incident context injected into Retell LLM"
            action={activeIncident ? <Mono className="text-xs font-semibold">{activeIncident.id}</Mono> : undefined}
          >
            {!activeIncident ? (
              <EmptyState
                title="No active incident"
                body="Run the incident scenario first so the voice agent has live context."
                action={
                  <Button size="sm" onClick={runScenario} disabled={scenarioRunning}>
                    {scenarioRunning ? 'Running scenario…' : 'Run incident scenario'}
                  </Button>
                }
              />
            ) : (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="label-text">Incident ticket</dt>
                  <dd className="mt-0.5 flex items-center gap-2 font-medium">
                    <Mono className="rounded bg-secondary px-1.5 py-0.5 text-xs">{activeIncident.id}</Mono>
                    <span>{activeIncident.title}</span>
                  </dd>
                </div>
                <div>
                  <dt className="label-text">Root cause</dt>
                  <dd>
                    {label(activeIncident.root_node)} (<Mono className="text-xs">{activeIncident.root_node}</Mono>)
                  </dd>
                </div>
                <div>
                  <dt className="label-text">Predicted tenant impact &amp; exposure</dt>
                  <dd>
                    {activeSim?.impacts.length
                      ? activeSim.impacts
                          .map((i) => `${i.tenant_label} (T+${i.minutes_to_impact} min · ${usd(i.sla_credit_usd ?? 0)} SLA)`)
                          .join(', ')
                      : '$16,000 exposure at risk (Acme Cloud Services)'}
                  </dd>
                </div>
                <div>
                  <dt className="label-text">Demo email routing (Resend)</dt>
                  <dd className="flex items-center gap-1.5 text-xs">
                    <Mail className="size-3.5 text-muted-foreground" />
                    <Mono>vicalexsim@gmail.com</Mono>
                  </dd>
                </div>
                <div>
                  <dt className="label-text">Mitigation actions</dt>
                  <dd className="tnum">
                    {done.length} executed · {needs.length} awaiting approval
                  </dd>
                </div>
              </dl>
            )}
          </Panel>

          <div className="rounded-lg border border-border bg-card p-6 text-center">
            {state === 'live' || state === 'connecting' || state === 'phone_ringing' || state === 'phone_live' ? (
              <Button variant="danger" size="lg" className="h-14 w-full justify-center text-base" onClick={stop}>
                <PhoneOff /> {state === 'phone_ringing' || state === 'phone_live' ? 'Stop tracking phone call' : 'End browser call'}
              </Button>
            ) : (
              <div className="space-y-2.5">
                <Button
                  variant="secondary"
                  size="lg"
                  className="h-12 w-full justify-center text-sm"
                  onClick={() => void start()}
                >
                  <Mic /> Start browser WebRTC call (no phone required)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={startSpokenSimulation}
                >
                  <Volume2 className="size-3.5" /> Speak briefing aloud (browser TTS fallback)
                </Button>
              </div>
            )}
            <div className="mt-3 flex justify-center">
              {state === 'connecting' && <StatusBadge status="connecting" />}
              {state === 'phone_ringing' && <StatusBadge status="connecting" label={`Dialing ${phoneCallMeta?.to || phoneNumber}…`} />}
              {state === 'phone_live' && <StatusBadge status="live" label="Live phone call · Streaming transcript" />}
              {state === 'live' && <StatusBadge status="live" label="Live browser WebRTC · Listening for 'Approve'" />}
              {state === 'ended' && <StatusBadge status="pending" label="Call ended" />}
              {state === 'simulated' && <StatusBadge status="degraded" label="Spoken TTS fallback" />}
            </div>
            {error && <p className="mt-2 text-xs text-critical">{error}</p>}
          </div>
        </div>

        <div className="space-y-6">
          <Panel
            title="Multi-step NVIDIA Nemotron voice workflow"
            action={<Mono className="text-[11px] text-muted-foreground">5-stage orchestration</Mono>}
          >
            <ol className="space-y-2.5 text-xs">
              {[
                {
                  idx: 1,
                  stage: '1. Context & Graph Extraction',
                  model: 'Nemotron-3-Nano-30B',
                  detail: `Queries 20-node digital twin for ${activeIncident?.id ?? 'INC-1001'}, isolates root cause (${activeIncident?.root_node ?? 'UPS-B'}), and packages $16,000 SLA exposure.`,
                  done: Boolean(activeIncident),
                  active: false,
                },
                {
                  idx: 2,
                  stage: '2. Autonomous Voice Dispatch',
                  model: 'Retell PSTN + Dynamic LLM',
                  detail: `Injects live incident variables into llm_ac27b6000dcb2632902882fb5415 and dials ${phoneNumber || '+1 (469) 685-5805'} (or WebRTC session).`,
                  done: state === 'live' || state === 'phone_live' || state === 'ended' || state === 'simulated',
                  active: state === 'connecting' || state === 'phone_ringing',
                },
                {
                  idx: 3,
                  stage: '3. Live Spoken Intent & Replan Reasoning',
                  model: 'Nemotron-3-Super-120B',
                  detail: 'Streams real-time operator utterances from the call transcript and evaluates verbal tool-execution authorization.',
                  done: transcript.some((t) => t.role.toLowerCase() === 'user') || voiceAutoApproved || done.length > 0,
                  active: state === 'live' || state === 'phone_live',
                },
                {
                  idx: 4,
                  stage: '4. Multi-Tool Cross-System Execution',
                  model: 'Resend API + RFC 5545 .ics',
                  detail: `Executes send_email (Acme Cloud SLA notice), schedule_maintenance (.ics vendor invite), and create_work_order to vicalexsim@gmail.com.`,
                  done: voiceAutoApproved || (done.length > 0 && needs.length === 0),
                  active: busyActionId !== null,
                },
                {
                  idx: 5,
                  stage: '5. Post-Call Verification & Audit Trail',
                  model: 'Nemotron-3-Nano-30B',
                  detail: phoneCallMeta?.summary
                    ? `Post-call extraction: ${phoneCallMeta.summary}`
                    : 'Verifies Resend delivery IDs, logs ACT-2001+ audit records, and extracts post-call sentiment & summary.',
                  done: (state === 'ended' && (voiceAutoApproved || done.length > 0)) || Boolean(phoneCallMeta?.summary),
                  active: false,
                },
              ].map((w) => (
                <li
                  key={w.idx}
                  className={cn(
                    'flex items-start justify-between gap-3 rounded-md border p-2.5 transition-colors',
                    w.done
                      ? 'border-chart-4/40 bg-chart-4/5'
                      : w.active
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-secondary/20',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{w.stage}</span>
                      <Mono className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {w.model}
                      </Mono>
                    </div>
                    <p className="mt-1 text-muted-foreground">{w.detail}</p>
                  </div>
                  <StatusBadge
                    status={w.done ? 'executed' : w.active ? 'running' : 'pending'}
                    label={w.done ? 'Completed' : w.active ? 'Running' : 'Queued'}
                  />
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title={state === 'simulated' ? 'Spoken briefing transcript' : 'Live call transcript'}>
            {state === 'simulated' && (
              <p className="mb-3 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
                Playing spoken briefing generated from live incident <Mono>{activeIncident?.id}</Mono> context.
              </p>
            )}
            {!transcript.length ? (
              <p className="text-sm text-muted-foreground">
                Start the call above to stream the real-time conversation with Cascade AI. You can ask questions about the cascade or say <strong>&ldquo;Approve and dispatch&rdquo;</strong> to execute the pending actions.
              </p>
            ) : (
              <ul className="space-y-3">
                {transcript.map((l, i) => (
                  <li key={i} className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-sm">
                    <span className="label-text mr-2 uppercase">{l.role}:</span>
                    <span>{l.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Call items & dispatch controls"
            action={
              <div className="flex items-center gap-2">
                {done.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => void handleClearApproved()}
                  >
                    Clear executed ({done.length})
                  </Button>
                )}
                {needs.length > 0 && (
                  <Button
                    size="sm"
                    disabled={busyActionId !== null}
                    onClick={() => void handleApproveAll()}
                  >
                    <Check className="size-3.5" />
                    {busyActionId === 'all' ? 'Dispatching…' : `Approve & send all (${needs.length})`}
                  </Button>
                )}
              </div>
            }
          >
            <ul className="space-y-2.5">
              {suggestions.map((s, i) => (
                <li key={`s${i}`} className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
                  Suggestion · {s}
                </li>
              ))}
              {done.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-chart-4/30 bg-chart-4/10 px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-chart-4" />
                    <div>
                      <div className="flex items-center gap-1.5 font-medium">
                        <Mono className="text-xs">{a.id}</Mono>
                        <span>
                          Executed · {a.tool.replace(/_/g, ' ')} → {a.recipient_display}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{a.result ?? 'Delivered to vicalexsim@gmail.com'}</p>
                    </div>
                  </div>
                  <StatusBadge status="executed" />
                </li>
              ))}
              {needs.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-primary/50 bg-card p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <Mono className="rounded bg-secondary px-1.5 py-0.5 text-xs">{a.id}</Mono>
                        <span>
                          Requires confirmation · {a.tool.replace(/_/g, ' ')} → {a.recipient_display}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{a.content}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={busyActionId !== null}
                        onClick={() => void handleApproveOne(a.id)}
                      >
                        <Check className="size-3.5" />
                        {busyActionId === a.id ? 'Sending…' : 'Approve & send'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        disabled={busyActionId !== null}
                        onClick={() => void handleRejectOne(a.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
              {!suggestions.length && !done.length && !needs.length && (
                <p className="text-sm text-muted-foreground">No actions queued for this incident yet.</p>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
