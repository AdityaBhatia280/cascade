import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import { config } from '../config.js';
import type { Action, ActionTool, Incident, Simulation, VoiceCallOutcome, VoiceCallTicket } from '../db/schema.js';
import { broadcastAgentEvent } from './agent.js';
import { applyCustomFaults, nextIncidentId, simulateFailure } from './simulation.js';

/**
 * Create a new pending Action (requires human approval by default).
 * Deduplicates against existing pending actions with the same tool + content so repeated clicks/runs don't pile up duplicates.
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
  const existing = store.actions.find(
    (a) =>
      a.status === 'pending' &&
      a.tool === params.tool &&
      a.recipient_display === params.recipient_display &&
      a.content === params.content,
  );
  if (existing) {
    existing.run_id = params.run_id;
    if (params.usd_impact !== undefined) existing.usd_impact = params.usd_impact;
    broadcastAgentEvent('action_pending', existing);
    return existing;
  }

  const action: Action = {
    id: store.nextId('ACT', 2001),
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
 * Clear duplicate or stale actions (keeps only the most recent unique actions or resets all pending).
 */
export function clearActions(onlyPending = false): Action[] {
  if (onlyPending) {
    store.actions = store.actions.filter((a) => a.status !== 'pending');
  } else {
    store.actions = [];
  }
  return getActions();
}

/**
 * Deduplicate any stacked historical actions and incidents in memory right now.
 */
export function deduplicateStoreHistory(): void {
  const seenActions = new Set<string>();
  const dedupedActions: Action[] = [];
  for (let i = store.actions.length - 1; i >= 0; i--) {
    const a = store.actions[i]!;
    const key = `${a.tool}|${a.recipient_display}|${a.content}|${a.status}`;
    if (!seenActions.has(key)) {
      seenActions.add(key);
      dedupedActions.unshift(a);
    }
  }
  store.actions = dedupedActions;

  const seenIncidents = new Set<string>();
  const dedupedIncidents = [];
  for (let i = store.incidents.length - 1; i >= 0; i--) {
    const inc = store.incidents[i]!;
    const key = `${inc.root_node}|${inc.title}`;
    if (!seenIncidents.has(key)) {
      seenIncidents.add(key);
      dedupedIncidents.unshift(inc);
    }
  }
  store.incidents = dedupedIncidents;
}

/**
 * Generate a standard RFC 5545 .ics calendar invite for emergency maintenance.
 */
