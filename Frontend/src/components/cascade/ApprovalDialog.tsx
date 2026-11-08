import { useState } from 'react';
import { CalendarClock, ClipboardList, Mail, Phone, ServerCog } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCascade } from '@/lib/store';
import type { Action, ActionTool } from '@/lib/types';
import { usd, sentence } from '@/lib/format';
import { Mono, StatusBadge, Tag } from './primitives';

export const TOOL_ICON: Record<ActionTool, typeof Mail> = {
  send_email: Mail, schedule_maintenance: CalendarClock, place_call: Phone,
  create_work_order: ClipboardList, failover_to_backup: ServerCog,
};

function ActionRow({ action }: { action: Action }) {
  const { approve, reject } = useCascade();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(action.content);
  const [busy, setBusy] = useState(false);
  const Icon = TOOL_ICON[action.tool] ?? ClipboardList;
  const highRisk = action.risk === 'high' || action.tool === 'failover_to_backup';
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary"><Icon className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="font-medium">{action.tool}</Mono>
            {highRisk ? <StatusBadge status="critical" label="High risk" /> : <Tag>Normal risk</Tag>}
          </div>
          <p className="mt-1 text-sm">To <span className="font-medium">{action.recipient_display}</span></p>
          <p className="text-xs text-muted-foreground">Delivered to demo inbox</p>
          {editing ? (
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="mt-3 min-h-24" aria-label="Edit action content" />
          ) : (
            <button type="button" onClick={() => setExpanded(!expanded)} className={`mt-3 block w-full rounded-md bg-secondary p-3 text-left text-sm ${expanded ? '' : 'line-clamp-2'}`}>
              {action.content}
            </button>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Dollar impact: <span className="tnum text-foreground">{action.usd_impact ? usd(action.usd_impact) : 'Computed by backend'}</span>
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="danger" disabled={busy} onClick={() => run(() => reject(action.id))}>Reject</Button>
        {editing ? (
          <Button variant="secondary" disabled={busy} onClick={() => { setEditing(false); setDraft(action.content); }}>Cancel edit</Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        )}
        <Button disabled={busy} onClick={() => run(() => approve(action.id, editing ? draft : undefined))}>
          {editing ? 'Save & approve' : 'Approve'}
        </Button>
      </div>
    </li>
  );
}

export function ApprovalDialog() {
  const { pending, approvalOpen, setApprovalOpen } = useCascade();
  const list = pending.filter((a) => a.requires_approval && a.status === 'pending');
  return (
    <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
      <DialogContent className="flex max-h-[85vh] max-w-[640px] flex-col gap-0 rounded-lg p-0">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle className="card-title">Approval required</DialogTitle>
          <DialogDescription>
            {list.length ? `${list.length} action${list.length > 1 ? 's' : ''} proposed by the agent. Nothing executes until you approve.` : 'No actions are waiting for approval.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {list.length ? <ul className="space-y-3">{list.map((a) => <ActionRow key={a.id} action={a} />)}</ul> : <p className="text-sm text-muted-foreground">You're all caught up.</p>}
        </div>
        <div className="border-t border-border px-6 py-3 text-xs text-muted-foreground">Every decision is written to the audit log.</div>
      </DialogContent>
    </Dialog>
  );
}

export { sentence };
