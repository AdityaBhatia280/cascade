import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import { usd, sentence } from '@/lib/format';
import type { Finding } from '@/lib/types';
import { SourceSnippetView } from '@/components/cascade/CodeBlock';
import { EmptyState, ErrorState, Illustrative, LoadingBlock, Mono, PageHeader, StatusBadge, Tag } from '@/components/cascade/primitives';

export const Route = createFileRoute('/findings')({
  head: pageHead('Billing findings', 'Billing discrepancies and hidden dependencies found in legacy COBOL and lease contracts.'),
  component: Findings,
});

function Findings() {
  const q = useQuery({ queryKey: ['findings'], queryFn: api.findings });
  return (
    <div>
      <PageHeader title="Billing findings" description="What Cascade found by reading the COBOL billing code against the lease contracts." />
      {q.isLoading ? <LoadingBlock rows={4} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !q.data?.length ? <EmptyState title="No findings" /> : (
        <div className="space-y-4">{[...q.data].sort((a, b) => b.usd_per_year - a.usd_per_year).map((f) => <FindingCard key={f.id} f={f} />)}</div>
      )}
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const diff = f.monthly_billed_usd != null && f.monthly_correct_usd != null ? f.monthly_billed_usd - f.monthly_correct_usd : null;
  return (
    <article className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={f.severity} /><Tag>{sentence(f.kind)}</Tag></div>
          <h2 className="card-title mt-2">{f.title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{f.description}</p>
        </div>
        {f.usd_per_year > 0 && (
          <div className="text-right">
            <p className="label-text">Annual impact</p>
            <p className="metric-value text-[28px]">{usd(f.usd_per_year)}</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {f.node_ids.map((n) => <Link key={n} to="/intelligence" search={{ node: n }}><Tag className="hover:border-primary hover:text-primary"><Mono className="text-[11px]">{n}</Mono></Tag></Link>)}
      </div>

      {f.kind === 'billing_discrepancy' && f.code_file && f.contract_file && (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <p className="label-text mb-1">Code</p>
              <Mono className="mb-2 block text-xs text-muted-foreground">{f.code_file}:{f.code_line}</Mono>
              <SourceSnippetView file={f.code_file} line={f.code_line ?? 0} />
            </div>
            <div>
              <p className="label-text mb-1">Contract</p>
              <Mono className="mb-2 block text-xs text-muted-foreground">{f.contract_file}:{f.contract_line}</Mono>
              <SourceSnippetView file={f.contract_file} line={f.contract_line ?? 0} />
            </div>
          </div>
          {diff != null && (
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-md bg-secondary p-4 text-sm sm:grid-cols-4">
              <div><p className="label-text">Billed monthly</p><p className="font-semibold tnum">{usd(f.monthly_billed_usd!, 2)}</p></div>
              <div><p className="label-text">Correct monthly</p><p className="font-semibold tnum">{usd(f.monthly_correct_usd!, 2)}</p></div>
              <div><p className="label-text">Monthly difference</p><p className="font-semibold tnum text-critical">{usd(diff, 2)}</p></div>
              <div><p className="label-text flex items-center gap-1.5">Annual difference <Illustrative /></p><p className="font-semibold tnum text-critical">{usd(diff * 12, 2)}</p></div>
            </div>
          )}
          <Link to="/modernization" className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Generate verified replacement <ArrowRight className="size-4" />
          </Link>
        </>
      )}
    </article>
  );
}