export function buildIcsAttachment(summary: string, description: string): string {
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
 * Send an action's email through Resend (when configured) and return the delivery note to record as its result.
 */
async function deliverActionEmail(action: Action): Promise<string> {
  // Execute external side-effect via Resend to DEMO_INBOX (JMJMJMJohnMan@gmail.com) for email, calendar invite, and work orders
  const { apiKey, fromAddress, demoInbox } = config.resend;
  if (
    (action.tool === 'send_email' ||
      action.tool === 'schedule_maintenance' ||
      action.tool === 'create_work_order') &&
    apiKey &&
    demoInbox
  ) {
    try {
      const isCalendar = action.tool === 'schedule_maintenance';
      const isWorkOrder = action.tool === 'create_work_order';
      const subject = isCalendar
        ? `[Cascade Maintenance Invite · ${action.id}] Emergency Service (${action.recipient_display})`
        : isWorkOrder
          ? `[Cascade Work Order · ${action.id}] Dispatch for ${action.recipient_display}`
          : `[Cascade Incident Alert · ${action.id}] ${action.recipient_display}`;

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; border: 1px solid #e4e4e7; border-radius: 8px; padding: 20px; color: #18181b;">
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #ea580c; margin-bottom: 6px;">
            Cascade Tower Autonomous Operations · ${action.id}
          </div>
          <h2 style="margin: 0 0 12px 0; font-size: 18px;">${subject}</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px;">
            <tr><td style="padding: 4px 0; color: #71717a; width: 150px;">Action ID:</td><td style="padding: 4px 0; font-family: monospace; font-weight: 600;">${action.id}</td></tr>
            <tr><td style="padding: 4px 0; color: #71717a;">Tool Type:</td><td style="padding: 4px 0;">${action.tool}</td></tr>
            <tr><td style="padding: 4px 0; color: #71717a;">Simulated Recipient:</td><td style="padding: 4px 0; font-family: monospace;">${action.recipient_display}</td></tr>
            <tr><td style="padding: 4px 0; color: #71717a;">Routed Demo Inbox:</td><td style="padding: 4px 0; font-family: monospace;">${demoInbox}</td></tr>
            <tr><td style="padding: 4px 0; color: #71717a;">Financial Exposure:</td><td style="padding: 4px 0; font-weight: 600;">$${action.usd_impact.toLocaleString()}</td></tr>
            <tr><td style="padding: 4px 0; color: #71717a;">Approved By:</td><td style="padding: 4px 0;">${action.decided_by ? `${action.decided_by} (${action.decided_at})` : 'Awaiting approval'}</td></tr>
          </table>
          <div style="background: #f4f4f5; border-radius: 6px; padding: 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${action.content}</div>
        </div>
      `;

      const payload: Record<string, unknown> = {
        from: fromAddress,
        to: [demoInbox],
        subject,
        html: htmlBody,
        text: `Cascade Action ID: ${action.id}\nTool: ${action.tool}\nSimulated Recipient: ${action.recipient_display}\nRouted Demo Inbox: ${demoInbox}\nFinancial Impact: $${action.usd_impact.toLocaleString()}\n\n${action.content}`,
      };

      if (isCalendar) {
        const icsContent = buildIcsAttachment(
          `Emergency Service (${action.id}) — Cascade Tower`,
          action.content,
        );
        payload['attachments'] = [
          {
            filename: `cascade-maintenance-${action.id.toLowerCase()}.ics`,
            content: Buffer.from(icsContent, 'utf-8').toString('base64'),
          },
        ];
      }

      let res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let deliveredTo = demoInbox;
      let errBody = '';

      if (!res.ok) {
        errBody = await res.text().catch(() => '');
        // Resend sandbox (onboarding@resend.dev) only permits sending to the account owner's email (e.g. vicalexsim@gmail.com).
        // Extract the permitted address from the 403 message (or fallback to vicalexsim@gmail.com) and retry immediately.
        const match = errBody.match(/\(([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/);
        const fallbackEmail = match?.[1] ?? 'vicalexsim@gmail.com';
        if (fallbackEmail.toLowerCase() !== demoInbox.toLowerCase()) {
          payload['to'] = [fallbackEmail];
          const retryRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
          if (retryRes.ok) {
            res = retryRes;
            deliveredTo = `${fallbackEmail} (Resend sandbox route for ${demoInbox})`;
          }
        }
      }

      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        const msgId = body.id ? ` [id: ${body.id.slice(0, 12)}]` : '';
        return isCalendar
          ? `Delivered with .ics invite to ${deliveredTo}${msgId}`
          : isWorkOrder
            ? `Work order dispatched to ${deliveredTo}${msgId}`
            : `Delivered to ${deliveredTo}${msgId}`;
      } else {
        return `Recorded (Resend HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 60)}` : ''}); routed to ${demoInbox}`;
      }
    } catch {
      return `Delivered to ${demoInbox} (local fallback)`;
    }
  }
  if (!apiKey) console.log(`[Resend] RESEND_API_KEY not set; ${action.id} (${action.tool}) recorded without sending email`);
  return action.tool === 'create_work_order' ? 'Work order logged in facilities queue' : 'Delivered to demo inbox';

}

/**
 * Approve and execute a pending action (sends real email via Resend if configured).
 */
export async function approveAndExecuteAction(
  actionId: string,
  editedContent?: string,
  decidedBy = 'Demo operator',
): Promise<Action | null> {
  const action = store.getAction(actionId);
  if (!action) return null;

  if (editedContent && editedContent.trim().length > 0) {
    action.content = editedContent.trim();
  }

  action.decided_by = decidedBy;
  action.decided_at = new Date().toISOString();
  action.result = await deliverActionEmail(action);
  action.status = 'executed';

  store.saveToDisk();
  broadcastAgentEvent('action_updated', action);
  return action;
}

/**
 * Email a still-pending action (a voice-reported work order) without approving it.
 */
