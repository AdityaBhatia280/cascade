import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Mic, PhoneOff } from 'lucide-react';
import { api, isUsingFixtures } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { EmptyState, Panel, StatusBadge } from '@/components/cascade/primitives';

export const Route = createFileRoute('/voice')({
  head: pageHead('Voice agent', 'Start a voice briefing call about the active Cascade incident.'),
  component: Voice,
});

type CallState = 'idle' | 'connecting' | 'live' | 'ended' | 'simulated';
type Line = { role: string; content: string };

function Voice() {
  const { incident, simulation, steps } = useCascade();
  const actionsQ = useQuery({ queryKey: ['actions', 'all'], queryFn: () => api.actions() });
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const label = (id: string) => graph.data?.nodes.find((n) => n.id === id)?.label ?? id;
  const [state, setState] = useState<CallState>('idle');
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<{ stopCall: () => void } | null>(null);

  useEffect(() => () => clientRef.current?.stopCall(), []);

  const runActions = (actionsQ.data ?? []).filter((a) => !incident || a.run_id === incident.agent_run_id);
  const done = runActions.filter((a) => a.status === 'executed' || a.status === 'approved');
  const needs = runActions.filter((a) => a.status === 'pending');
  const suggestions = steps.filter((s) => s.stage === 'plan').map((s) => s.summary);

  const scripted = (): Line[] => {
    if (!incident) return [{ role: 'agent', content: 'There is no active incident to brief on.' }];
    const lines: Line[] = [{ role: 'agent', content: `Briefing on: ${incident.title}. Root cause traced to ${label(incident.root_node)}.` }];
    simulation?.impacts.forEach((i) => lines.push({ role: 'agent', content: `${i.tenant_label} is predicted to be impacted in ${i.minutes_to_impact} minutes.` }));
    done.forEach((a) => lines.push({ role: 'agent', content: `Recorded: ${a.tool.replace(/_/g, ' ')} to ${a.recipient_display}.` }));
    needs.forEach((a) => lines.push({ role: 'agent', content: `Awaiting your confirmation: ${a.tool.replace(/_/g, ' ')} to ${a.recipient_display}.` }));
    return lines;
  };

  const start = async () => {
    setError(null);
    setTranscript([]);
    setState('connecting');
    try {
      const { access_token } = await api.voiceWebCall();
      const { RetellWebClient } = await import('retell-client-js-sdk');
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on('call_started', () => setState('live'));
      client.on('call_ended', () => setState('ended'));
      client.on('update', (u: { transcript?: Line[] }) => u.transcript && setTranscript(u.transcript));
      client.on('error', () => { setState('simulated'); setTranscript(scripted()); });
      await client.startCall({ accessToken: access_token });
    } catch (e) {
      setError(isUsingFixtures() ? 'Voice backend is not connected in preview.' : (e as Error).message);
      setState('simulated');
      setTranscript(scripted());
    }
  };

  const stop = () => { clientRef.current?.stopCall(); setState('ended'); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Voice agent</h1>
          <p className="mt-2 text-sm text-muted-foreground">A spoken briefing on the active incident, powered by Retell.</p>
        </div>
        <StatusBadge status={isUsingFixtures() ? 'pending' : 'healthy'} label={isUsingFixtures() ? 'Agent offline in preview' : 'Agent available'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Panel title="Incident context">
            {!incident ? <EmptyState title="No active incident" body="Run the incident scenario first so the agent has context." /> : (
              <dl className="space-y-3 text-sm">
                <div><dt className="label-text">Incident</dt><dd className="font-medium">{incident.title}</dd></div>
                <div><dt className="label-text">Root cause</dt><dd>{label(incident.root_node)}</dd></div>
                <div><dt className="label-text">Impact</dt><dd>{simulation?.impacts.length ? simulation.impacts.map((i) => `${i.tenant_label} (T+${i.minutes_to_impact} min)`).join(', ') : 'Pending simulation'}</dd></div>
                <div><dt className="label-text">Actions taken</dt><dd className="tnum">{done.length} executed · {needs.length} awaiting approval</dd></div>
              </dl>
            )}
          </Panel>
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            {state === 'live' || state === 'connecting' ? (
              <Button variant="danger" size="lg" className="h-14 w-full text-base" onClick={stop}><PhoneOff /> End call</Button>
            ) : (
              <Button size="lg" className="h-14 w-full text-base" onClick={start}><Mic /> Start briefing call</Button>
            )}
            <div className="mt-3 flex justify-center">
              {state === 'connecting' && <StatusBadge status="connecting" />}
              {state === 'live' && <StatusBadge status="live" />}
              {state === 'ended' && <StatusBadge status="pending" label="Ended" />}
              {state === 'simulated' && <StatusBadge status="degraded" label="Simulated call" />}
            </div>
            {error && <p className="mt-2 text-xs text-muted-foreground">{error}</p>}
          </div>
        </div>

        <div className="space-y-6">
          <Panel title={state === 'simulated' ? 'Simulated call — scripted transcript' : 'Live transcript'}>
            {state === 'simulated' && <p className="mb-3 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">This is not a live call. The transcript is scripted from the incident context.</p>}
            {!transcript.length ? <p className="text-sm text-muted-foreground">The transcript appears here once the call starts.</p> : (
              <ul className="space-y-3">
                {transcript.map((l, i) => (
                  <li key={i} className="text-sm"><span className="label-text mr-2 capitalize">{l.role}</span>{l.content}</li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Call items">
            <ul className="space-y-2">
              {suggestions.map((s, i) => <li key={`s${i}`} className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">Suggestion · {s}</li>)}
              {done.map((a) => <li key={a.id} className="flex items-center gap-2 rounded-md border border-success/20 bg-success-soft px-3 py-2 text-sm"><Check className="size-4 text-success" /> Recorded · {a.tool.replace(/_/g, ' ')} → {a.recipient_display}</li>)}
              {needs.map((a) => <li key={a.id} className="rounded-md border border-primary px-3 py-2 text-sm">Requires confirmation · {a.tool.replace(/_/g, ' ')} → {a.recipient_display}</li>)}
              {!suggestions.length && !done.length && !needs.length && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
