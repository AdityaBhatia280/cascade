import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function CodeLines({ lines, startLine, highlight, className }: { lines: string[]; startLine: number; highlight?: number; className?: string }) {
  return (
    <pre className={cn('overflow-x-auto rounded-md border border-border bg-secondary py-2 font-mono text-[12.5px] leading-6', className)}>
      {lines.map((l, i) => {
        const n = startLine + i;
        const hit = n === highlight;
        return (
          <div key={i} className={cn('flex min-w-max pr-4', hit && 'bg-primary-soft')}>
            <span className={cn('w-12 shrink-0 select-none pr-3 text-right text-muted-foreground tnum', hit && 'text-primary border-l-2 border-primary')}>{n}</span>
            <span className="whitespace-pre">{l}</span>
          </div>
        );
      })}
    </pre>
  );
}

export function SourceSnippetView({ file, line }: { file: string; line: number }) {
  const q = useQuery({ queryKey: ['source', file, line], queryFn: () => api.source(file, line), enabled: !!file });
  if (!file) return <p className="text-xs text-muted-foreground">No evidence file — unverified hypothesis.</p>;
  if (q.isLoading) return <div className="h-10 animate-pulse rounded-md bg-secondary" />;
  if (!q.data) return <p className="text-xs text-muted-foreground">Snippet available when the backend is connected.</p>;
  return <CodeLines lines={q.data.lines} startLine={q.data.start_line} highlight={q.data.line} />;
}

export function CopyCode({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label-text">{label}</span>
        <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <CodeLines lines={code.split('\n')} startLine={1} />
    </div>
  );
}