async function forwardPendingAction(action: Action): Promise<void> {
  action.result = `Forwarded by email, awaiting approval: ${await deliverActionEmail(action)}`;
  store.saveToDisk();
  broadcastAgentEvent('action_updated', action);
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

  store.saveToDisk();
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

let retellLlmSynced = false;

/**
 * Automatically update the Retell LLM system prompt & begin_message via API so it uses
 * dynamic variables ({{incident_id}}, {{incident_title}}, {{root_cause}}, {{dollars_at_risk}}, {{pending_actions}}, etc.)
 * without requiring manual edits in the Retell dashboard.
 */
async function ensureRetellDynamicPrompt(incidentId?: string): Promise<void> {
  const { apiKey, llmId } = config.retell;
  if (!apiKey || !llmId) return;

  const defaultVars = buildRetellDynamicVars(incidentId);

  const beginMessage =
    'Hello, this is Cascade AI for {{building_name}}. Active status for {{incident_id}}: {{incident_title}}. Are you calling to review and approve pending mitigations, or to report a new facility incident?';

  const generalPrompt = `You are Cascade AI, an autonomous incident briefing, intake, and response voice agent for {{building_name}}.
You operate in two modes depending on what the engineer needs:
- Mode A (Active Incident Briefing & Approval): Briefing the engineer on the active cascade and executing pending actions upon verbal approval.
- Mode B (Inbound Incident Reporting & Live Triage): Taking an incoming fault report from a field engineer, tracing its downstream blast radius across the Cascade Tower dependency graph, opening an incident ticket, and dispatching mitigations.

LIVE DIGITAL TWIN CONTEXT (injected dynamically from Cascade Tower):
- Incident Ticket ID: {{incident_id}}
- Incident Title: {{incident_title}}
- Root Cause Analysis: {{root_cause}}
- Failed Components: {{failed_components}}
- Degraded Components: {{degraded_components}}
- Primary Tenant / Zone Impact: {{affected_tenant}}
- Time to SLA Breach: {{time_to_breach}}
- Total Financial Exposure at Risk: {{dollars_at_risk}}
- Pending Actions Awaiting Operator Confirmation: {{pending_actions}}
- Already Executed Actions: {{executed_actions}}
- Demo Dispatch Inbox: {{demo_inbox}}

CASCADE TOWER ARCHITECTURE & TOPOLOGY REFERENCE (use when someone calls in to report a new fault):
- Power Layer: Utility Feed A & B feed Main Switchgear A, which powers UPS Panel A (UPS-A) and UPS Panel B (UPS-B).
- Cooling Layer: UPS-B powers Chiller 1 (CH-1) and CRAH Unit 4 (CRAH-4). Chiller 1, Chiller 2 (CH-2), and Chiller 3 (CH-3) feed the Primary Chilled Water Loop (cooling_loop), which requires 2-of-3 chillers healthy.
- Data Hall & Tenant SLA Layer: Data Hall 200 (hall_200) requires 2-of-2 cooling feeds (Primary Chilled Water Loop + CRAH-4). It hosts Acme Cloud Services ($45,000/mo lease, 99.99% thermal SLA target at 32°C, $4,500 to $13,500 SLA credit penalty + $2,500 emergency vendor dispatch = $16,000 total exposure).
- Legacy Mainframe Billing Layer: COBOL batch program LEASEBIL.cbl and CAMCALC.cbl contain $13,025/yr in uncollected billing bugs (Finding F-1: $6,970/yr unapplied CPI-U escalation on Lease L-1002; Finding F-2: $6,055/yr truncated PIC V99 CAM share).

YOUR COMMUNICATION STYLE & INSTRUCTIONS:
1. Be direct, calm, authoritative, and concise. Avoid fluff.
2. IF BRIEFING ON THE ACTIVE INCIDENT (Mode A):
   - State the Incident ID ({{incident_id}}), root cause ({{root_cause}}), failed/degraded components ({{failed_components}} / {{degraded_components}}), and financial exposure ({{dollars_at_risk}}).
   - State the pending actions ({{pending_actions}}) and ask: "Would you like me to approve and dispatch these pending actions to {{demo_inbox}} now?"
3. IF THE CALLER IS REPORTING A NEW INCIDENT OR EQUIPMENT FAULT (Mode B):
   - Acknowledge the equipment fault they are reporting (e.g., UPS Panel B, Chiller 1, Chiller 2, CRAH-4, or BMS Switch SW-03).
   - Immediately tell them the predicted downstream cascade impact using the Cascade Tower topology above (which downstream chillers, loops, data halls, and tenant SLAs are put at risk, and the dollar exposure).
   - Tell them you are opening a new Incident Ticket and Work Order in Cascade, and ask: "Shall I immediately dispatch the emergency maintenance invite and tenant SLA alert to {{demo_inbox}}?"
4. WHEN THE ENGINEER SAYS YES, APPROVE, CONFIRM, OR DISPATCH:
   - Confirm aloud: "Confirmed. I am executing the actions now—dispatching the tenant SLA alert, maintenance calendar invite, and work order to {{demo_inbox}}."`;

  try {
    const res = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        begin_message: beginMessage,
        general_prompt: generalPrompt,
        default_dynamic_variables: defaultVars,
      }),
    });
    if (res.ok) {
      retellLlmSynced = true;
    }
  } catch {
    // Non-fatal if offline
  }
}

/**
 * Build live dynamic variables for a specific incident ticket (or current live building state)
 * so Retell AI speaks the exact real-time state of Cascade Tower.
 */
