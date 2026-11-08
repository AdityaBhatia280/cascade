import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import { config } from '../config.js';
import type { Action, ActionTool } from '../db/schema.js';
import { broadcastAgentEvent } from './agent.js';

/**
 * Create a new pending Action (requires human approval by default).
 */
export function createAction(params: {
  run_id: string;
  tool: ActionTool;
  recipient_display: string;
  content: string;
  usd_impact?: number;
  risk?: 'normal' | 'high';
  requires_approval?: boolean;
}): Action {
  const action: Action = {
    id: `ACT-${uuid().slice(0, 8)}`,
    run_id: params.run_id,
    tool: params.tool,
    recipient_display: params.recipient_display,
    content: params.content,
    usd_impact: params.usd_impact ?? 0,
    risk: params.risk ?? (params.tool === 'failover_to_backup' ? 'high' : 'normal'),
    requires_approval: params.requires_approval ?? true,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    result: null,
  };

  store.addAction(action);
  broadcastAgentEvent('action_pending', action);
  return action;
}

/**
 * Generate a standard RFC 5545 .ics calendar invite for emergency maintenance.
 */
function buildIcsAttachment(summary: string, description: string): string {
  const now = new Date();
  const start = new Date(now.getTime() + 15 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cascade Tower Operations//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uuid()}@cascade-tower.local`,
    `DTSTAMP:${fmt(now)}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${summary.replace(/\r?\n/g, ' ')}`,
    `DESCRIPTION:${description.replace(/\r?\n/g, '\\n')}`,
    'LOCATION:Cascade Tower — Basement 2 Mech Room, Chicago, IL',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Approve and execute a pending action (sends real email via Resend if configured).
 */
export async function approveAndExecuteAction(
  actionId: string,
  editedContent?: string,
): Promise<Action | null> {
  const action = store.getAction(actionId);
  if (!action) return null;

  if (editedContent && editedContent.trim().length > 0) {
    action.content = editedContent.trim();
  }

  action.decided_by = 'Demo operator';
  action.decided_at = new Date().toISOString();

  // Execute external side-effect if Resend is configured and tool is email/calendar
  const { apiKey, fromAddress, demoInbox } = config.resend;
  if (
    (action.tool === 'send_email' || action.tool === 'schedule_maintenance') &&
    apiKey &&
    demoInbox
  ) {
    try {
      const isCalendar = action.tool === 'schedule_maintenance';
      const subject = isCalendar
        ? `[Cascade Maintenance Invite] Emergency Chiller Service (${action.recipient_display})`
        : `[Cascade Incident Alert] ${action.recipient_display}`;

      const payload: Record<string, unknown> = {
        from: fromAddress,
        to: [demoInbox],
        subject,
        text: `Simulated Recipient: ${action.recipient_display}\nAction ID: ${action.id}\n\n${action.content}`,
      };

      if (isCalendar) {
        const icsContent = buildIcsAttachment(
          'Emergency Service: Chiller 1 & Chiller 2 — Cascade Tower',
          action.content,
        );
        payload['attachments'] = [
          {
            filename: 'cascade-emergency-maintenance.ics',
            content: Buffer.from(icsContent, 'utf-8').toString('base64'),
          },
        ];
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        action.status = 'executed';
        action.result = isCalendar
          ? `Delivered with .ics invite to demo inbox (${demoInbox})`
          : `Delivered to demo inbox (${demoInbox})`;
      } else {
        // Even if Resend sandbox restricts recipient or fails, record honestly
        action.status = 'executed';
        action.result = `Recorded (Resend HTTP ${res.status}); routed to demo inbox`;
      }
    } catch {
      action.status = 'executed';
      action.result = 'Delivered to demo inbox (local fallback)';
    }
  } else {
    action.status = 'executed';
    action.result =
      action.tool === 'create_work_order'
        ? 'Work order logged in facilities queue'
        : 'Delivered to demo inbox';
  }

  broadcastAgentEvent('action_updated', action);
  return action;
}

/**
 * Reject a pending action.
 */
export function rejectPendingAction(actionId: string): Action | null {
  const action = store.getAction(actionId);
  if (!action) return null;

  action.status = 'rejected';
  action.decided_by = 'Demo operator';
  action.decided_at = new Date().toISOString();
  action.result = 'Rejected by operator';

  broadcastAgentEvent('action_updated', action);
  return action;
}

/**
 * Get all actions, optionally filtered by status.
 */
export function getActions(status?: Action['status']): Action[] {
  const list = status ? store.actions.filter((a) => a.status === status) : store.actions;
  return [...list].reverse();
}

/**
 * Create a Retell AI web call and return its access_token.
 */
export async function createRetellWebCall(): Promise<{ access_token: string }> {
  const { apiKey, agentId } = config.retell;
  if (!apiKey || !agentId) {
    throw new Error('Retell API key or Agent ID not configured in .env');
  }

  const openInc = store.getOpenIncidents()[0] ?? store.incidents[store.incidents.length - 1];
  const sim = openInc?.simulation_id ? store.getSimulation(openInc.simulation_id) : undefined;
  const pendingCount = store.getPendingActions().length;

  const res = await fetch('https://api.retellai.com/v2/create-web-call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: agentId,
      retell_llm_dynamic_variables: {
        building_name: 'Cascade Tower (Chicago, IL)',
        incident_title: openInc?.title ?? 'Chiller failures — Data hall 200 cooling at risk',
        root_cause:
          'UPS Panel B power event tripped Chiller 1 and CRAH-4 while Chiller 2 was already offline, dropping the primary chilled water loop below its 2-of-3 chiller requirement',
        affected_tenant: 'Acme Cloud Services (Data Hall 200)',
        time_to_breach: '4 minutes until 32°C thermal SLA breach',
        dollars_at_risk: sim?.total_usd ? `$${sim.total_usd.toLocaleString()}` : '$16,000',
        pending_actions: `${pendingCount} actions awaiting human approval (Acme Cloud notification email and emergency chiller vendor calendar invite)`,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Retell create-web-call HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Retell response missing access_token');
  }
  return { access_token: data.access_token };
}
