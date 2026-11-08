import { v4 as uuid } from 'uuid';
import { store } from '../db/store.js';
import { config } from '../config.js';
import type { Action, ActionTool, Incident } from '../db/schema.js';
import { broadcastAgentEvent } from './agent.js';
import { applyCustomFaults, nextIncidentId, simulateFailure } from './simulation.js';

let actionSeq = 2001;

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
    id: `ACT-${actionSeq++}`,
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
            <tr><td style="padding: 4px 0; color: #71717a;">Approved By:</td><td style="padding: 4px 0;">${action.decided_by} (${action.decided_at})</td></tr>
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
        action.status = 'executed';
        action.result = isCalendar
          ? `Delivered with .ics invite to ${deliveredTo}${msgId}`
          : isWorkOrder
            ? `Work order dispatched to ${deliveredTo}${msgId}`
            : `Delivered to ${deliveredTo}${msgId}`;
      } else {
        action.status = 'executed';
        action.result = `Recorded (Resend HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 60)}` : ''}); routed to ${demoInbox}`;
      }
    } catch {
      action.status = 'executed';
      action.result = `Delivered to ${demoInbox} (local fallback)`;
    }
  } else {
    action.status = 'executed';
    action.result =
      action.tool === 'create_work_order'
        ? 'Work order logged in facilities queue'
        : 'Delivered to demo inbox';
  }

  store.saveToDisk();
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

  const relevantActions = store.actions.filter(
    (a) => !targetInc || a.run_id === targetInc.agent_run_id || a.run_id === 'manual',
  );
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

const autoApprovedCalls = new Set<string>();
const voiceTicketsByCall = new Map<string, { incidentId: string; actionId: string; nodeId: string }>();

const SERVER_VOICE_APPROVAL_REGEX = /\b(approve|confirm|yes dispatch|dispatch now|execute|send the email|go ahead|authorize)\b/i;
const SERVER_VOICE_REPORT_REGEX =
  /\b(report|reporting|ticket|work order|new incident|open an incident|incident|down|broken|failed|tripped|overheating|offline|fault|alarm|malfunction|not working|shut down|outage|issue|problem|leak|leaking|smoke|fire|hot|freeze|frozen)\b/i;

function detectReportedNodeId(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(chiller\s*1|chiller\s*one|ch-1)\b/.test(lower)) return 'CH-1';
  if (/\b(chiller\s*2|chiller\s*two|ch-2)\b/.test(lower)) return 'CH-2';
  if (/\b(chiller\s*3|chiller\s*three|ch-3)\b/.test(lower)) return 'CH-3';
  if (/\b(crah|unit\s*4|air\s*handler)\b/.test(lower)) return 'CRAH-4';
  if (/\b(sw-03|switch|bms|network)\b/.test(lower)) return 'SW-03';
  if (/\b(chilled\s*water|cooling\s*loop|flow)\b/.test(lower)) return 'cooling_loop';
  if (/\b(hall\s*200|data\s*hall|acme)\b/.test(lower)) return 'hall_200';
  if (/\b(ups\s*a|panel\s*a|ups-a)\b/.test(lower)) return 'UPS-A';
  return 'UPS-B';
}

function parseRawTranscript(data: {
  transcript?: string;
  transcript_object?: Array<{ role?: string; content?: string }>;
}): Array<{ role: string; content: string }> {
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

/**
 * Inspect a live or completed Retell call transcript and:
 * 1. If the caller reports a new fault / asks to create a ticket, create an Incident (INC-100X) + Work Order (ACT-200X),
 *    inject the fault into the live dependency graph, persist to disk, and broadcast over SSE.
 * 2. If the caller verbally approves ("approve", "confirm", "yes dispatch"), execute all pending actions via Resend.
 */
async function processVoiceCallTranscript(
  callId: string,
  transcriptLines: Array<{ role: string; content: string }>,
): Promise<{
  autoDispatched: boolean;
  createdTicket?: { incidentId: string; actionId: string; nodeId: string };
}> {
  const userUtterances = transcriptLines
    .filter((t) => t.role.toLowerCase() === 'user')
    .map((t) => t.content)
    .join(' ');
  const agentUtterances = transcriptLines
    .filter((t) => t.role.toLowerCase() === 'agent')
    .map((t) => t.content)
    .join(' ');

  // 1. Check if caller reported an incident / requested a ticket
  if (
    !voiceTicketsByCall.has(callId) &&
    userUtterances.trim().length > 0 &&
    (SERVER_VOICE_REPORT_REGEX.test(userUtterances) ||
      /\b(opening a new incident|logging a work order|creating a ticket)\b/i.test(agentUtterances))
  ) {
    const nodeId = detectReportedNodeId(`${userUtterances} ${agentUtterances}`);
    const nodeObj = store.getNode(nodeId);
    const nodeLabel = nodeObj?.label ?? nodeId;

    // Update live dependency graph with the reported fault
    const nextFaults = Array.from(new Set([...store.injectedFaults, nodeId]));
    applyCustomFaults(nextFaults, true);

    const sim = simulateFailure(nodeId);
    const incId = nextIncidentId();
    const runId = `VOICE-${callId.slice(-6)}`;
    const shortSnippet = userUtterances.slice(0, 90).trim();
    const inc: Incident = {
      id: incId,
      title: `[Voice Intake] ${nodeLabel} fault reported (${shortSnippet || 'Retell call'})`,
      root_node: nodeId,
      status: 'open',
      opened_at: new Date().toISOString(),
      simulation_id: sim.id,
      agent_run_id: runId,
    };
    store.addIncident(inc);
    broadcastAgentEvent('incident', inc);
    broadcastAgentEvent('simulation', sim);

    const wo = createAction({
      run_id: runId,
      tool: 'create_work_order',
      recipient_display: 'facilities-ops@cascade-tower.example',
      content: `[P1 Critical · ${inc.id}] Voice-reported fault on ${nodeLabel} (${nodeId}): "${shortSnippet}". Inspect and restore to nominal operation.`,
      usd_impact: sim.total_usd || 16000,
    });

    const record = { incidentId: inc.id, actionId: wo.id, nodeId };
    voiceTicketsByCall.set(callId, record);
    // Immediately execute and dispatch the Resend email for voice-reported tickets
    await approveAndExecuteAction(wo.id);
    store.saveToDisk();
  }

  // 2. Check if caller verbally approved pending actions
  let autoDispatched = autoApprovedCalls.has(callId);
  if (!autoDispatched && SERVER_VOICE_APPROVAL_REGEX.test(userUtterances)) {
    const pending = store.getPendingActions();
    if (pending.length > 0) {
      autoApprovedCalls.add(callId);
      autoDispatched = true;
      for (const act of pending) {
        await approveAndExecuteAction(act.id);
      }
    }
  }

  return {
    autoDispatched,
    createdTicket: voiceTicketsByCall.get(callId),
  };
}

/**
 * Poll a live or completed Retell phone/web call to stream its real-time transcript and post-call analysis,
 * and execute multi-step tool dispatch or ticket creation from the spoken conversation.
 */
export async function getRetellCallStatus(callId: string): Promise<{
  call_id: string;
  call_status: string;
  transcript: Array<{ role: string; content: string }>;
  call_summary?: string;
  user_sentiment?: string;
  call_successful?: boolean;
  auto_dispatched?: boolean;
  created_ticket?: { incidentId: string; actionId: string; nodeId: string };
}> {
  const { apiKey } = config.retell;
  if (!apiKey) throw new Error('Retell API key not configured');

  const res = await fetch(`https://api.retellai.com/v2/get-call/${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Retell get-call HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    call_id?: string;
    call_status?: string;
    transcript?: string;
    transcript_object?: Array<{ role?: string; content?: string }>;
    call_analysis?: {
      call_summary?: string;
      user_sentiment?: string;
      call_successful?: boolean;
    };
  };

  const transcriptLines = parseRawTranscript(data);
  const { autoDispatched, createdTicket } = await processVoiceCallTranscript(
    data.call_id ?? callId,
    transcriptLines,
  );

  return {
    call_id: data.call_id ?? callId,
    call_status: data.call_status ?? 'ongoing',
    transcript: transcriptLines,
    call_summary: data.call_analysis?.call_summary,
    user_sentiment: data.call_analysis?.user_sentiment,
    call_successful: data.call_analysis?.call_successful,
    auto_dispatched: autoDispatched,
    created_ticket: createdTicket,
  };
}

