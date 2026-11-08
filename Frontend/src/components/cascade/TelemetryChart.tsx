import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCascade } from '@/lib/store';
import { time } from '@/lib/format';
import { EmptyState } from './primitives';

const MAIN = 'PT-CH1-TEMP';
const SECOND = 'PT-HALL-TEMP';

export function TelemetryChart() {
  const { readings, anomalies } = useCascade();
  const a = readings[MAIN] ?? [];
  const b = readings[SECOND] ?? [];
  if (!a.length && !b.length) return <EmptyState title="Waiting for telemetry" body="Readings appear as the telemetry stream connects." />;
  const byTs = new Map<string, { ts: string; loop?: number; hall?: number }>();
  a.forEach((r) => byTs.set(r.ts, { ...(byTs.get(r.ts) ?? { ts: r.ts }), loop: r.value }));
  b.forEach((r) => byTs.set(r.ts, { ...(byTs.get(r.ts) ?? { ts: r.ts }), hall: r.value }));
  const data = [...byTs.values()].sort((x, y) => x.ts.localeCompare(y.ts));
  const marks = anomalies.filter((x) => x.point_id === MAIN || x.point_id === SECOND);
  const last = data[data.length - 1];

  return (
    <div>
      <div className="h-56" role="img" aria-label={`Telemetry chart. Latest supply temperature ${last?.loop ?? '—'} °C, hall inlet ${last?.hall ?? '—'} °C. ${marks.length} anomalies.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={time} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} minTickGap={60} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={(v) => time(String(v))} contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }} />
            <Line type="monotone" dataKey="loop" name="Supply temp (CH-1, °C)" stroke="var(--color-chart-1)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="hall" name="Hall 200 inlet (°C)" stroke="var(--color-chart-2)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            {marks.map((m) => {
              const row = data.find((d) => d.ts >= m.ts);
              return row ? <ReferenceDot key={m.id} x={row.ts} y={(m.point_id === MAIN ? row.loop : row.hall) ?? 0} r={4} fill="var(--color-critical)" stroke="none" /> : null;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-chart-1" />Loop supply temp (CH-1)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-chart-2" />Hall 200 inlet temp</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-critical" />Anomaly</span>
      </div>
    </div>
  );
}
