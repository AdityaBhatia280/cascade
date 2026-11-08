import { Fragment, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, CheckCircle2, ChevronRight, Download, Mail, Trash2 } from 'lucide-react';
import { api, API_BASE, isUsingFixtures } from '@/lib/api';
import { useCascade } from '@/lib/store';
import { pageHead } from '@/lib/seo';
import { dateTime, usd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Action } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingBlock, Mono, PageHeader, StatusBadge, Tag } from '@/components/cascade/primitives';

export const Route = createFileRoute('/actions')({
  head: pageHead('Actions & audit log', 'Every action the Cascade agent proposed, with human approval decisions and results.'),
  component: Actions,
});

const STATUSES: (Action['status'] | 'all')[] = ['all', 'pending', 'approved', 'executed', 'rejected', 'failed'];

function downloadIcs(action: Action) {
  if (!isUsingFixtures()) {
    window.open(`${API_BASE}/actions/${encodeURIComponent(action.id)}/ics`, '_blank');
    return;
  }
  const now = new Date();
  const start = new Date(now.getTime() + 15 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cascade Tower Operations//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${action.id}@cascade-tower.local`,
    `DTSTAMP:${fmt(now)}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Cascade Maintenance — ${action.recipient_display}`,
    `DESCRIPTION:${action.content.replace(/\r?\n/g, '\\n')}`,
    'LOCATION:Cascade Tower — Basement 2 Mech Room, Chicago, IL',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cascade-${action.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function Actions() {
  const qc = useQueryClient();
  const { approve, reject } = useCascade();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['actions', 'all'], queryFn: () => api.actions() });

  // Deduplicate identical pending actions from earlier runs while preserving distinct items
  const deduped = (() => {
    const seen = new Set<string>();
    return (q.data ?? []).filter((a) => {
      const key = `${a.tool}|${a.recipient_display}|${a.content}|${a.status}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const rows = deduped.filter((a) => status === 'all' || a.status === status);

  const handleClear = async (onlyPending: boolean) => {
    await api.clearActions(onlyPending);
    await qc.invalidateQueries({ queryKey: ['actions'] });
    window.location.reload();
  };

  return (
    <div>
      <PageHeader
        title="Actions & audit log"
        description="Every proposed action and every human decision. Approved emails and RFC 5545 .ics calendar invites are delivered via Resend to the configured demo inbox."
        actions={
          deduped.length > 0 ? (
            <div className="flex gap-2">
              {deduped.some((a) => a.status === 'pending') && (
                <Button variant="secondary" size="sm" onClick={() => void handleClear(true)}>
                  Clear pending
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => void handleClear(false)}>
                <Trash2 className="size-3.5" /> Reset log
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
            className={cn('h-9 rounded-md border px-3 text-[13px] font-medium capitalize', status === s ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-secondary')}>{s}</button>
        ))}
      </div>
      {q.isLoading ? <LoadingBlock rows={5} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !rows.length ? (
        <EmptyState title="No actions recorded" body="Actions appear here once the agent proposes them or when you create a work order." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8" />
              <TableHead>ID</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Summary / Target</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Dollar impact</TableHead>
              <TableHead>Delivery / Result</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <TableRow className="h-12 cursor-pointer" tabIndex={0} aria-expanded={open === a.id}
                    onClick={() => setOpen(open === a.id ? null : a.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(open === a.id ? null : a.id)}>
                    <TableCell><ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open === a.id && 'rotate-90')} /></TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-xs font-medium">
                        {a.id}
                      </span>
                    </TableCell>
                    <TableCell><Mono>{a.tool}</Mono></TableCell>
                    <TableCell className="max-w-[280px]">
                      <p className="truncate text-sm font-medium" title={a.content}>{a.content}</p>
                      <p className="text-xs text-muted-foreground">Source: <Mono className="text-[11px]">{a.run_id}</Mono>{a.decided_at ? ` · ${dateTime(a.decided_at)}` : ''}</p>
                    </TableCell>
                    <TableCell><p className="text-sm">{a.recipient_display}</p><p className="text-xs text-muted-foreground">Routed to demo inbox</p></TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-right tnum">{a.usd_impact ? usd(a.usd_impact) : <span className="text-muted-foreground">$0</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{a.result ?? 'Awaiting operator approval'}</TableCell>
                  </TableRow>
                  {open === a.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-secondary/40 p-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-md border border-border bg-card p-4">
                            <div className="flex items-center justify-between gap-2">
                              <span className="label-text">Payload & Message Content</span>
                              <Tag>{a.tool}</Tag>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{a.content}</p>
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                              {a.tool === 'schedule_maintenance' && (
                                <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs">
                                  <Calendar className="size-4 text-primary" />
                                  <span>RFC 5545 <Mono>.ics</Mono> invite</span>
                                  <Button size="sm" variant="secondary" className="ml-1 h-7 text-xs" onClick={(e) => { e.stopPropagation(); downloadIcs(a); }}>
                                    <Download className="size-3.5" /> Download .ics
                                  </Button>
                                </div>
                              )}
                              {a.status === 'pending' && (
                                <div className="ml-auto flex gap-2">
                                  <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); void reject(a.id).then(() => qc.invalidateQueries({ queryKey: ['actions'] })); }}>
                                    Reject
                                  </Button>
                                  <Button size="sm" onClick={(e) => { e.stopPropagation(); void approve(a.id).then(() => qc.invalidateQueries({ queryKey: ['actions'] })); }}>
                                    Approve & execute
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-md border border-border bg-card p-4">
                            <div className="flex items-center justify-between gap-2">
                              <span className="label-text">Audit & Execution Receipt</span>
                              <Mono className="text-xs text-muted-foreground">{a.id}</Mono>
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
                              <div><dt className="text-muted-foreground">Run ID</dt><dd className="mt-0.5 font-mono">{a.run_id}</dd></div>
                              <div><dt className="text-muted-foreground">Risk classification</dt><dd className="mt-0.5 capitalize">{a.risk}</dd></div>
                              <div><dt className="text-muted-foreground">Decided by</dt><dd className="mt-0.5">{a.decided_by ?? 'Pending human gate'}</dd></div>
                              <div><dt className="text-muted-foreground">Timestamp</dt><dd className="mt-0.5 tnum">{dateTime(a.decided_at)}</dd></div>
                              <div className="col-span-2">
                                <dt className="text-muted-foreground">Delivery verification</dt>
                                <dd className="mt-1 flex items-center gap-1.5 font-medium text-foreground">
                                  {a.status === 'executed' ? <CheckCircle2 className="size-3.5 text-chart-4" /> : <Mail className="size-3.5 text-muted-foreground" />}
                                  <span>{a.result ?? 'Held in Human Approval Gate queue — no external side-effects executed yet'}</span>
                                </dd>
                              </div>
                            </dl>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