function buildRetellDynamicVars(incidentId?: string): Record<string, string> {
  const targetInc =
    (incidentId ? store.getIncident(incidentId) : undefined) ??
    store.getOpenIncidents()[0] ??
    store.incidents[store.incidents.length - 1];

  const sim = targetInc?.simulation_id ? store.getSimulation(targetInc.simulation_id) : undefined;
  const failedNodes = store.nodes.filter((n) => n.status === 'failed').map((n) => `${n.label} (${n.id})`);
  const degradedNodes = store.nodes.filter((n) => n.status === 'degraded').map((n) => `${n.label} (${n.id})`);

  // Same scope a verbal approval on this call executes (see pendingActionsForIncident).
  const relevantActions = store.actions.filter((a) => !targetInc || a.run_id === targetInc.agent_run_id);
  const pendingList = relevantActions.filter((a) => a.status === 'pending');
  const executedList = relevantActions.filter((a) => a.status === 'executed' || a.status === 'approved');

  const rootNodeObj = targetInc ? store.getNode(targetInc.root_node) : undefined;
  const rootLabel = rootNodeObj ? `${rootNodeObj.label} (${rootNodeObj.id})` : targetInc?.root_node ?? 'UPS Panel B (UPS-B)';

  return {
    building_name: 'Cascade Tower (Chicago, IL)',
    incident_id: targetInc?.id ?? 'INC-LIVE',
    incident_title: targetInc?.title ?? 'Active facility infrastructure cascade',
    root_cause:
      targetInc?.root_node === 'UPS-B'
        ? `Power-quality transient on ${rootLabel} tripped Chiller 1 and CRAH-4 while Chiller 2 was offline, dropping the chilled water loop below its 2-of-3 redundancy requirement`
        : `Fault detected on ${rootLabel} propagating through downstream building dependencies`,
    failed_components: failedNodes.length > 0 ? failedNodes.join(', ') : 'None (all components restored)',
    degraded_components: degradedNodes.length > 0 ? degradedNodes.join(', ') : 'None',
    affected_tenant:
      sim?.impacts && sim.impacts.length > 0
        ? sim.impacts
            .map(
              (i) =>
                `${i.tenant_label} (breach in T+${i.minutes_to_impact} min, $${(i.sla_credit_usd ?? 0).toLocaleString()} SLA credit)`,
            )
            .join('; ')
        : 'Acme Cloud Services (Data Hall 200)',
    time_to_breach:
      sim?.impacts && sim.impacts[0]
        ? `${sim.impacts[0].minutes_to_impact} minutes until 32°C thermal SLA breach`
        : '4 minutes until 32°C thermal SLA breach',
    dollars_at_risk: sim?.total_usd ? `$${sim.total_usd.toLocaleString()}` : '$16,000',
    pending_actions:
      pendingList.length > 0
        ? pendingList.map((a) => `${a.id}: ${a.tool.replace(/_/g, ' ')} to ${a.recipient_display} (${a.content.slice(0, 80)})`).join(' | ')
        : '0 pending actions (all mitigations already executed)',
    executed_actions:
      executedList.length > 0
        ? executedList.map((a) => `${a.id}: ${a.tool.replace(/_/g, ' ')} to ${a.recipient_display}`).join(' | ')
        : 'None yet',
    demo_inbox: config.resend.demoInbox || 'vicalexsim@gmail.com',
  };
}

/**
 * Normalize a phone number string into E.164 format (+1XXXXXXXXXX).
 */
function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (trimmed.startsWith('+') && digits.length >= 10) return `+${digits}`;
  throw new Error('Please enter a valid 10-digit US phone number or E.164 number (e.g. +12145550199)');
}

let cachedRetellFromNumber = '+14694296682';

/**
 * Discover an existing Retell phone number in the workspace (or provision one via API)
 * and ensure its outbound_agent_id is bound to our Cascade agent.
 */
async function getOrProvisionRetellFromNumber(): Promise<string> {
  if (config.retell.fromNumber) return normalizePhoneNumber(config.retell.fromNumber);
  if (cachedRetellFromNumber) return cachedRetellFromNumber;

  const { apiKey, agentId } = config.retell;
  const listRes = await fetch('https://api.retellai.com/list-phone-numbers', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (listRes.ok) {
    const phones = (await listRes.json()) as Array<{
      phone_number?: string;
      outbound_agent_id?: string | null;
    }>;
    if (Array.isArray(phones) && phones.length > 0 && phones[0]?.phone_number) {
      const num = phones[0].phone_number;
      if (phones[0].outbound_agent_id !== agentId) {
        await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(num)}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ outbound_agent_id: agentId, inbound_agent_id: agentId }),
        }).catch(() => {});
      }
      cachedRetellFromNumber = num;
      return num;
    }
  }

  // Attempt automatic provisioning via Retell API if workspace has no numbers yet
  const createRes = await fetch('https://api.retellai.com/create-phone-number', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      outbound_agent_id: agentId,
      inbound_agent_id: agentId,
    }),
  });

  if (createRes.ok) {
    const created = (await createRes.json()) as { phone_number?: string };
    if (created.phone_number) {
      cachedRetellFromNumber = created.phone_number;
      return created.phone_number;
    }
  }

  throw new Error(
    'No outbound phone number in Retell workspace yet. In your Retell Dashboard → Phone Numbers, click "+ → Buy New Number" once (Cascade will auto-detect it immediately), or use the Live Browser Call.',
  );
}

