import { useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Bell, Boxes, ClipboardCheck, Code2, FileSearch, GitCompareArrows, LayoutDashboard, Menu, Mic,
  Network, Play, Settings2, Siren, Target, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useCascade } from '@/lib/store';
import { time } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApprovalDialog } from './ApprovalDialog';

type Item = { to: string; label: string; icon: typeof Bell };
const NAV: { group: string; items: Item[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  { group: 'Infrastructure', items: [
    { to: '/intelligence', label: 'System intelligence', icon: Network },
    { to: '/equipment', label: 'Equipment', icon: Boxes },
  ] },
  { group: 'Operations', items: [
    { to: '/incidents', label: 'Incidents', icon: Siren },
    { to: '/actions', label: 'Actions & audit log', icon: ClipboardCheck },
    { to: '/voice', label: 'Voice agent', icon: Mic },
  ] },
  { group: 'Legacy code', items: [
    { to: '/findings', label: 'Billing findings', icon: FileSearch },
    { to: '/modernization', label: 'Modernization', icon: Code2 },
    { to: '/parity', label: 'Parity', icon: GitCompareArrows },
    { to: '/accuracy', label: 'Extraction accuracy', icon: Target },
  ] },
  { group: 'Management', items: [{ to: '/assumptions', label: 'Assumptions', icon: Settings2 }] },
];

const ALL = NAV.flatMap((g) => g.items);
function titleFor(path: string) {
  if (path === '/') return 'Dashboard';
  const hit = ALL.filter((i) => i.to !== '/' && path.startsWith(i.to)).sort((a, b) => b.to.length - a.to.length)[0];
  return hit?.label ?? 'Cascade';
}

function NavList({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
      {NAV.map((g) => (
        <div key={g.group} className="mb-5">
          <p className={cn('mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', compact && 'sr-only')}>{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = it.to === '/' ? path === '/' : path.startsWith(it.to);
              const Icon = it.icon;
              return (
                <li key={it.to}>
                  <Link
                    to={it.to}
                    onClick={onNavigate}
                    title={compact ? it.label : undefined}
                    className={cn(
                      'relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'bg-secondary font-medium text-foreground' : 'text-foreground/80 hover:bg-secondary',
                      compact && 'justify-center px-0',
                    )}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-primary" aria-hidden />}
                    <Icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} />
                    <span className={cn(compact && 'sr-only')}>{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('flex h-16 items-center gap-2.5 border-b border-border px-5', compact && 'justify-center px-0')}>
      <div className="flex size-7 items-center justify-center rounded-sm bg-foreground text-sm font-bold text-background">C</div>
      <span className={cn('text-[15px] font-semibold tracking-tight', compact && 'sr-only')}>Cascade</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { mode, setMode, runScenario, scenarioRunning, pending, setApprovalOpen, usingFixtures, reconnecting, lastUpdated } = useCascade();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pendingCount = pending.filter((a) => a.status === 'pending').length;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex h-8 items-center justify-center border-b border-border bg-secondary px-4 text-center text-xs text-muted-foreground">
        Demo mode — simulated building data. No real tenants are contacted.
      </div>
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col border-r border-border bg-sidebar md:flex lg:w-[var(--sidebar-width)]">
          <div className="lg:hidden"><Brand compact /></div>
          <div className="hidden lg:block"><Brand /></div>
          <div className="flex flex-1 flex-col overflow-hidden lg:hidden"><NavList compact /></div>
          <div className="hidden flex-1 flex-col overflow-hidden lg:flex"><NavList /></div>
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[260px] p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
            <NavList onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-4 md:px-8">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{titleFor(path)}</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                Cascade Tower — Chicago, IL · <span className="tnum">Updated {time(lastUpdated)}</span>
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {usingFixtures && <span className="hidden h-6 items-center rounded-full border border-border bg-secondary px-2.5 text-xs text-muted-foreground sm:inline-flex">Preview data</span>}
              {reconnecting && <span className="inline-flex h-6 items-center rounded-full border border-warning/30 bg-warning-soft px-2.5 text-xs text-warning">Reconnecting…</span>}
              {mode === 'replay' && <span className="inline-flex h-6 items-center rounded-sm border border-border bg-secondary px-2 text-xs font-medium">Replay</span>}
              <div role="radiogroup" aria-label="Scenario mode" className="hidden h-10 items-center rounded-md border border-border bg-secondary p-0.5 lg:flex">
                {(['live', 'replay'] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                    className={cn('h-full rounded-[6px] px-3 text-xs font-medium capitalize transition-colors', mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    {m}
                  </button>
                ))}
              </div>
              <Button onClick={runScenario} disabled={scenarioRunning}>
                <Play /> <span className="hidden sm:inline">{scenarioRunning ? 'Scenario running…' : 'Run incident scenario'}</span>
              </Button>
              <Button variant="secondary" size="icon" className="relative" onClick={() => setApprovalOpen(true)} aria-label={`Pending approvals: ${pendingCount}`}>
                <Bell />
                {pendingCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tnum">{pendingCount}</span>
                )}
              </Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
      <ApprovalDialog />
    </div>
  );
}

export { Wrench };
