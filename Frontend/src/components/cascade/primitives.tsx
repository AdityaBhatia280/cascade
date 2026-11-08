import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral' | 'primary';
const toneClass: Record<Tone, string> = {
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  critical: 'bg-critical-soft text-critical border-critical/20',
  info: 'bg-info-soft text-info border-info/20',
  neutral: 'bg-secondary text-muted-foreground border-border',
  primary: 'bg-primary-soft text-primary border-primary/25',
};
const dotClass: Record<Tone, string> = {
  success: 'bg-success', warning: 'bg-warning', critical: 'bg-critical', info: 'bg-info', neutral: 'bg-muted-foreground', primary: 'bg-primary',
};

const STATUS_TONE: Record<string, Tone> = {
  healthy: 'success', nominal: 'success', done: 'success', approved: 'success', executed: 'success', pass: 'success',
  verified: 'success', found: 'success', resolved: 'success', live: 'success', 'correctly rejected': 'success',
  degraded: 'warning', replanned: 'warning', mitigating: 'warning', unverified: 'warning', medium: 'warning', pending: 'neutral',
  failed: 'critical', critical: 'critical', error: 'critical', rejected: 'critical', fail: 'critical', missed: 'critical',
  high: 'critical', 'false positive': 'critical', open: 'critical',
  running: 'info', connecting: 'info', 'awaiting approval': 'primary', 'awaiting_approval': 'primary', low: 'neutral',
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const key = status.toLowerCase();
  const tone = STATUS_TONE[key] ?? 'neutral';
  const text = label ?? (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, ' ');
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs font-medium whitespace-nowrap', toneClass[tone], className)}>
      <span className={cn('size-1.5 rounded-full', dotClass[tone])} aria-hidden />
      {text}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-sm border border-border bg-secondary px-1.5 text-[11px] font-medium text-muted-foreground', className)}>
      {children}
    </span>
  );
}

export function Panel({ title, action, children, className, bodyClassName }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Illustrative() {
  return (
    <Link to="/assumptions" className="inline-flex h-5 items-center rounded-sm border border-border px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30">
      Illustrative
    </Link>
  );
}

export function MetricCard({ label, value, sub, extra }: { label: string; value: ReactNode; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="label-text">{label}</span>
        {extra}
      </div>
      <div className="metric-value mt-3">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <Inbox className="size-5 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-critical/20 bg-critical-soft px-6 py-8 text-center">
      <AlertTriangle className="size-5 text-critical" aria-hidden />
      <p className="mt-3 text-sm font-medium">Couldn't load this data</p>
      {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('font-mono text-[12.5px]', className)}>{children}</code>;
}