/**
 * Place an outbound phone call from Cascade AI to the operator's physical phone via Retell AI.
 */
export async function createRetellPhoneCall(
  toNumberRaw?: string,
  incidentId?: string,
): Promise<{ call_id: string; from_number: string; to_number: string }> {
  const { apiKey, agentId } = config.retell;
  if (!apiKey || !agentId) {
    throw new Error('Retell API key or Agent ID not configured in .env');
  }

  const targetPhone = toNumberRaw || config.retell.demoPhoneTo || '+14696855805';
  if (!targetPhone) {
    throw new Error('Please enter your phone number to receive the dispatch call.');
  }

  const to_number = normalizePhoneNumber(targetPhone);
  await ensureRetellDynamicPrompt();
  const from_number = await getOrProvisionRetellFromNumber();
  const dynamicVars = buildRetellDynamicVars(incidentId);

  const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from_number,
      to_number,
      override_agent_id: agentId,
      retell_llm_dynamic_variables: dynamicVars,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Retell create-phone-call HTTP ${res.status}: ${errText.slice(0, 140)}`);
  }

  const data = (await res.json()) as { call_id?: string };
  if (!data.call_id) {
    throw new Error('Retell response missing call_id');
  }

  return { call_id: data.call_id, from_number, to_number };
}

type Utterance = { role: string; content: string };

interface RetellCall {
  call_id?: string;
  call_status?: string;
  start_timestamp?: number;
  transcript?: string;
  transcript_object?: Array<{ role?: string; content?: string }>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
  };
}

export interface VoiceCallView {
  call_id: string;
  call_status: string;
  transcript: Utterance[];
  call_summary?: string;
  user_sentiment?: string;
  call_successful?: boolean;
  /** Set once the call has ended and Cascade has acted on its final transcript. */
  outcome: VoiceCallOutcome | null;
}

const ENDED_CALL_STATUSES = new Set(['ended', 'error', 'not_connected']);
const ENDED_WEBHOOK_EVENTS = new Set(['call_ended', 'call_analyzed']);

/** Earliest mention wins, so "UPS B is down and Chiller 1 tripped" names the root, not the knock-on. */
const UNIT_PATTERNS: Array<[string, RegExp]> = [
  ['UPS-B', /\b(ups\s*-?\s*b|panel\s*b)\b/i],
  ['UPS-A', /\b(ups\s*-?\s*a|panel\s*a)\b/i],
  ['CH-1', /\b(chiller\s*(1|one)|ch\s*-?\s*1)\b/i],
  ['CH-2', /\b(chiller\s*(2|two)|ch\s*-?\s*2)\b/i],
  ['CH-3', /\b(chiller\s*(3|three)|ch\s*-?\s*3)\b/i],
  ['CRAH-4', /\b(crah|unit\s*4|air\s*handler)\b/i],
  ['SW-03', /\b(sw\s*-?\s*0?3|bms\s+switch|network\s+switch)\b/i],
  ['cooling_loop', /\b(chilled\s*water|cooling\s*loop)\b/i],
  ['hall_200', /\b(hall\s*200|data\s*hall|acme)\b/i],
];

const FAULT_REGEX =
  /\b(down|broken|failed|failing|tripped|overheating|offline|fault|alarm|malfunction(ing)?|not working|shut down|outage|issue|problem|leak|leaking|smoke|fire|hot|freeze|frozen)\b/i;
const INTAKE_REGEX = /\b(report|reporting|new incident|open an incident|open a ticket|new ticket)\b/i;
const NOT_A_FAULT_REGEX = /\b(no problems?|no issues?|nothing(?:'s| is)? (?:wrong|down))\b/gi;
const AGENT_INTAKE_REGEX = /\b(opening a new incident|logging a work order|creating a ticket)\b/i;
const AGENT_CONFIRMATION_REGEX = /\b(reported|you(?:'re| are) reporting)\b/i;
const APPROVAL_REGEX = /\b(approve|approved|confirm|confirmed|yes,? dispatch|dispatch (it|them|now)|execute|send the email|go ahead|authorize)\b/i;
const AFFIRMATIVE_REGEX = /^(yes|yeah|yep|yup|sure|ok(ay)?|correct|affirmative|please do|do it)\b/i;
const AGENT_ASKS_APPROVAL_REGEX = /\b(approve|dispatch|execute|send)\b/i;
const NEGATION_REGEX = /\b(don't|do not|not yet|hold off|wait|never|cancel)\b/i;
const QUESTION_START_REGEX = /^(is|are|was|were|do|does|did|can|could|would|any|what|why|how|has|have)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isStatement(sentence: string): boolean {
  return !sentence.endsWith('?') && !QUESTION_START_REGEX.test(sentence);
}

const SPOKEN_DIGITS: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

/** Lowercase letters and digits only, with spoken digits and "dot" folded, so "Lease c p y dot c p y" reads as "leasecpycpy". */
function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => SPOKEN_DIGITS[w]!)
    .replace(/\bdot\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Spoken and written names for every component in the graph: its id, its label, and the label without a file extension. */
function nodeAliases(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const node of store.nodes) {
    const names = new Set([node.id, node.label, node.label.replace(/\.[a-z]+$/i, ''), node.id.replace(/\.[a-z]+$/i, '')]);
    for (const name of names) {
      const c = compact(name);
      if (c.length >= 4) out.push([node.id, c]);
    }
  }
  return out.sort((a, b) => b[1].length - a[1].length);
}

function firstUnitIn(text: string): string | null {
  let best: { id: string; at: number; len: number } | null = null;
  const consider = (id: string, at: number, len: number) => {
    if (at < 0 || !store.getNode(id)) return;
    if (!best || at < best.at || (at === best.at && len > best.len)) best = { id, at, len };
  };
  for (const [id, re] of UNIT_PATTERNS) {
    const m = re.exec(text);
    if (m) consider(id, compact(text.slice(0, m.index)).length, compact(m[0]).length);
  }
  const flat = compact(text);
  for (const [id, alias] of nodeAliases()) consider(id, flat.indexOf(alias), alias.length);
  return best ? (best as { id: string }).id : null;
}

interface CallIntent {
  callerText: string;
  reported: boolean;
  approved: boolean;
  nodeId: string | null;
}

/**
 * Read what the caller asked for. Only the caller's own statements count; the agent's greeting and
 * briefing name units from other incidents. The agent's explicit "X fault reported" confirmation is
 * used for the unit only when the caller's words name none.
 */
function readCallIntent(lines: Utterance[]): CallIntent {
  const isCaller = (l: Utterance) => l.role.toLowerCase() === 'user';
  const callerStatements = lines.filter(isCaller).flatMap((l) => sentences(l.content)).filter(isStatement);
  const callerText = lines.filter(isCaller).map((l) => l.content).join(' ');
  const agentStatements = lines
    .filter((l) => !isCaller(l))
    .flatMap((l) => sentences(l.content))
    .filter(isStatement);
  const firstCaller = lines.findIndex(isCaller);
  const agentReplies = lines
    .slice(firstCaller < 0 ? lines.length : firstCaller + 1)
    .filter((l) => !isCaller(l))
    .flatMap((l) => sentences(l.content))
    .filter(isStatement);

  const reported =
    callerText.trim().length > 0 &&
    (callerStatements.some((x) => {
      const cleaned = x.replace(NOT_A_FAULT_REGEX, '');
      return FAULT_REGEX.test(cleaned) || INTAKE_REGEX.test(cleaned);
    }) ||
      agentStatements.some((x) => AGENT_INTAKE_REGEX.test(x)));

  let approved = false;
  lines.forEach((line, i) => {
    if (!isCaller(line)) return;
    const prev = lines[i - 1];
    const agentAsked = prev !== undefined && !isCaller(prev) && prev.content.includes('?') && AGENT_ASKS_APPROVAL_REGEX.test(prev.content);
    for (const x of sentences(line.content)) {
      if (!isStatement(x) || NEGATION_REGEX.test(x)) continue;
      if (APPROVAL_REGEX.test(x) || (agentAsked && AFFIRMATIVE_REGEX.test(x))) approved = true;
    }
  });

  const nodeId =
    firstUnitIn(callerStatements.join(' ')) ??
    firstUnitIn(agentReplies.filter((x) => AGENT_CONFIRMATION_REGEX.test(x)).join(' '));

  return { callerText, reported, approved, nodeId };
}

function parseRawTranscript(data: RetellCall): Utterance[] {
  if (Array.isArray(data.transcript_object) && data.transcript_object.length > 0) {
    return data.transcript_object.map((t) => ({
      role: t.role ?? 'agent',
      content: t.content ?? '',
    }));
  }
  if (typeof data.transcript === 'string' && data.transcript.trim()) {
    return data.transcript
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx > 0 && idx < 12) {
          return {
            role: line.slice(0, idx).trim().toLowerCase(),
            content: line.slice(idx + 1).trim(),
          };
        }
        return { role: 'agent', content: line };
      });
  }
  return [];
}

/** Open the incident and work order for a reported fault, injecting it into the graph when the unit is known. */
function openVoiceTicket(callId: string, intent: CallIntent): { ticket: VoiceCallTicket; workOrder: Action } {
  const node = intent.nodeId ? store.getNode(intent.nodeId) : undefined;
  const runId = `VOICE-${callId.slice(-6)}`;
  const callerSnippet = intent.callerText.slice(0, 160).trim();

  let sim: Simulation | null = null;
  if (node) {
    applyCustomFaults([...store.injectedFaults, node.id], true);
    sim = simulateFailure(node.id);
  }

  const inc: Incident = {
    id: nextIncidentId(),
    title: node
      ? `[Voice Intake] ${node.label} fault reported`
      : '[Voice Intake] Fault reported, unit unidentified',
    root_node: node?.id ?? 'unidentified',
    status: 'open',
    opened_at: new Date().toISOString(),
    simulation_id: sim?.id ?? null,
    agent_run_id: runId,
  };
  store.addIncident(inc);
  broadcastAgentEvent('incident', inc);
  if (sim) broadcastAgentEvent('simulation', sim);

  const workOrder = createAction({
    run_id: runId,
    tool: 'create_work_order',
    recipient_display: 'facilities-ops@cascade-tower.example',
    content: node
      ? `[P1 Critical · ${inc.id}] Voice-reported fault on ${node.label} (${node.id}). Caller: "${callerSnippet}". Inspect and restore to nominal operation.`
      : `[P1 Critical · ${inc.id}] Voice-reported fault, unit unidentified. The caller did not name a unit Cascade recognizes, so no fault was injected into the dependency graph. Caller: "${callerSnippet}". Confirm the affected unit with the caller and inspect.`,
    usd_impact: sim?.total_usd ?? 0,
  });

  return { ticket: { incident_id: inc.id, action_id: workOrder.id, node_id: node?.id ?? null }, workOrder };
}

/** The incident the agent briefed on this call, taken from the dynamic variables Cascade placed the call with. */
function briefedIncident(call: RetellCall): Incident | undefined {
  const id = call.retell_llm_dynamic_variables?.['incident_id'];
  return typeof id === 'string' ? store.getIncident(id) : undefined;
}

function pendingActionsForIncident(inc: Incident | undefined): Action[] {
  if (!inc?.agent_run_id) return [];
  return store.actions.filter((a) => a.status === 'pending' && a.run_id === inc.agent_run_id);
}

/**
 * Act on an ended call's final transcript exactly once. The outcome is recorded (and persisted) before
 * the first await, so the poll, the sync loop and the webhook seeing the same call converge on one record.
 */
async function finalizeVoiceCall(callId: string, call: RetellCall, lines: Utterance[]): Promise<VoiceCallOutcome> {
  const existing = store.voiceCalls.get(callId);
  if (existing) return existing;

  const intent = readCallIntent(lines);
  const opened = intent.reported ? openVoiceTicket(callId, intent) : null;
  const toApprove = !intent.approved
    ? []
    : opened
      ? [opened.workOrder]
      : pendingActionsForIncident(briefedIncident(call));

  const outcome: VoiceCallOutcome = {
    call_id: callId,
    processed_at: new Date().toISOString(),
    ticket: opened?.ticket ?? null,
    approved_action_ids: toApprove.map((a) => a.id),
  };
  store.voiceCalls.set(callId, outcome);
  store.saveToDisk();
  broadcastAgentEvent('voice_call_outcome', outcome);

  const decidedBy = `Voice approval (${callId})`;
  for (const action of toApprove) {
    await approveAndExecuteAction(action.id, undefined, decidedBy);
  }
  if (opened && !toApprove.includes(opened.workOrder)) {
    await forwardPendingAction(opened.workOrder);
  }
  return outcome;
}

/** The most recent call any path observed; an ongoing call is not displaced by an older ended one. */
let latestSyncedCall: VoiceCallView | null = null;
const lastBroadcastByCall = new Map<string, string>();

/** Broadcast a call to the Voice page whoever started it, but only when something about it changed. */
function broadcastVoiceCall(view: VoiceCallView): void {
  const signature = `${view.call_status}|${view.transcript.length}|${view.transcript.at(-1)?.content.length ?? 0}|${Boolean(view.outcome)}|${Boolean(view.call_summary)}`;
  if (lastBroadcastByCall.get(view.call_id) === signature) return;
  lastBroadcastByCall.set(view.call_id, signature);
  broadcastAgentEvent('voice_call', view);
}

async function observeRetellCall(call: RetellCall & { call_id: string }, ended: boolean): Promise<VoiceCallView> {
  const lines = parseRawTranscript(call);
  const seenBefore = store.voiceCalls.has(call.call_id);
  const outcome = ended
    ? await finalizeVoiceCall(call.call_id, call, lines)
    : (store.voiceCalls.get(call.call_id) ?? null);
  if (ended && !seenBefore && outcome) {
    const did = outcome.ticket ? `ticket ${outcome.ticket.incident_id} / ${outcome.ticket.action_id} on ${outcome.ticket.node_id ?? 'unidentified unit'}` : 'no fault reported';
    const approved = outcome.approved_action_ids?.length ? `, approved ${outcome.approved_action_ids.join(', ')}` : '';
    console.log(`[Cascade Server] Call ${call.call_id} ended: ${did}${approved}`);
  }
  const view: VoiceCallView = {
    call_id: call.call_id,
    call_status: call.call_status ?? 'ongoing',
    transcript: lines,
    call_summary: call.call_analysis?.call_summary,
    user_sentiment: call.call_analysis?.user_sentiment,
    call_successful: call.call_analysis?.call_successful,
    outcome,
  };
  if (!latestSyncedCall || latestSyncedCall.call_id === view.call_id || view.call_status === 'ongoing' || latestSyncedCall.call_status !== 'ongoing') {
    latestSyncedCall = view;
  }
  broadcastVoiceCall(view);
  return view;
}

/**
 * Poll a Retell phone/web call for its live transcript. Tickets and approvals happen only once the call has ended.
 */
export async function getRetellCallStatus(callId: string): Promise<VoiceCallView> {
  const { apiKey } = config.retell;
  if (!apiKey) throw new Error('Retell API key not configured');

  const res = await fetch(`https://api.retellai.com/v2/get-call/${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Retell get-call HTTP ${res.status}`);
  }

  const data = (await res.json()) as RetellCall;
  const call = { ...data, call_id: data.call_id ?? callId };
  return observeRetellCall(call, ENDED_CALL_STATUSES.has(call.call_status ?? ''));
}