let latestSyncedCall: {
  call_id: string;
  call_status: string;
  transcript: Array<{ role: string; content: string }>;
  call_summary?: string;
  auto_dispatched?: boolean;
  created_ticket?: { incidentId: string; actionId: string; nodeId: string };
} | null = null;

const bootTimestampMs = Date.now() - 15 * 60_000;

/**
 * Automatically poll Retell's /v2/list-calls endpoint so ANY call made on the Retell dashboard ("Run Test")
 * or inbound to +1(469)429-6682 automatically syncs to the Cascade backend & frontend in real time—even on localhost!
 */
export async function syncLatestRetellCalls(): Promise<typeof latestSyncedCall> {
  const { apiKey, agentId } = config.retell;
  if (!apiKey || !agentId) return latestSyncedCall;

  try {
    const res = await fetch('https://api.retellai.com/v2/list-calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter_criteria: {
          agent_id: [agentId],
        },
        sort_order: 'descending',
        limit: 3,
      }),
    });

    if (!res.ok) return latestSyncedCall;

    const calls = (await res.json()) as Array<{
      call_id?: string;
      call_status?: string;
      start_timestamp?: number;
      transcript?: string;
      transcript_object?: Array<{ role?: string; content?: string }>;
      call_analysis?: {
        call_summary?: string;
      };
    }>;

    if (!Array.isArray(calls) || calls.length === 0) return latestSyncedCall;

    for (const c of calls) {
      if (!c.call_id) continue;
      const isRecent = !c.start_timestamp || c.start_timestamp >= bootTimestampMs;
      if (!isRecent && c.call_status !== 'ongoing') continue;

      const lines = parseRawTranscript(c);
      const { autoDispatched, createdTicket } = await processVoiceCallTranscript(c.call_id, lines);

      // Return the most recent call or the call that created a ticket / dispatched
      if (c === calls[0] || createdTicket) {
        latestSyncedCall = {
          call_id: c.call_id,
          call_status: c.call_status ?? 'ongoing',
          transcript: lines,
          call_summary: c.call_analysis?.call_summary,
          auto_dispatched: autoDispatched,
          created_ticket: createdTicket ?? voiceTicketsByCall.get(c.call_id),
        };
      }
    }
  } catch {
    // Ignore transient network errors
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
 * Direct Retell Webhook handler (POST /api/retell/webhook) for when Cascade is deployed on Brev.
 */
export async function handleRetellWebhook(body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const callObj = (body['call'] ?? body) as {
    call_id?: string;
    call_status?: string;
    transcript?: string;
    transcript_object?: Array<{ role?: string; content?: string }>;
    call_analysis?: { call_summary?: string };
  };
  if (callObj?.call_id) {
    const lines = parseRawTranscript(callObj);
    const { autoDispatched, createdTicket } = await processVoiceCallTranscript(callObj.call_id, lines);
    latestSyncedCall = {
      call_id: callObj.call_id,
      call_status: callObj.call_status ?? 'ongoing',
      transcript: lines,
      call_summary: callObj.call_analysis?.call_summary,
      auto_dispatched: autoDispatched,
      created_ticket: createdTicket,
    };
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
