import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { pageHead } from '@/lib/seo';
import type { Assumptions } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { ErrorState, LoadingBlock, PageHeader, Panel } from '@/components/cascade/primitives';

export const Route = createFileRoute('/assumptions')({
  head: pageHead('Assumptions', 'Illustrative SLA credit tiers and cost inputs used to price cascade impact.'),
  component: AssumptionsPage,
});

function AssumptionsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assumptions'], queryFn: api.assumptions });
  const [form, setForm] = useState<Assumptions | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (q.data) setForm(structuredClone(q.data)); }, [q.data]);

  if (q.isLoading || (!form && !q.isError)) return <LoadingBlock rows={6} />;
  if (q.isError || !form) return <ErrorState onRetry={() => q.refetch()} />;

  const num = (v: string) => (v === '' ? 0 : Number(v));
  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.saveAssumptions(form);
      qc.setQueryData(['assumptions'], saved);
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['incidents'] });
      toast.success(`Saved version ${saved.version}. Totals will be re-priced.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Toaster />
      <PageHeader title="Assumptions" description="Illustrative inputs — edit to see how totals change." actions={<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save and re-price'}</Button>} />
      <p className="text-xs text-muted-foreground tnum">Version {form.version}</p>

      <Panel title="SLA credit tiers">
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <span className="label-text">Outage up to (minutes)</span>
          <span className="label-text">Credit (% of monthly fee)</span>
          {form.sla_credit_tiers.map((t, i) => (
            <div key={i} className="contents">
              <Input type="number" className="h-10 tnum" aria-label={`Tier ${i + 1} max minutes`} value={t.max_minutes}
                onChange={(e) => { const tiers = [...form.sla_credit_tiers]; tiers[i] = { ...t, max_minutes: num(e.target.value) }; setForm({ ...form, sla_credit_tiers: tiers }); }} />
              <Input type="number" step="1" className="h-10 tnum" aria-label={`Tier ${i + 1} credit percent`} value={+(t.pct_of_monthly_fee * 100).toFixed(2)}
                onChange={(e) => { const tiers = [...form.sla_credit_tiers]; tiers[i] = { ...t, pct_of_monthly_fee: num(e.target.value) / 100 }; setForm({ ...form, sla_credit_tiers: tiers }); }} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Costs and physics">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="er">Emergency response (USD)</Label>
            <Input id="er" type="number" className="h-10 tnum" value={form.emergency_response_usd} onChange={(e) => setForm({ ...form, emergency_response_usd: num(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label htmlFor="hw">Hardware damage (USD)</Label>
            <Input id="hw" type="number" className="h-10 tnum" value={form.hardware_damage_usd} onChange={(e) => setForm({ ...form, hardware_damage_usd: num(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label htmlFor="tr">Thermal rise (°C / min)</Label>
            <Input id="tr" type="number" step="0.1" className="h-10 tnum" value={form.thermal_rise_c_per_min} onChange={(e) => setForm({ ...form, thermal_rise_c_per_min: num(e.target.value) })} /></div>
        </div>
      </Panel>
    </div>
  );
}