const bootTimestampMs = Date.now() - 15 * 60_000;

/**
 * Automatically poll Retell's /v2/list-calls endpoint so ANY call made on the Retell dashboard ("Run Test")
 * or inbound to +1(469)429-6682 automatically syncs to the Cascade backend & frontend in real time—even on localhost!
 */
let lastSyncError = '';

/** Log a sync failure once per distinct message, so a broken sync is visible without flooding the log. */
function reportSyncError(message: string): void {
  if (message === lastSyncError) return;
  lastSyncError = message;
  console.warn(`[Cascade Server] Retell call sync failed: ${message}`);
}

/**
 * Find calls this server did not start (inbound calls, Retell dashboard tests, other clients) and observe them.
 * v3/list-calls returns call summaries without transcripts, so each live or unprocessed ended call is read with get-call.
 */
export async function syncLatestRetellCalls(): Promise<VoiceCallView | null> {
  const { apiKey, agentId } = config.retell;
  if (!apiKey || !agentId) return latestSyncedCall;

  try {
    const res = await fetch('https://api.retellai.com/v3/list-calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter_criteria: { agent: [{ agent_id: agentId }] },
        sort_order: 'descending',
        limit: 5,
      }),
    });

    if (!res.ok) {
      reportSyncError(`list-calls HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return latestSyncedCall;
    }
    lastSyncError = '';

    const { items } = (await res.json()) as { items?: RetellCall[] };
    for (const c of items ?? []) {
      if (!c.call_id) continue;
      const ongoing = !ENDED_CALL_STATUSES.has(c.call_status ?? '');
      const isRecent = !c.start_timestamp || c.start_timestamp >= bootTimestampMs;
      if (!isRecent && !ongoing) continue;
      if (!ongoing && store.voiceCalls.has(c.call_id)) continue;
      await getRetellCallStatus(c.call_id);
    }
  } catch (err) {
    reportSyncError((err as Error).message);
  }

  return latestSyncedCall;
}

export function getLatestSyncedCall() {
  return latestSyncedCall;
}

let syncLoopTimer: ReturnType<typeof setInterval> | null = null;

export function startRetellCallSyncLoop(): void {
  if (syncLoopTimer) return;
  syncLoopTimer = setInterval(() => {
    void syncLatestRetellCalls();
  }, 3000);
}

/**
 * Direct Retell Webhook handler (POST /api/retell/webhook). `call_ended` and `call_analyzed` carry the final transcript.
 */
export async function handleRetellWebhook(body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const event = typeof body['event'] === 'string' ? body['event'] : '';
  const callObj = (body['call'] ?? body) as RetellCall;
  if (callObj?.call_id) {
    const ended = ENDED_WEBHOOK_EVENTS.has(event) || ENDED_CALL_STATUSES.has(callObj.call_status ?? '');
    await observeRetellCall({ ...callObj, call_id: callObj.call_id }, ended);
  }
  return { ok: true };
}

/**
 * Create a Retell AI web call with live dynamic context for a specific incident ticket (or current live building state).
 */
export async function createRetellWebCall(incidentId?: string): Promise<{ access_token: string }> {
  const { apiKey, agentId } = config.retell;
  if (!apiKey || !agentId) {
    throw new Error('Retell API key or Agent ID not configured in .env');
  }

  await ensureRetellDynamicPrompt();
  const dynamicVars = buildRetellDynamicVars(incidentId);

  const res = await fetch('https://api.retellai.com/v2/create-web-call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: agentId,
      retell_llm_dynamic_variables: dynamicVars,
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
